import * as C from './constants.js';
import { fft, ifft } from './fft.js';

/**
 * computation engine class - executes quantum physics simulation time steps
 * implements the Split-Step Fourier Method for solving the time-dependent Schrödinger equation
 */
export class ComputationEngine {
    /**
     * initialise the computation engine with necessary buffers and FFT workspace
     * @param {Object} gridSize - grid dimensions with width and height properties
     */
    constructor(gridSize) {
        this.gridSize = gridSize;
        this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2);
        this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2);

        // buffers for data format conversion for a single row/column
        this.real = new Float32Array(this.gridSize.width);
        this.imag = new Float32Array(this.gridSize.width);
    }

    /**
     * execute one time step of the quantum simulation using Split-Step Fourier Method
     * applies V/2 → T → V/2 sequence for accurate time evolution
     * @param {SimulationState} state - the simulation state to advance
     */
    step(state) {
        this._applyPotential(state, state.params.dt / 2.0);
        this._applyKinetic(state);
        this._applyPotential(state, state.params.dt / 2.0);
        
        // fixed: apply absorbing boundaries to prevent wrapping
        state._applyAbsorbingBoundaries();
    }
    
    /**
     * apply potential operator to wave function in position space
     * multiplies by exp(-iV*dt/ℏ) for each grid point
     * @param {SimulationState} state - the simulation state
     * @param {number} dt - time step for this potential application
     * @private
     */
    _applyPotential(state, dt) {
        const psi = state.psi;
        const potential = state.potential;
        const term_factor = -dt / C.HBAR;

        for (let i = 0; i < potential.length; i++) {
            // eslint-disable-next-line id-length -- V is standard physics notation for potential energy
            const V = potential[i];
            if (V === 0) continue;
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

    /**
     * apply kinetic operator to wave function in momentum space
     * transforms to k-space, applies exp(-iT*dt/ℏ), then transforms back
     * @param {SimulationState} state - the simulation state
     * @private
     */
    _applyKinetic(state) {
        // 1. transform to momentum space
        this._fft2D(state.psi, this.buffer1);

        // 2. apply the kinetic operator with correct quantum time evolution
        for (let i = 0; i < this.buffer1.length; i += 2) {
            // get the kinetic energy T(k) from the pre-calculated array
            // eslint-disable-next-line id-length -- T is standard physics notation for kinetic energy
            const T = state.kineticOperatorK[i];
            
            // calculate the phase rotation: phi = -T * dt / hbar
            const phase = -T * state.params.dt / C.HBAR;
            const cosP = Math.cos(phase);
            const sinP = Math.sin(phase);
            
            // apply the rotation: psi' = psi * exp(i*phi)
            const psi_r = this.buffer1[i];
            const psi_i = this.buffer1[i + 1];
            this.buffer1[i] = psi_r * cosP - psi_i * sinP;
            this.buffer1[i + 1] = psi_r * sinP + psi_i * cosP;
        }

        // 3. transform back to position space
        this._ifft2D(this.buffer1, state.psi);
    }

    /**
     * transpose a 2D complex array for efficient FFT computation
     * @param {Float32Array} source - source array to transpose
     * @param {Float32Array} destination - destination array for result
     * @param {number} width - width of the 2D array
     * @param {number} height - height of the 2D array
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
     * perform FFT on a single row of interleaved complex data
     * @param {Float32Array} input - interleaved complex input array
     * @param {Float32Array} output - interleaved complex output array
     * @private
     */
    _fftRow(input, output) {
        const size = input.length / 2;
        for (let i = 0; i < size; i++) {
            this.real[i] = input[i * 2];
            this.imag[i] = input[i * 2 + 1];
        }
        fft(this.real, this.imag);
        for (let i = 0; i < size; i++) {
            output[i * 2] = this.real[i];
            output[i * 2 + 1] = this.imag[i];
        }
    }

    /**
     * perform inverse FFT on a single row of interleaved complex data
     * @param {Float32Array} input - interleaved complex input array
     * @param {Float32Array} output - interleaved complex output array
     * @private
     */
    _ifftRow(input, output) {
        const size = input.length / 2;
        for (let i = 0; i < size; i++) {
            this.real[i] = input[i * 2];
            this.imag[i] = input[i * 2 + 1];
        }
        ifft(this.real, this.imag);
        for (let i = 0; i < size; i++) {
            output[i * 2] = this.real[i];
            output[i * 2 + 1] = this.imag[i];
        }
    }
    
    /**
     * perform 2D FFT using row-column decomposition
     * @param {Float32Array} input - input 2D array as interleaved complex
     * @param {Float32Array} output - output 2D array as interleaved complex
     * @private
     */
    _fft2D(input, output) {
        for (let i = 0; i < this.gridSize.height; i++) {
            const row_in = input.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2);
            this._fftRow(row_in, this.buffer2.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2));
        }
        this._transpose(this.buffer2, this.buffer1, this.gridSize.width, this.gridSize.height);
        for (let i = 0; i < this.gridSize.width; i++) {
            const col_in = this.buffer1.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2);
            this._fftRow(col_in, output.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2));
        }
    }

    /**
     * perform 2D inverse FFT using row-column decomposition
     * @param {Float32Array} input - input 2D array as interleaved complex
     * @param {Float32Array} output - output 2D array as interleaved complex
     * @private
     */
    _ifft2D(input, output) {
        for (let i = 0; i < this.gridSize.width; i++) {
            const row_in = input.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2);
            this._ifftRow(row_in, this.buffer1.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2));
        }
        this._transpose(this.buffer1, this.buffer2, this.gridSize.height, this.gridSize.width);
        for (let i = 0; i < this.gridSize.height; i++) {
            const col_in = this.buffer2.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2);
            this._ifftRow(col_in, output.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2));
        }
    }
}
