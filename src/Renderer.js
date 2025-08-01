/**
 * renderer class - renders the quantum wave function to WebGL canvas
 * visualises complex wave function data as colorful patterns
 */
export class Renderer {
    /**
     * initialize the WebGL renderer with regl
     * @param {HTMLCanvasElement} canvasElement - the canvas to render to
     */
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.regl = window.createREGL(canvasElement);

        // create texture for wave function data using unsigned bytes
        this.psiTexture = this.regl.texture({
            width: canvasElement.width,
            height: canvasElement.height,
            format: 'rgba',
            type: 'uint8',
            data: null,
            mag: 'linear',
            min: 'linear'
        });

        // create texture for potential barriers
        this.potentialTexture = this.regl.texture({
            width: canvasElement.width,
            height: canvasElement.height,
            format: 'rgba',
            type: 'uint8',
            data: null,
            mag: 'linear',
            min: 'linear'
        });

        // pre-allocate texture data buffers for performance (using bytes)
        this.textureDataBuffer = new Uint8Array(canvasElement.width * canvasElement.height * 4);
        this.potentialDataBuffer = new Uint8Array(canvasElement.width * canvasElement.height * 4);

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

            // fragment shader - simplified quantum wave function visualization
            frag: `
                precision mediump float;
                uniform sampler2D psiTexture;
                uniform sampler2D potentialTexture;
                uniform float u_brightness;
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
                        float barrierOpacity = clamp(potential / 100.0, 0.0, 0.8);
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

                void main() {
                    // Read and convert complex wave function
                    vec2 texel = texture2D(psiTexture, uv).rg;
                    vec2 psi = (texel * 2.0) - 1.0;
                    
                    float magnitude = length(psi);
                    float phase = atan(psi.y, psi.x);
                    
                    // Read potential barrier
                    float potential = texture2D(potentialTexture, uv).r * 100.0; // Denormalize
                    
                    // Enhance small magnitudes for better visibility
                    float enhancedMagnitude = enhanceMagnitude(magnitude);
                    
                    // Apply quantum color mapping
                    vec3 baseColor = quantumColorMapping(enhancedMagnitude, phase);
                    
                    // Apply glow effect
                    vec3 glowColor = applyGlow(baseColor, enhancedMagnitude, uv);
                    
                    // Apply phase contours
                    vec3 contourColor = applyPhaseContours(glowColor, phase, enhancedMagnitude);
                    
                    // Apply potential barriers
                    vec3 finalColor = applyPotentialBarriers(contourColor, potential);
                    
                    // FIXED: Apply brightness only where quantum packet actually exists
                    // Areas with no packet should remain black regardless of brightness setting
                    if (enhancedMagnitude > 0.01) {
                        finalColor *= u_brightness;
                    } else {
                        finalColor = vec3(0.0); // Keep background pure black
                    }
                    
                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,

            // attributes - fullscreen quad vertices
            attributes: {
                position: [
                    [-1, -1], [1, -1], [-1, 1],
                    [-1, 1], [1, -1], [1, 1]
                ]
            },

            // uniforms - pass wave function and potential textures
            uniforms: {
                psiTexture: this.psiTexture,
                potentialTexture: this.potentialTexture,
                u_brightness: this.regl.prop('brightness'),
                u_textureSize: [canvasElement.width, canvasElement.height]
            },

            // draw 6 vertices (2 triangles = fullscreen quad)
            count: 6
        });
    }

    /**
     * render the current quantum state to the canvas
     * @param {SimulationState} state - the simulation state to visualise
     */
    draw(state) {
        // pack complex wave function data into rgba texture format
        // convert float values to 0-255 byte range for uint8 texture
        for (let i = 0; i < state.psi.length / 2; i++) {
            const idx = i * 4;        // rgba texture index
            const psiIdx = i * 2;     // complex array index

            // convert float values to 0-255 range
            // map from [-1, 1] to [0, 255] with offset for negative values
            const real = state.psi[psiIdx];
            const imag = state.psi[psiIdx + 1];
            
            this.textureDataBuffer[idx] = Math.floor((real + 1.0) * 127.5);     // Real -> R
            this.textureDataBuffer[idx + 1] = Math.floor((imag + 1.0) * 127.5); // Imag -> G
            this.textureDataBuffer[idx + 2] = 0;                                // Blue
            this.textureDataBuffer[idx + 3] = 255;                              // Alpha
        }

        // pack potential barrier data into rgba texture format
        for (let i = 0; i < state.potential.length; i++) {
            const idx = i * 4;        // rgba texture index
            
            // normalise potential (typically 0-100) to 0-255 range
            const normalizedPotential = Math.min(255, Math.floor(state.potential[i] * 2.55));
            
            this.potentialDataBuffer[idx] = normalizedPotential;     // Potential -> R
            this.potentialDataBuffer[idx + 1] = 0;                   // Green
            this.potentialDataBuffer[idx + 2] = 0;                   // Blue  
            this.potentialDataBuffer[idx + 3] = 255;                 // Alpha
        }

        // upload texture data to GPU
        this.psiTexture.subimage(this.textureDataBuffer);
        this.potentialTexture.subimage(this.potentialDataBuffer);

        // clear canvas and render
        this.regl.clear({
            color: [0, 0, 0, 1],
            depth: 1
        });

        // execute the draw command with brightness parameter
        this.drawCommand({
            brightness: state.params.brightness
        });
    }
}
