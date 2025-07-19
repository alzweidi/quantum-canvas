/**
 * Renderer class - Renders the quantum wave function to WebGL canvas
 * Visualizes complex wave function data as colorful patterns
 */
export class Renderer {
    /**
     * Initialize the WebGL renderer with regl
     * @param {HTMLCanvasElement} canvasElement - The canvas to render to
     */
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.regl = window.createREGL(canvasElement);

        // Create texture for wave function data using unsigned bytes
        this.psiTexture = this.regl.texture({
            width: canvasElement.width,
            height: canvasElement.height,
            format: 'rgba',
            type: 'uint8',
            data: null
        });

        // Create texture for potential barriers
        this.potentialTexture = this.regl.texture({
            width: canvasElement.width,
            height: canvasElement.height,
            format: 'rgba',
            type: 'uint8',
            data: null
        });

        // Pre-allocate texture data buffers for performance (using bytes)
        this.textureDataBuffer = new Uint8Array(canvasElement.width * canvasElement.height * 4);
        this.potentialDataBuffer = new Uint8Array(canvasElement.width * canvasElement.height * 4);

        // Create the main rendering command
        this.drawCommand = this.regl({
            // Vertex shader - sets up fullscreen quad
            vert: `
                precision mediump float;
                attribute vec2 position;
                varying vec2 uv;
                void main() {
                    uv = 0.5 * position + 0.5;
                    gl_Position = vec4(position, 0, 1);
                }
            `,

            // Fragment shader - visualizes complex wave function with barrier overlay
            frag: `
                precision mediump float;
                uniform sampler2D psiTexture;
                uniform sampler2D potentialTexture;
                varying vec2 uv;

                // Standard HSL to RGB conversion
                vec3 hsl2rgb(vec3 c) {
                    vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0);
                    return c.z + c.y * (rgb-0.5)*(1.0-abs(2.0*c.z-1.0));
                }

                void main() {
                    // Read the complex value from the texture's R and G channels
                    vec2 texel = texture2D(psiTexture, uv).rg;
                    
                    // Convert from [0,1] back to [-1,1] range
                    vec2 psi = (texel * 2.0) - 1.0;

                    float magnitude = length(psi);
                    float phase = atan(psi.y, psi.x);

                    // Map phase to hue (0 to 1)
                    float hue = (phase / (2.0 * 3.14159)) + 0.5;

                    // Map magnitude to lightness for a nice visual effect
                    float lightness = smoothstep(0.0, 0.15, magnitude);

                    // Get wave function color
                    vec3 waveColor = hsl2rgb(vec3(hue, 1.0, lightness));

                    // Read potential barrier value (normalized to [0,1])
                    float potential = texture2D(potentialTexture, uv).r;
                    
                    // Create barrier visualization (bright red overlay)
                    vec3 barrierColor = vec3(1.0, 0.1, 0.1); // Brighter red color for barriers
                    float barrierOpacity = smoothstep(0.005, 0.3, potential);
                    
                    // Blend wave function with barrier overlay - more prominent barriers
                    vec3 finalColor = mix(waveColor, barrierColor, barrierOpacity * 0.9);

                    gl_FragColor = vec4(finalColor, 1.0);
                }
            `,

            // Attributes - fullscreen quad vertices
            attributes: {
                position: [
                    [-1, -1], [1, -1], [-1, 1],
                    [-1, 1], [1, -1], [1, 1]
                ]
            },

            // Uniforms - pass wave function and potential textures
            uniforms: {
                psiTexture: this.psiTexture,
                potentialTexture: this.potentialTexture
            },

            // Draw 6 vertices (2 triangles = fullscreen quad)
            count: 6
        });

    }

    /**
     * Render the current quantum state to the canvas
     * @param {SimulationState} state - The simulation state to visualize
     */
    draw(state) {
        // Pack complex wave function data into RGBA texture format
        // Convert float values to 0-255 byte range for uint8 texture
        for (let i = 0; i < state.psi.length / 2; i++) {
            const idx = i * 4;        // RGBA texture index
            const psiIdx = i * 2;     // Complex array index

            // Convert float values to 0-255 range
            // Map from [-1, 1] to [0, 255] with offset for negative values
            const real = state.psi[psiIdx];
            const imag = state.psi[psiIdx + 1];
            
            this.textureDataBuffer[idx] = Math.floor((real + 1.0) * 127.5);     // Real -> R
            this.textureDataBuffer[idx + 1] = Math.floor((imag + 1.0) * 127.5); // Imag -> G
            this.textureDataBuffer[idx + 2] = 0;                                // Blue
            this.textureDataBuffer[idx + 3] = 255;                              // Alpha
        }

        // Pack potential barrier data into RGBA texture format
        for (let i = 0; i < state.potential.length; i++) {
            const idx = i * 4;        // RGBA texture index
            
            // Normalize potential (typically 0-100) to 0-255 range
            const normalizedPotential = Math.min(255, Math.floor(state.potential[i] * 2.55));
            
            this.potentialDataBuffer[idx] = normalizedPotential;     // Potential -> R
            this.potentialDataBuffer[idx + 1] = 0;                   // Green
            this.potentialDataBuffer[idx + 2] = 0;                   // Blue  
            this.potentialDataBuffer[idx + 3] = 255;                 // Alpha
        }

        // Upload texture data to GPU
        this.psiTexture.subimage(this.textureDataBuffer);
        this.potentialTexture.subimage(this.potentialDataBuffer);

        // Clear canvas and render
        this.regl.clear({
            color: [0, 0, 0, 1],
            depth: 1
        });

        // Execute the draw command
        this.drawCommand();
    }
}
