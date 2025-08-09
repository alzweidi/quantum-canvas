/**
 * renderer class - renders the quantum wave function to WebGL canvas
 * visualises complex wave function data as colorful patterns
 */
export class Renderer {
  /**
   * initialise the WebGL renderer with regl
   * @param {HTMLCanvasElement} canvasElement - the canvas to render to
   */
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.regl = window.createREGL(canvasElement);

    // store backing store dimensions (DPR-aware)
    this.backingStoreWidth = canvasElement.width;
    this.backingStoreHeight = canvasElement.height;

    // diagnostic tracking for amplitude scaling
    this.scalingDiagnostics = {
      frameCount: 0,
      lastWarningFrame: -1,
      warningThreshold: 60, // warn once per second at 60fps
    };

    console.log(
      `[DPR FIX] Renderer using backing store: ${this.backingStoreWidth}x${this.backingStoreHeight}`,
    );

    // create texture for wave function data using unsigned bytes
    this.psiTexture = this.regl.texture({
      width: this.backingStoreWidth,
      height: this.backingStoreHeight,
      format: "rgba",
      type: "uint8",
      data: null,
      mag: "linear",
      min: "linear",
    });

    // create texture for potential barriers
    this.potentialTexture = this.regl.texture({
      width: this.backingStoreWidth,
      height: this.backingStoreHeight,
      format: "rgba",
      type: "uint8",
      data: null,
      mag: "linear",
      min: "linear",
    });

    // pre-allocate texture data buffers for performance (using bytes) - DPR-aware size
    this.textureDataBuffer = new Uint8Array(
      this.backingStoreWidth * this.backingStoreHeight * 4,
    );
    this.potentialDataBuffer = new Uint8Array(
      this.backingStoreWidth * this.backingStoreHeight * 4,
    );

