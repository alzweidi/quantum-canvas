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
 * Main animation loop - advances simulation and renders each frame
 * Uses requestAnimationFrame for smooth 60+ FPS performance
 * @private
 */
function gameLoop() {
  engine.step(state);
  renderer.draw(state);
  requestAnimationFrame(gameLoop);
}

// Initialize application
gameLoop();
