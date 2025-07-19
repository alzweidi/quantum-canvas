// src/ComputationEngine.js
import * as C from './constants.js';

export class ComputationEngine {
    constructor(gridSize) {
        this.gridSize = gridSize;
        // Use the available FFT constructor
        this.fft = new FFT(this.gridSize.width);

        this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2);
        this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2);

        // Buffers for data format conversion
        this.real = new Float32Array(this.gridSize.width);
        this.imag = new Float32Array(this.gridSize.width);

        console.log('ComputationEngine initialized with DSP.js FFT implementation');
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
            const kineticEnergy = state.kineticOperatorK[i];
            const phase = -kineticEnergy * C.DT / C.HBAR;
            
            const real = this.buffer1[i];
            const imag = this.buffer1[i + 1];
            const cosPhase = Math.cos(phase);
            const sinPhase = Math.sin(phase);

            this.buffer1[i] = real * cosPhase - imag * sinPhase;
            this.buffer1[i + 1] = real * sinPhase + imag * cosPhase;
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
            const col_out = output.subarray(i * this.gridSize.width * 2, (i + 1) * this.gridSize.width * 2);
            this._ifftRow(col_in, col_out);
        }

        // CRITICAL: APPLY FINAL NORMALIZATION
        const norm = 1.0 / (this.gridSize.width * this.gridSize.height);
        for (let i = 0; i < output.length; i++) {
            output[i] *= norm;
        }
    }

    _fftRow(input, output) {
        // 1. Unpack the 'input' (interleaved) into 'this.real' and 'this.imag' arrays.
        const size = input.length / 2;
        for (let i = 0; i < size; i++) {
            this.real[i] = input[i * 2];
            this.imag[i] = input[i * 2 + 1];
        }

        // 2. Call the forward FFT: this.fft.forward(this.real, this.imag).
        this.fft.forward(this.real, this.imag);

        // 3. The results are now in this.fft.real and this.fft.imag.
        // 4. Pack the results from this.fft.real and this.fft.imag back into the 'output' (interleaved) array.
        for (let i = 0; i < size; i++) {
            output[i * 2] = this.fft.real[i];
            output[i * 2 + 1] = this.fft.imag[i];
        }
    }

    _ifftRow(input, output) {
        // 1. Unpack the 'input' (interleaved) into 'this.real' and 'this.imag' arrays.
        const size = input.length / 2;
        for (let i = 0; i < size; i++) {
            this.real[i] = input[i * 2];
            this.imag[i] = input[i * 2 + 1];
        }

        // 2. Call the inverse FFT: this.fft.inverse(this.real, this.imag).
        this.fft.inverse(this.real, this.imag);

        // 3. The results are now in this.fft.real and this.fft.imag.
        // 4. Pack the results from this.fft.real and this.fft.imag back into the 'output' (interleaved) array.
        for (let i = 0; i < size; i++) {
            output[i * 2] = this.fft.real[i];
            output[i * 2 + 1] = this.fft.imag[i];
        }
    }
}