    // create the main rendering command - WebGL compatible version
    this.drawCommand = this.regl({
      // vertex shader - sets up fullscreen quad
      vert: `
                precision mediump float;
                attribute vec2 position;
                varying vec2 uv;
                void main() {
                    uv = 0.5 * position + 0.5;
                    gl_Position = vec4(position, 0, 1);
                }
            `,

      // fragment shader - simplified quantum wave function visualisation
      frag: `
                precision mediump float;
                uniform sampler2D psiTexture;
                uniform sampler2D potentialTexture;
                uniform float u_brightness;
                uniform float u_potentialMax;
                uniform float u_magCutoff;
                uniform vec2 u_textureSize;
                varying vec2 uv;

                const float PI = 3.14159265359;
                const float TWO_PI = 6.28318530718;

                // Enhanced quantum color mapping
                vec3 quantumColorMapping(float magnitude, float phase) {
                    // Phase-based color mapping with improved perceptual uniformity
                    float hue = phase / TWO_PI; // Normalize phase to [0,1]
                    float saturation = clamp(magnitude * 2.0, 0.0, 1.0);
                    float lightness = 0.3 + magnitude * 0.7;
                    
                    // HSL to RGB conversion
                    vec3 hsl = vec3(hue, saturation, lightness);
                    vec3 rgb = clamp(abs(mod(hsl.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0);
                    return hsl.z + hsl.y * (rgb-0.5)*(1.0-abs(2.0*hsl.z-1.0));
                }

                // Simple glow effect using nearby samples
                vec3 applyGlow(vec3 baseColor, float magnitude, vec2 uv) {
                    vec2 texelSize = 1.0 / u_textureSize;
                    vec3 glow = vec3(0.0);
                    float glowStrength = magnitude * 0.5;
                    
                    // Sample nearby pixels for glow effect
                    for (int x = -2; x <= 2; x++) {
                        for (int y = -2; y <= 2; y++) {
                            vec2 offset = vec2(float(x), float(y)) * texelSize;
                            vec2 samplePsi = texture2D(psiTexture, uv + offset).rg * 2.0 - 1.0;
                            float sampleMag = length(samplePsi);
                            float distance = length(vec2(float(x), float(y)));
                            float weight = exp(-distance * distance / 8.0) * sampleMag;
                            glow += baseColor * weight;
                        }
                    }
                    
                    return baseColor + glow * glowStrength * 0.1;
                }

                // Phase contours for quantum visualization
                vec3 applyPhaseContours(vec3 baseColor, float phase, float magnitude) {
                    float contourInterval = PI / 4.0; // Contours every 45 degrees
                    float normalizedPhase = mod(phase + PI, TWO_PI) / TWO_PI;
                    float contourPhase = mod(normalizedPhase, contourInterval / TWO_PI);
                    
                    float contourWidth = 0.02;
                    float contour = smoothstep(0.0, contourWidth, contourPhase) -
                                   smoothstep(contourInterval / TWO_PI - contourWidth,
                                            contourInterval / TWO_PI, contourPhase);
                    
                    float contourOpacity = 0.3 * smoothstep(0.1, 0.4, magnitude);
                    vec3 contourColor = vec3(0.0, 0.0, 0.0);
                    
                    return mix(baseColor, contourColor, contour * contourOpacity);
                }

                // Potential barrier visualization
                vec3 applyPotentialBarriers(vec3 baseColor, float potential) {
                    if (potential > 0.01) {
                        vec3 barrierColor = vec3(0.8, 0.1, 0.1); // Red barriers
                        float barrierOpacity = clamp(potential / u_potentialMax, 0.0, 0.8);
                        return mix(baseColor, barrierColor, barrierOpacity);
                    }
                    return baseColor;
                }

                // Enhanced magnitude scaling for better visibility
                float enhanceMagnitude(float magnitude) {
                    // Logarithmic scaling for small magnitudes
                    if (magnitude < 0.1) {
                        return pow(magnitude, 0.5) * 2.0;
                    } else {
                        return magnitude;
                    }
                }

// DEBUG: log magnitude distribution for brightness investigation
                void debugMagnitudeLogging() {
                    if (uv.x < 0.01 && uv.y < 0.01) {
                        // sample top-left corner pixel for debugging
                        vec2 texel = texture2D(psiTexture, uv).rg;
                        vec2 psi = (texel * 2.0) - 1.0;
                        float mag = length(psi);
                        
                        // this will show in browser console if magnitude is problematic
                        if (mag > 1e-3 && mag < 0.01) {
                            // these are the problematic magnitudes that should be background
                        }
                    }
                }
                void main() {
                    // Read and convert complex wave function
                    vec2 texel = texture2D(psiTexture, uv).rg;
                    vec2 psi = (texel * 2.0) - 1.0;
                    
                    float magnitude = length(psi);
                    float phase = atan(psi.y, psi.x);
                    
                    // Read potential barrier
                    float potential = texture2D(potentialTexture, uv).r * u_potentialMax;
                    
                    // Enhance small magnitudes for better visibility
                    float enhancedMagnitude = enhanceMagnitude(magnitude);
                    
                    // Apply quantum color mapping
                    vec3 baseColor = quantumColorMapping(enhancedMagnitude, phase);
                    
                    // Apply glow effect
                    vec3 glowColor = applyGlow(baseColor, enhancedMagnitude, uv);
                    
                    // Apply phase contours
                    vec3 contourColor = applyPhaseContours(glowColor, phase, enhancedMagnitude);
                    
                    // Filter out quantization noise: anything below u_magCutoff is background
                    vec3 quantumColor;
                    if (magnitude < u_magCutoff) {
                        // background stays pure black
                        quantumColor = vec3(0.0);
                    } else {
                        // visible wave—brightness scales contour color
                        quantumColor = contourColor * u_brightness;
                    }
                    
                    // overlay barriers at full strength
                    vec3 finalColor = applyPotentialBarriers(quantumColor, potential);
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,

      // attributes - fullscreen quad vertices
      attributes: {
        position: [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [-1, 1],
          [1, -1],
          [1, 1],
        ],
      },

      // uniforms - pass wave function and potential textures
      uniforms: {
        psiTexture: this.psiTexture,
        potentialTexture: this.potentialTexture,
        u_brightness: this.regl.prop("brightness"),
        u_potentialMax: this.regl.prop("potentialMax"),
        u_magCutoff: this.regl.prop("magCutoff"),
        u_textureSize: this.regl.prop("textureSize"),
      },

      // draw 6 vertices (2 triangles = fullscreen quad)
      count: 6,
    });
  }

  /**
   * render the current quantum state to the canvas
   * @param {SimulationState} state - the simulation state to visualise
   */
  draw(state) {
    // simulation grid size (always 256x256)
    const simGridSize = Math.sqrt(state.psi.length / 2); // complex numbers = length/2
    const scaleX = this.backingStoreWidth / simGridSize;
    const scaleY = this.backingStoreHeight / simGridSize;

    // diagnostic tracking for amplitude scaling warnings
    this.scalingDiagnostics.frameCount++;
    let scaledPixelCount = 0;
    let maxAmplitudeFound = 0;

    // pack complex wave function data into rgba texture format with DPR scaling
    // convert float values to 0-255 byte range for uint8 texture
    for (let backingY = 0; backingY < this.backingStoreHeight; backingY++) {
      for (let backingX = 0; backingX < this.backingStoreWidth; backingX++) {
        // map backing store coordinates to simulation grid coordinates
        const simX = Math.floor(backingX / scaleX);
        const simY = Math.floor(backingY / scaleY);
        const simIdx = (simY * simGridSize + simX) * 2; // complex array index
        const backingIdx = (backingY * this.backingStoreWidth + backingX) * 4; // rgba index

        // convert float values to 0-255 range with adaptive scaling
        const real = state.psi[simIdx];
        const imag = state.psi[simIdx + 1];

        // per-pixel adaptive scaling to prevent silent clipping of |ψ| > 1 components
        const maxComponent = Math.max(Math.abs(real), Math.abs(imag));
        const scale = maxComponent > 1.0 ? 1.0 / maxComponent : 1.0;

        // track scaling diagnostics
        if (scale < 1.0) {
          scaledPixelCount++;
          maxAmplitudeFound = Math.max(maxAmplitudeFound, maxComponent);
        }

        // apply scaling while preserving phase information
        const scaledReal = real * scale;
        const scaledImag = imag * scale;

        // map from [-1, 1] to [0, 255] with offset for negative values
        this.textureDataBuffer[backingIdx] = Math.floor(
          (scaledReal + 1.0) * 127.5,
        ); // real -> r
        this.textureDataBuffer[backingIdx + 1] = Math.floor(
          (scaledImag + 1.0) * 127.5,
        ); // imag -> g
        this.textureDataBuffer[backingIdx + 2] = 0; // blue
        this.textureDataBuffer[backingIdx + 3] = 255; // alpha
      }
    }

    // emit diagnostic warning if significant scaling occurred
    const totalPixels = this.backingStoreWidth * this.backingStoreHeight;
    const scalingPercentage = (scaledPixelCount / totalPixels) * 100;

    if (
      scaledPixelCount > 0 &&
      this.scalingDiagnostics.frameCount -
        this.scalingDiagnostics.lastWarningFrame >=
        this.scalingDiagnostics.warningThreshold
    ) {
      console.warn(
        `[QUANTUM AMPLITUDE SCALING] Frame ${this.scalingDiagnostics.frameCount}: ` +
          `${scaledPixelCount} pixels (${scalingPercentage.toFixed(2)}%) required amplitude scaling. ` +
          `Max component found: ${maxAmplitudeFound.toFixed(4)} (exceeds [-1,1] texture range). ` +
          "Phase information preserved via adaptive scaling.",
      );
      this.scalingDiagnostics.lastWarningFrame =
        this.scalingDiagnostics.frameCount;
    }

    // define potential scaling from barrier energy (default 300.0)
    const potentialMax =
      state.params.barrierEnergy > 0 ? state.params.barrierEnergy : 300.0;
    const potentialToByte = 255 / potentialMax;

    // pack potential barrier data into rgba texture format with DPR scaling
    for (let backingY = 0; backingY < this.backingStoreHeight; backingY++) {
      for (let backingX = 0; backingX < this.backingStoreWidth; backingX++) {
        // map backing store coordinates to simulation grid coordinates
        const simX = Math.floor(backingX / scaleX);
        const simY = Math.floor(backingY / scaleY);
        const simIdx = simY * simGridSize + simX;
        const backingIdx = (backingY * this.backingStoreWidth + backingX) * 4; // rgba index

        // normalise potential using dynamic scaling based on potentialMax
        const normalizedPotential = Math.max(
          0,
          Math.min(255, Math.floor(state.potential[simIdx] * potentialToByte)),
        );

        this.potentialDataBuffer[backingIdx] = normalizedPotential; // potential -> r
        this.potentialDataBuffer[backingIdx + 1] = 0; // green
        this.potentialDataBuffer[backingIdx + 2] = 0; // blue
        this.potentialDataBuffer[backingIdx + 3] = 255; // alpha
      }
    }

    // upload texture data to GPU
    this.psiTexture.subimage(this.textureDataBuffer);
    this.potentialTexture.subimage(this.potentialDataBuffer);

    // clear canvas and render
    this.regl.clear({
      color: [0, 0, 0, 1],
      depth: 1,
    });
    // execute the draw command with brightness parameter and current texture size
    this.drawCommand({
      brightness: state.params.brightness,
      potentialMax,
      textureSize: [this.backingStoreWidth, this.backingStoreHeight],
      magCutoff:
        state.visual &&
        typeof state.visual.magCutoff === "number" &&
        state.visual.magCutoff >= 0.0
          ? state.visual.magCutoff
          : 0.01,
    });
  }
}
