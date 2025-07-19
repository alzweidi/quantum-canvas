import * as C from './constants.js';
import { SimulationState } from './SimulationState.js';
import { ComputationEngine } from './ComputationEngine.js';
import { Renderer } from './Renderer.js';
import { UIController } from './UIController.js';

/**
 * Main application entry point
 * Initializes the simulation state, computation engine, and runs the main loop
 */

console.log('Initializing Quantum Simulator...');
console.log('Grid size:', C.GRID_SIZE + 'x' + C.GRID_SIZE);
console.log('Time step:', C.DT);
console.log('Initial momentum: Px =', C.P_X, ', Py =', C.P_Y);
console.log('Wave packet width (σ):', C.SIGMA);

// Initialize the simulation state
const state = new SimulationState();

// Verification step - log initial state data
console.log('Initial psi data sample:', state.psi.slice(0, 10));
console.log('Psi array length:', state.psi.length);
console.log('Potential array length:', state.potential.length);
console.log('Kinetic operator array length:', state.kineticOperatorK.length);

// Calculate and display initial statistics
let psiMagnitudeSum = 0;
for (let i = 0; i < state.psi.length; i += 2) {
    const real = state.psi[i];
    const imag = state.psi[i + 1];
    psiMagnitudeSum += real * real + imag * imag;
}
console.log('Wave function normalization check (should ≈ 1.0):', psiMagnitudeSum);

// Sample kinetic operator values
console.log('Kinetic operator sample:', state.kineticOperatorK.slice(0, 10));

console.log('✓ Using self-contained FFT implementation');
console.log('✓ Milestone 1: The Static State - Successfully initialized');

// Set canvas size
const canvas = document.getElementById('sim-canvas');
canvas.width = C.GRID_SIZE;
canvas.height = C.GRID_SIZE;

// Initialize the computation engine
const engine = new ComputationEngine(state.gridSize);
console.log('✓ Computation Engine initialized');

// Initialize the renderer
const renderer = new Renderer(canvas);
console.log('✓ Renderer initialized');

// Initialize the UI controller
const uiController = new UIController(canvas, state);
// Update scaling to ensure proper coordinate conversion
uiController.updateScaling();
console.log('✓ UI Controller initialized with scaling:', {
    canvasSize: { w: canvas.width, h: canvas.height },
    clientSize: { w: canvas.clientWidth, h: canvas.clientHeight },
    gridSize: { w: state.gridSize.width, h: state.gridSize.height }
});

// Setup button event listeners
const resetButton = document.getElementById('reset-button');
const clearButton = document.getElementById('clear-button');

resetButton.addEventListener('click', () => {
    uiController.resetSimulation();
});

clearButton.addEventListener('click', () => {
    uiController.clearWalls();
});

console.log('✓ Button event listeners configured');

/**
 * Debugging helper function to check wave function health
 */
function checkWaveFunction(state, label) {
    let sumOfSquares = 0;
    let hasNaN = false;
    for (let i = 0; i < state.psi.length; i++) {
        if (isNaN(state.psi[i])) {
            hasNaN = true;
            break;
        }
        if (i % 2 === 0) { // Summing magnitude squared: real^2 + imag^2
            sumOfSquares += state.psi[i] * state.psi[i] + state.psi[i+1] * state.psi[i+1];
        }
    }
    if (hasNaN) {
        console.error(`FAILURE at ${label}: Found NaN values.`);
    } else {
        console.log(`CHECK at ${label}: Normalization = ${sumOfSquares.toFixed(6)}`);
    }
}

/**
 * Instrumented game loop with detailed debugging for first 5 frames
 */
let frameCount = 0;
function gameLoop() {
    if (frameCount < 5) { // Only log the first 5 frames to avoid spam
        console.log(`--- FRAME ${frameCount} ---`);
        checkWaveFunction(state, 'Start of Frame');

        engine._applyPotential(state, C.DT / 2.0);
        checkWaveFunction(state, 'After V/2 (1)');

        engine._applyKinetic(state);
        checkWaveFunction(state, 'After Kinetic');

        engine._applyPotential(state, C.DT / 2.0);
        checkWaveFunction(state, 'After V/2 (2)');
    } else {
        // Normal operation for frames after debugging
        engine.step(state);
    }

    renderer.draw(state);
    frameCount++;
    requestAnimationFrame(gameLoop);
}

// Start the main animation loop
console.log('✓ Starting Milestone 4: Full Interactivity');
console.log('Interactive quantum simulator ready - click and drag to draw barriers!');
gameLoop();
