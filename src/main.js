import { SimulationState } from './SimulationState.js';
import { ComputationEngine } from './ComputationEngine.js';
import { Renderer } from './Renderer.js';
import { UIController } from './UIController.js';
import * as C from './constants.js';

const canvas = document.getElementById('sim-canvas');
if (!canvas) {
    throw new Error('Critical error: Canvas element with id "sim-canvas" not found in DOM. Check index.html structure.');
}
canvas.width = C.GRID_SIZE;
canvas.height = C.GRID_SIZE;

const state = new SimulationState();
const engine = new ComputationEngine(state.gridSize);
const renderer = new Renderer(canvas);
// eslint-disable-next-line no-unused-vars
const uiController = new UIController(canvas, state);

function gameLoop() {
    engine.step(state);
    renderer.draw(state);
    requestAnimationFrame(gameLoop);
}

gameLoop();
