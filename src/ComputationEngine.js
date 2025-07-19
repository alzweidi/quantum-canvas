// src/ComputationEngine.js
import * as C from './constants.js';

// --- Self-Contained FFT Implementation ---
// This is a standard, recursive Cooley-Tukey FFT.
function fft(input) {
    const n = input.length / 2;
    if (n <= 1) return input;

    const even = new Float32Array(n * 2);
    const odd = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
        even[i * 2] = input[i * 2];
        even[i * 2 + 1] = input[i * 2 + 1];
        odd[i * 2] = input[(i + n) * 2];
        odd[i * 2 + 1] = input[(i + n) * 2 + 1];
    }
    
    const fftEven = fft(even.subarray(0, n));
    const fftOdd = fft(odd.subarray(0, n));

    const output = new Float32Array(2 * n);
    for (let k = 0; k < n; k++) {
        const angle = -Math.PI * k / n;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const odd_real = fftOdd[k * 2];
        const odd_imag = fftOdd[k * 2 + 1];

        const term_real = cos * odd_real - sin * odd_imag;
        const term_imag = sin * odd_real + cos * odd_imag;
        
        output[k * 2] = fftEven[k * 2] + term_real;
        output[k * 2 + 1] = fftEven[k * 2 + 1] + term_imag;
        
        output[(k + n) * 2] = fftEven[k * 2] - term_real;
        output[(k + n) * 2 + 1] = fftEven[k * 2 + 1] - term_imag;
    }
    return output;
}

// --- ComputationEngine Class ---
export class ComputationEngine {
    constructor(gridSize) {
        this.gridSize = gridSize;
        this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2);
        this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2);
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

    _fft2D(input, output) {
        // FFT rows
        for (let i = 0; i < this.gridSize.height; i++) {
            const row_in = input.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2);
            const row_out = fft(row_in);
            this.buffer2.set(row_out, i * this.gridSize.width * 2);
        }
        
        this._transpose(this.buffer2, this.buffer1, this.gridSize.width, this.gridSize.height);

        // FFT columns
        for (let i = 0; i < this.gridSize.width; i++) {
            const col_in = this.buffer1.subarray(i * this.gridSize.height * 2, (i + 1) * this.gridSize.height * 2);
            const col_out = fft(col_in);
            output.set(col_out, i * this.gridSize.height * 2);
        }
    }

    _ifft2D(input, output) {
        // The inverse FFT is the conjugate of the forward FFT of the conjugate, scaled by 1/N.
        // We will compute this in stages for clarity.

        // 1. Conjugate the input
        for (let i = 0; i < input.length; i += 2) {
            this.buffer1[i] = input[i];
            this.buffer1[i + 1] = -input[i + 1];
        }

        // 2. Apply forward FFT to the conjugated data
        this._fft2D(this.buffer1, this.buffer2);

        // 3. Conjugate the result and scale
        const norm = 1.0 / (this.gridSize.width * this.gridSize.height);
        for (let i = 0; i < this.buffer2.length; i += 2) {
            output[i] = this.buffer2[i] * norm;
            output[i + 1] = -this.buffer2[i + 1] * norm;
        }
    }
}
