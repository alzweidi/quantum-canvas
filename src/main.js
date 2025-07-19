import * as C from "./constants.js";
import { SimulationState } from "./SimulationState.js";
import { ComputationEngine } from "./ComputationEngine.js";
import { Renderer } from "./Renderer.js";
import { UIController } from "./UIController.js";

/**
 * Main application entry point for the Interactive 2D Quantum Simulator
 * Initializes all modules and runs the main application loop
 */

// Set canvas size to match simulation grid
const canvas = document.getElementById("sim-canvas");
canvas.width = C.GRID_SIZE;
canvas.height = C.GRID_SIZE;

// Initialize all simulation modules
const state = new SimulationState();
const engine = new ComputationEngine(state.gridSize);
const renderer = new Renderer(canvas);
const uiController = new UIController(canvas, state);

// Update UI scaling for proper coordinate conversion
uiController.updateScaling();

/**
 * Apply absorbing boundaries to prevent wave packet wrapping
 * Sets border cells to zero to absorb the wave function at edges
 * @param {SimulationState} state - The simulation state to modify
 */
function applyAbsorbingBoundaries(state) {
  const width = state.gridSize.width;
  const height = state.gridSize.height;
  const psi = state.psi;

  // Apply absorbing boundaries by zeroing border cells
  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      // Check if we're at any border
      if (i === 0 || i === height - 1 || j === 0 || j === width - 1) {
        const idx = (i * width + j) * 2;
        psi[idx] = 0.0; // Real component
        psi[idx + 1] = 0.0; // Imaginary component
      }
    }
  }
}

/**
 * Main animation loop - advances simulation and renders each frame
 * Uses requestAnimationFrame for smooth 60+ FPS performance
 * @private
 */
function gameLoop() {
  engine.step(state);
  applyAbsorbingBoundaries(state);
  renderer.draw(state);
  requestAnimationFrame(gameLoop);
}

// Initialize application
gameLoop();
