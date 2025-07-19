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

// Test FFT library availability
console.log('Testing FFT library availability...');
console.log('Available globals:', Object.keys(window).filter(key => 
    key.toLowerCase().includes('fft') || 
    key.toLowerCase().includes('dsp') || 
    key.includes('FFT')));

// Test different possible FFT constructors
const fftTests = [
    { name: 'FFT', test: () => typeof FFT !== 'undefined' ? new FFT(4) : null },
    { name: 'DSP.FFT', test: () => typeof DSP !== 'undefined' && DSP.FFT ? new DSP.FFT(4, 44100) : null },
    { name: 'window.FFT', test: () => typeof window.FFT !== 'undefined' ? new window.FFT(4) : null }
];

let fftAvailable = false;
for (const { name, test } of fftTests) {
    try {
        const result = test();
        if (result) {
            console.log(`✓ ${name} constructor available and working`);
            fftAvailable = true;
            break;
        }
    } catch (error) {
        console.log(`✗ ${name} test failed:`, error.message);
    }
}

if (!fftAvailable) {
    console.error('✗ No working FFT library found - this will block Milestone 2');
    throw new Error('FFT library not available');
}

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
console.log('✓ UI Controller initialized');

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
 * Main game loop - advances the simulation and renders to canvas
 */
function gameLoop() {
    // Advance the simulation by one time step
    engine.step(state);
    
    // Render the current state to the canvas
    renderer.draw(state);
    
    // Continue the animation loop
    requestAnimationFrame(gameLoop);
}

// Start the main animation loop
console.log('✓ Starting Milestone 4: Full Interactivity');
console.log('Interactive quantum simulator ready - click and drag to draw barriers!');
gameLoop();
