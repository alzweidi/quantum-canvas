import * as C from './constants.js';
import { SimulationState } from './SimulationState.js';

/**
 * Main application entry point
 * Initializes the simulation state and provides verification
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

// Calculate and display some basic statistics
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
}

console.log('✓ Milestone 1: The Static State - Successfully initialized');
console.log('Ready for Milestone 2: The Evolving Engine');
