// src/ComputationEngine.js
import * as C from './constants.js';
import { fft, ifft } from './fft.js';

export class ComputationEngine {
    constructor(gridSize) {
        this.gridSize = gridSize;
        this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2);
        this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2);

        // Buffers for data format conversion for a single row/column
        this.real = new Float32Array(this.gridSize.width);
        this.imag = new Float32Array(this.gridSize.width);
        
        console.log('ComputationEngine initialized with robust self-contained FFT');
    }

    step(state) {
        this._applyPotential(state, C.DT / 2.0);
        this._applyKinetic(state);
        this._applyPotential(state, C.DT / 2.0);
    }
    
    _applyPotential(state, dt) {
        const psi = state.psi;
        const potential = state.potential;
        const term_factor = -dt / C.HBAR;

        for (let i = 0; i < potential.length; i++) {
            const V = potential[i];
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

    _applyKinetic(state) {
        this._fft2D(state.psi, this.buffer1);

        for (let i = 0; i < this.buffer1.length; i += 2) {
            const op_real = state.kineticOperatorK[i];
            const op_imag = state.kineticOperatorK[i + 1];
            const psi_real = this.buffer1[i];
            const psi_imag = this.buffer1[i + 1];
            this.buffer1[i] = psi_real * op_real - psi_imag * op_imag;
            this.buffer1[i + 1] = psi_real * op_imag + psi_imag * op_real;
        }

        this._ifft2D(this.buffer1, state.psi);
    }

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

    // --- The new, simplified FFT interface ---

    _fftRow(input, output) {
        const size = input.length / 2;
        for (let i = 0; i < size; i++) {
            this.real[i] = input[i * 2];
            this.imag[i] = input[i * 2 + 1];
        }
        fft(this.real, this.imag); // Call the new self-contained FFT
        for (let i = 0; i < size; i++) {
            output[i * 2] = this.real[i];
            output[i * 2 + 1] = this.imag[i];
        }
    }

    _ifftRow(input, output) {
        const size = input.length / 2;
        for (let i = 0; i < size; i++) {
            this.real[i] = input[i * 2];
            this.imag[i] = input[i * 2 + 1];
        }
        ifft(this.real, this.imag); // Call the new self-contained IFFT
        for (let i = 0; i < size; i++) {
            output[i * 2] = this.real[i];
            output[i * 2 + 1] = this.imag[i];
        }
    }
    
    // --- The 2D Orchestration ---
    _fft2D(input, output) {
        // FFT rows
        for (let i = 0; i < this.gridSize.height; i++) {
            const row_in = input.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2);
            this._fftRow(row_in, this.buffer2.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2));
        }
        
        this._transpose(this.buffer2, this.buffer1, this.gridSize.width, this.gridSize.height);

        // FFT columns
        for (let i = 0; i < this.gridSize.width; i++) {
            const col_in = this.buffer1.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2);
            this._fftRow(col_in, output.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2));
        }
    }

    _ifft2D(input, output) {
        // Inverse FFT rows
        for (let i = 0; i < this.gridSize.width; i++) {
            const row_in = input.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2);
            this._ifftRow(row_in, this.buffer1.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2));
        }

        this._transpose(this.buffer1, this.buffer2, this.gridSize.height, this.gridSize.width);

        // Inverse FFT columns
        for (let i = 0; i < this.gridSize.height; i++) {
            const col_in = this.buffer2.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2);
            this._ifftRow(col_in, output.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2));
        }
        // The redundant normalization loop has been removed from here.
    }
}
