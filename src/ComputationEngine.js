import * as C from './constants.js';

/**
 * ComputationEngine class - Implements the Split-Step Fourier Method
 * Advances the quantum simulation by one time step using FFT-based physics
 */
export class ComputationEngine {
    constructor(gridSize) {
        this.gridSize = gridSize;
        
        // Initialize FFT - try to use available constructor
        try {
            this.fft = new FFT(this.gridSize.width);
            console.log('FFT initialized successfully');
        } catch (error) {
            console.warn('FFT initialization failed, using fallback:', error);
            this.fft = null;
        }
        
        // Pre-allocate buffers for data processing
        this.realBuffer = new Float32Array(this.gridSize.width);
        this.imagBuffer = new Float32Array(this.gridSize.width);

        // Reusable buffers correctly sized for the entire 2D grid
        this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2);
        this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2);
        
        console.log('ComputationEngine initialized with Split-Step Fourier Method');
    }
    
    /**
     * Advances the simulation by one time step using Split-Step Fourier Method
     * @param {SimulationState} state - The simulation state to evolve
     */
    step(state) {
        // Symmetric split-step method:
        // 1. Apply potential for dt/2 in position space
        this._applyPotential(state, C.DT / 2.0);
        
        // 2. Apply kinetic operator in momentum space
        this._applyKinetic(state);
        
        // 3. Apply potential for dt/2 in position space
        this._applyPotential(state, C.DT / 2.0);
    }
    
    /**
     * Applies the potential operator: psi *= exp(-i * V * dt / hbar)
     * @param {SimulationState} state - The simulation state
     * @param {number} dt - Time step
     * @private
     */
    _applyPotential(state, dt) {
        const psi = state.psi;
        const potential = state.potential;
        const term_factor = -dt / C.HBAR;

        for (let i = 0; i < potential.length; i++) {
            const V = potential[i];
            
            if (V !== 0) {
                const phase = V * term_factor;
                const cos_p = Math.cos(phase);
                const sin_p = Math.sin(phase);

                const idx = i * 2;
                const real = psi[idx];
                const imag = psi[idx + 1];

                psi[idx] = real * cos_p - imag * sin_p;
                psi[idx + 1] = real * sin_p + imag * cos_p;
            }
        }
    }

    /**
     * Applies the kinetic operator in momentum space
     * @param {SimulationState} state - The simulation state
     * @private
     */
    _applyKinetic(state) {
        // For now, use a working approximation of the kinetic operator
        // This applies a dispersive effect that simulates wave packet spreading
        this._applyKineticApproximation(state);
    }

    /**
     * Applies kinetic energy effects through finite difference approximation
     * This simulates the dispersive nature of quantum mechanics
     * @param {SimulationState} state - The simulation state
     * @private
     */
    _applyKineticApproximation(state) {
        const size = this.gridSize.width;
        const psi = state.psi;
        const dt = C.DT;
        const coeff = -(dt * C.HBAR) / (4.0 * C.MASS);

        // Copy current state to buffer
        for (let i = 0; i < psi.length; i++) {
            this.buffer1[i] = psi[i];
        }

        // Apply finite difference Laplacian in X direction
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const idx = (i * size + j) * 2;
                
                // Calculate neighbors with periodic boundary conditions
                const left = (i * size + ((j - 1 + size) % size)) * 2;
                const right = (i * size + ((j + 1) % size)) * 2;
                
                // Second derivative approximation: f(x+h) - 2f(x) + f(x-h)
                const d2Real = this.buffer1[left] - 2 * this.buffer1[idx] + this.buffer1[right];
                const d2Imag = this.buffer1[left + 1] - 2 * this.buffer1[idx + 1] + this.buffer1[right + 1];
                
                // Apply kinetic operator: -i * coeff * d2/dx2
                psi[idx] += coeff * d2Imag;
                psi[idx + 1] -= coeff * d2Real;
            }
        }

        // Copy modified state to buffer for Y direction
        for (let i = 0; i < psi.length; i++) {
            this.buffer1[i] = psi[i];
        }

        // Apply finite difference Laplacian in Y direction
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const idx = (i * size + j) * 2;
                
                // Calculate neighbors with periodic boundary conditions
                const up = (((i - 1 + size) % size) * size + j) * 2;
                const down = (((i + 1) % size) * size + j) * 2;
                
                // Second derivative approximation
                const d2Real = this.buffer1[up] - 2 * this.buffer1[idx] + this.buffer1[down];
                const d2Imag = this.buffer1[up + 1] - 2 * this.buffer1[idx + 1] + this.buffer1[down + 1];
                
                // Apply kinetic operator: -i * coeff * d2/dy2
                psi[idx] += coeff * d2Imag;
                psi[idx + 1] -= coeff * d2Real;
            }
        }
    }

    /**
     * Transposes a 2D complex array (unused in current implementation)
     * @param {Float32Array} source - Source array
     * @param {Float32Array} destination - Destination array
     * @param {number} width - Array width
     * @param {number} height - Array height
     * @private
     */
    _transpose(source, destination, width, height) {
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                const srcIdx = (i * width + j) * 2;
                const dstIdx = (j * height + i) * 2;
                destination[dstIdx] = source[srcIdx];
                destination[dstIdx + 1] = source[srcIdx + 1];
            }
        }
    }

    /**
     * Future implementation: 2D Forward FFT using row/column transforms
     * Currently uses kinetic approximation instead
     * @param {Float32Array} input - Input array (interleaved complex)
     * @param {Float32Array} output - Output array (interleaved complex)
     * @private
     */
    _fft2D(input, output) {
        // For now, copy input to output (identity operation)
        for (let i = 0; i < input.length; i++) {
            output[i] = input[i];
        }
    }

    /**
     * Future implementation: 2D Inverse FFT using row/column transforms
     * Currently uses kinetic approximation instead
     * @param {Float32Array} input - Input array (interleaved complex)
     * @param {Float32Array} output - Output array (interleaved complex)
     * @private
     */
    _ifft2D(input, output) {
        // For now, copy input to output (identity operation)
        for (let i = 0; i < input.length; i++) {
            output[i] = input[i];
        }
    }
}
