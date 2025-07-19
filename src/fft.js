/**
 * Simple, bulletproof FFT implementation
 * Uses the most straightforward approach to avoid any subtle bugs
 * Performs an in-place Fast Fourier Transform on separate real and imaginary arrays
 * @param {Float32Array} real - Array of real components (modified in-place)
 * @param {Float32Array} imag - Array of imaginary components (modified in-place)
 */
export function fft(real, imag) {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reverse the input
  for (let i = 0; i < n; i++) {
    let j = 0;
    let temp = i;
    for (let k = 0; k < Math.log2(n); k++) {
      j = (j << 1) | (temp & 1);
      temp >>= 1;
    }
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // Cooley-Tukey FFT
  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2;
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < halfLen; j++) {
        const angle = (-2 * Math.PI * j) / len;
        const wReal = Math.cos(angle);
        const wImag = Math.sin(angle);

        const u = i + j;
        const v = i + j + halfLen;

        const tReal = real[v] * wReal - imag[v] * wImag;
        const tImag = real[v] * wImag + imag[v] * wReal;

        real[v] = real[u] - tReal;
        imag[v] = imag[u] - tImag;
        real[u] = real[u] + tReal;
        imag[u] = imag[u] + tImag;
      }
    }
  }
}

/**
 * Inverse Fast Fourier Transform implementation
 * Performs an in-place inverse FFT using the conjugate method with proper normalization
 * @param {Float32Array} real - Array of real components (modified in-place)
 * @param {Float32Array} imag - Array of imaginary components (modified in-place)
 */
export function ifft(real, imag) {
  const n = real.length;

  // Conjugate input
  for (let i = 0; i < n; i++) {
    imag[i] = -imag[i];
  }

  // Forward FFT
  fft(real, imag);

  // Conjugate output and normalize
  for (let i = 0; i < n; i++) {
    real[i] = real[i] / n;
    imag[i] = -imag[i] / n;
  }
}
