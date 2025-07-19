# Project Specification: Interactive 2D Quantum Simulator (Final)

## 1. Project Philosophy & Core Principles

- **Modularity**: The system is divided into four distinct modules: `State`, `Engine`, `Renderer`, and `UI`. This is non-negotiable.
- **Unidirectional Data Flow**: The `UI` updates the `State`. The `Engine` reads and computes the next `State`. The `Renderer` reads the `State` and draws it. This ensures predictability and simplifies debugging.
- **Performance by Design**: All intensive operations are optimized. The physics calculation uses a proven FFT library. The rendering is offloaded entirely to the GPU via WebGL.
- **Stateless Logic**: The `Engine` and `Renderer` are stateless. They receive the `State` object, perform their function, and do not retain data between frames.

---

## 2. Core Architecture & Dependencies

The application will consist of a single HTML file and a `src` directory containing the JavaScript modules.

- **Dependencies**:
  - `fft.js`: For Fast Fourier Transforms.
  - `regl`: A functional WebGL wrapper to eliminate boilerplate.

---

## 3. Step 1: Project Setup & Constants

This is the foundational setup.

### `index.html`

Create the main HTML file. It will load the necessary libraries and your main script.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Quantum Simulator</title>
    <style>
      body {
        margin: 0;
        background-color: #111;
        overflow: hidden;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
      }
      canvas {
        display: block;
        box-shadow: 0 0 20px rgba(127, 255, 212, 0.5);
      }
      /* Add other styles for your UI panel */
    </style>
  </head>
  <body>
    <canvas id="sim-canvas"></canvas>
    <div id="ui-panel"></div>
    <script src="[https://cdn.jsdelivr.net/npm/fft.js/lib/fft.js](https://cdn.jsdelivr.net/npm/fft.js/lib/fft.js)"></script>
    <script src="[https://cdn.jsdelivr.net/npm/regl/dist/regl.min.js](https://cdn.jsdelivr.net/npm/regl/dist/regl.min.js)"></script>
    <script type="module" src="src/main.js"></script>
  </body>
</html>

src/constants.js Create a dedicated file for all physical and simulation
constants. This makes tuning easy. // Grid and Simulation Parameters export
const GRID_SIZE = 256; // Must be a power of 2 export const DT = 0.005; // Time
step. Critical for stability. Tune if simulation "explodes". // Physical
Constants (can be set to 1 for simplicity) export const HBAR = 1; export const
MASS = 1; // Initial Wave Packet Parameters export const SIGMA = 15.0; //
Initial width of the Gaussian packet export const P_X = 60.0; // Initial
momentum in x export const P_Y = 0.0; // Initial momentum in y 4. Step 2:
File-by-File Implementation Implement the following modules in order. File:
src/SimulationState.js Responsibility: The single source of truth. Creates and
holds all simulation data. Implementation: import * as C from './constants.js';
export class SimulationState { constructor() { this.gridSize = { width:
C.GRID_SIZE, height: C.GRID_SIZE }; // Interleaved complex arrays: [real0,
imag0, real1, imag1, ...] this.psi = new Float32Array(this.gridSize.width *
this.gridSize.height * 2); this.potential = new Float32Array(this.gridSize.width
* this.gridSize.height); this.kineticOperatorK = new
Float32Array(this.gridSize.width * this.gridSize.height * 2);
this._precalculateKineticOperator(); this.resetWaveFunction(); }
_precalculateKineticOperator() { // ... implementation as specified ... }
resetWaveFunction() { // ... implementation as specified ... } } File:
src/ComputationEngine.js Responsibility: Executes one time-step of the physics
simulation. Implementation: import * as C from './constants.js'; export class
ComputationEngine { constructor(gridSize) { this.gridSize = gridSize; this.fft =
new FFT(this.gridSize.width); // Buffers must be large enough for the entire 2D
grid. this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2);
this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2); }
step(state) { // ... implementation as specified ... } // ... all other helper
methods as specified ... } File: src/Renderer.js File: src/Renderer.js
Responsibility: Renders the psi array to the screen using WebGL. Implementation:
export class Renderer { constructor(canvasElement) { this.regl =
createREGL(canvasElement); // Check for float texture support const
OES_texture_float = this.regl.getExtension('OES_texture_float'); if
(!OES_texture_float) { alert("This browser does not support floating point
textures, which are required for this simulation."); throw new Error("No
OES_texture_float support"); } this.psiTexture = this.regl.texture({ /* ... */
}); this.textureDataBuffer = new Float32Array(canvasElement.width *
canvasElement.height * 4); this.drawCommand = this.regl({ /* ... shaders and
attributes as specified ... */ }); } draw(state) { // Pack complex data into
RGBA texture for (let i = 0; i < state.psi.length / 2; i++) { const idx = i * 4;
const psiIdx = i * 2; this.textureDataBuffer[idx] = state.psi[psiIdx];
this.textureDataBuffer[idx + 1] = state.psi[psiIdx + 1];
this.textureDataBuffer[idx + 2] = 0.0; this.textureDataBuffer[idx + 3] = 0.0; }
this.psiTexture.subimage(this.textureDataBuffer); this.regl.clear({ color: [0,
0, 0, 1] }); this.drawCommand(); } } File: src/UIController.js Responsibility:
To handle all user interaction and modify the state.potential array. File:
src/main.js Responsibility: To initialize all modules and run the main
application loop. Implementation: import * as C from './constants.js'; import {
SimulationState } from './SimulationState.js'; import { ComputationEngine } from
'./ComputationEngine.js'; import { Renderer } from './Renderer.js'; // Set
canvas size const canvas = document.getElementById('sim-canvas'); canvas.width =
C.GRID_SIZE; canvas.height = C.GRID_SIZE; // Initialize all modules const state
= new SimulationState(); const engine = new ComputationEngine(state.gridSize);
const renderer = new Renderer(canvas); // Main application loop function
gameLoop() { engine.step(state); renderer.draw(state);
requestAnimationFrame(gameLoop); } gameLoop(); 5. Step 3: Development Workflow
(The Map) This is the exact order to build and test your project. Milestone 0:
Prototype & De-risk: Before building the full application, create a single test
file to prove you can get the hardest parts working in isolation. Milestone 1:
The Static State: Implement constants.js and SimulationState.js. Milestone 2:
The Evolving Engine: Implement ComputationEngine.js. Milestone 3: The
Visualizer: Implement Renderer.js. Milestone 4: Full Interactivity: Implement
UIController.js. Milestone 5: Polish: Refine the UI, add presets, and write the
README.md.
```
