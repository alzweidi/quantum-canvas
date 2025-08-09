/**
 * simple, bulletproof FFT implementation
 * uses the most straightforward approach to avoid any subtle bugs
 * performs an in-place Fast Fourier Transform on separate real and imaginary arrays
 * @param {Float64Array} real - array of real components (modified in-place)
 * @param {Float64Array} imag - array of imaginary components (modified in-place)
 */
export function fft(real, imag) {
  if (imag.length !== real.length) {
    throw new Error(
      `FFT: real/imag length mismatch (real=${real.length}, imag=${imag.length})`,
    );
  }
  const n = real.length;
  if (n <= 1) return;

  // validate that input size is a power of 2
  if (!Number.isInteger(Math.log2(n))) {
    throw new Error(
      `FFT requires input size to be a power of 2, but got ${n}. Valid sizes: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, etc.`,
    );
  }

  // bit-reverse the input
  const bitCount = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let j = 0;
    let temp = i;
    for (let k = 0; k < bitCount; k++) {
      j = (j << 1) | (temp & 1);
      temp >>= 1;
    }
    if (j > i) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  // cooley-tukey FFT with precomputed twiddle factors per stage
  // hoist twiddle arrays outside loop to reduce GC churn
  let twReal = new Float64Array(1);
  let twImag = new Float64Array(1);
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >>> 1;
    if (twReal.length < halfLen) {
      twReal = new Float64Array(halfLen);
      twImag = new Float64Array(halfLen);
    }
    const base = (-2 * Math.PI) / len;
    for (let j = 0; j < halfLen; j++) {
      const a = base * j;
      twReal[j] = Math.cos(a);
      twImag[j] = Math.sin(a);
    }
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < halfLen; j++) {
        // eslint-disable-next-line id-length -- wReal/wImag are standard DSP notation for twiddle factors
        const wReal = twReal[j];
        // eslint-disable-next-line id-length -- wReal/wImag are standard DSP notation for twiddle factors
        const wImag = twImag[j];

        // eslint-disable-next-line id-length -- u/v are standard FFT butterfly operation indices
        const u = i + j;
        // eslint-disable-next-line id-length -- u/v are standard FFT butterfly operation indices
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
 * inverse Fast Fourier Transform implementation
 * performs an in-place inverse FFT using the conjugate method with proper normalization
 * @param {Float64Array} real - array of real components (modified in-place)
 * @param {Float64Array} imag - array of imaginary components (modified in-place)
 */
export function ifft(real, imag) {
  if (imag.length !== real.length) {
    throw new Error(
      `IFFT: real/imag length mismatch (real=${real.length}, imag=${imag.length})`,
    );
  }
  const n = real.length;
  if (n <= 1) return;

  // validate that input size is a power of 2
  if (!Number.isInteger(Math.log2(n))) {
    throw new Error(
      `IFFT requires input size to be a power of 2, but got ${n}. Valid sizes: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, etc.`,
    );
  }

  // conjugate input
  for (let i = 0; i < n; i++) {
    imag[i] = -imag[i];
  }

  // forward FFT
  fft(real, imag);

  // conjugate output and normalize
  for (let i = 0; i < n; i++) {
    real[i] = real[i] / n;
    imag[i] = -imag[i] / n;
  }
}
