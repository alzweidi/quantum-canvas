// A robust, iterative Cooley-Tukey FFT implementation
// Operates in-place on interleaved Float32Arrays for maximum performance.
export function fft(real, imag) {
    const n = real.length;
    if (n === 0) return;

    // Bit-reversal permutation
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1;
        for (; (j & bit) !== 0; bit >>= 1) {
            j ^= bit;
        }
        j ^= bit;
        if (i < j) {
            [real[i], real[j]] = [real[j], real[i]];
            [imag[i], imag[j]] = [imag[j], imag[i]];
        }
    }

    // Cooley-Tukey FFT
    for (let len = 2; len <= n; len <<= 1) {
        const halfLen = len >> 1;
        const angle = -Math.PI / halfLen;
        const w_real = Math.cos(angle);
        const w_imag = Math.sin(angle);
        for (let i = 0; i < n; i += len) {
            let t_real = 1;
            let t_imag = 0;
            for (let j = 0; j < halfLen; j++) {
                const a_real = real[i + j];
                const a_imag = imag[i + j];
                const b_real = real[i + j + halfLen] * t_real - imag[i + j + halfLen] * t_imag;
                const b_imag = real[i + j + halfLen] * t_imag + imag[i + j + halfLen] * t_real;
                real[i + j] = a_real + b_real;
                imag[i + j] = a_imag + b_imag;
                real[i + j + halfLen] = a_real - b_real;
                imag[i + j + halfLen] = a_imag - b_imag;
                [t_real, t_imag] = [t_real * w_real - t_imag * w_imag, t_real * w_imag + t_imag * w_real];
            }
        }
    }
}

export function ifft(real, imag) {
    // IFFT is the conjugate of the FFT of the conjugate (no automatic scaling)
    for (let i = 0; i < imag.length; i++) {
        imag[i] = -imag[i];
    }
    fft(real, imag);
    for (let i = 0; i < real.length; i++) {
        imag[i] = -imag[i];
    }
}
