import * as C from "./constants.js";
import { fft, ifft } from "./fft.js";

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
    // safety: validate grid dimensions
    this._validateGridDimensions(gridSize);

    this.gridSize = gridSize;
    this.buffer1 = new Float64Array(gridSize.width * gridSize.height * 2);
    this.buffer2 = new Float64Array(gridSize.width * gridSize.height * 2);

    // fixed-size work buffers for rows and columns
    this.rowReal = new Float64Array(this.gridSize.width);
    this.rowImag = new Float64Array(this.gridSize.width);
    this.colReal = new Float64Array(this.gridSize.height);
    this.colImag = new Float64Array(this.gridSize.height);
  }

  /**
   * validate grid dimensions for FFT compatibility
   * @param {Object} gridSize - grid dimensions with width and height properties
   * @private
   */
  _validateGridDimensions(gridSize) {
    if (
      !gridSize ||
      typeof gridSize.width !== "number" ||
      typeof gridSize.height !== "number"
    ) {
      throw new Error(
        "Invalid grid dimensions: must have numeric width and height",
      );
    }

    if (gridSize.width <= 0 || gridSize.height <= 0) {
      throw new Error(
        `Invalid grid dimensions: width=${gridSize.width}, height=${gridSize.height} - must be positive`,
      );
    }

    if (
      !Number.isInteger(gridSize.width) ||
      !Number.isInteger(gridSize.height)
    ) {
      throw new Error(
        `Invalid grid dimensions: width=${gridSize.width}, height=${gridSize.height} - must be integers`,
      );
    }

    // check if dimensions are powers of 2 (optimal for FFT)
    const isPowerOf2 = (n) => n > 0 && (n & (n - 1)) === 0;
    if (!isPowerOf2(gridSize.width) || !isPowerOf2(gridSize.height)) {
      console.warn(
        `[WARNING] Grid dimensions ${gridSize.width}x${gridSize.height} are not powers of 2. FFT performance may be suboptimal.`,
      );
    }
  }

  /**
   * execute one time step of the quantum simulation using Split-Step Fourier Method
   * applies V/2 → T → V/2 sequence for accurate time evolution
   * @param {SimulationState} state - the simulation state to advance
   */
  step(state) {
    this._applyPotential(state); // V/2
    this._applyKinetic(state); // T
    this._applyPotential(state); // V/2

    // apply absorbing boundaries only after complete strang splitting
    // to preserve time-reversibility and second-order accuracy
    state._applyAbsorbingBoundaries();
  }

  /**
   * apply potential operator to wave function in position space
   * applies exp(-i*V*dt/(2*ℏ)) for each grid point using true potential energy V
   * implements half-step potential kick for Strang splitting
   * @param {SimulationState} state - the simulation state
   * @private
   */
  _applyPotential(state) {
    const psi = state.psi;
    const potential = state.potential;
    const dt = state.params.dt;

    for (let i = 0; i < potential.length; i++) {
      const V = potential[i]; // V is the true potential energy
      if (V === 0) continue;

      // calculate phase for half-step: φ = -V * dt / (2 * ℏ)
      const phase = (-V * dt) / (2 * C.HBAR);
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
    // defensive safety: verify kinetic operator array matches grid dimensions
    if (
      state.kineticOperatorK.length !==
      this.gridSize.width * this.gridSize.height
    ) {
      throw new Error("kineticOperatorK size mismatch");
    }

    // 1. transform to momentum space
    this._fft2D(state.psi, this.buffer1);

    // 2. apply the kinetic operator with correct quantum time evolution
    for (let i = 0; i < this.buffer1.length; i += 2) {
      // get the kinetic energy T(k) from the pre-calculated real-only array
      // i/2 converts from complex buffer index to real kinetic operator index
      // eslint-disable-next-line id-length -- T is standard physics notation for kinetic energy
      const T = state.kineticOperatorK[i / 2];
      // calculate the phase rotation: phi = -T * dt / hbar
      const phase = (-T * state.params.dt) / C.HBAR;
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
   * sub-pixel spatial shift: ψ(x,y) ← F^{-1}{ e^{i(kx*dx + ky*dy)} F{ψ} }.
   * dxPhysical, dyPhysical are in the same physical units as DOMAIN_SIZE.
   * @param {SimulationState} state - the simulation state containing wave function
   * @param {number} dxPhysical - horizontal shift in physical units (same as DOMAIN_SIZE)
   * @param {number} dyPhysical - vertical shift in physical units (same as DOMAIN_SIZE)
   */
  shiftWaveFunctionSubpixel(state, dxPhysical, dyPhysical) {
    const W = this.gridSize.width;
    const H = this.gridSize.height;
    const dx = C.DOMAIN_SIZE / W;
    const dy = C.DOMAIN_SIZE / H;
    const dkx = (2.0 * Math.PI) / (W * dx);
    const dky = (2.0 * Math.PI) / (H * dy);

    // 1) FFT ψ → buffer1
    this._fft2D(state.psi, this.buffer1);

    // 2) multiply by e^{i(kx*dx + ky*dy)} in k-space (canonical row-major layout)
    for (let y = 0; y < H; y++) {
      const ky = y < H / 2 ? y * dky : (y - H) * dky;
      for (let x = 0; x < W; x++) {
        const kx = x < W / 2 ? x * dkx : (x - W) * dkx;
        const phase = kx * dxPhysical + ky * dyPhysical;
        const c = Math.cos(phase);
        const s = Math.sin(phase);
        const idx = (y * W + x) * 2;
        const re = this.buffer1[idx];
        const im = this.buffer1[idx + 1];
        this.buffer1[idx] = re * c - im * s;
        this.buffer1[idx + 1] = re * s + im * c;
      }
    }

    // 3) IFFT → ψ
    this._ifft2D(this.buffer1, state.psi);
  }

  /**
   * perform FFT on a single row of interleaved complex data
   * @param {Float64Array} input - interleaved complex input array
   * @param {Float64Array} output - interleaved complex output array
   * @private
   */
  _fftRow(input, output) {
    const size = input.length / 2; // == width
    const real = this.rowReal;
    const imag = this.rowImag;
    for (let i = 0; i < size; i++) {
      real[i] = input[2 * i];
      imag[i] = input[2 * i + 1];
    }
    fft(real, imag); // length == width
    for (let i = 0; i < size; i++) {
      output[2 * i] = real[i];
      output[2 * i + 1] = imag[i];
    }
  }

  /**
   * perform inverse FFT on a single row of interleaved complex data
   * @param {Float64Array} input - interleaved complex input array
   * @param {Float64Array} output - interleaved complex output array
   * @private
   */
  _ifftRow(input, output) {
    const size = input.length / 2; // == width
    const real = this.rowReal;
    const imag = this.rowImag;
    for (let i = 0; i < size; i++) {
      real[i] = input[2 * i];
      imag[i] = input[2 * i + 1];
    }
    ifft(real, imag); // length == width
    for (let i = 0; i < size; i++) {
      output[2 * i] = real[i];
      output[2 * i + 1] = imag[i];
    }
  }

  /**
   * perform 2D FFT using row-column decomposition with proper buffer management
   * @param {Float64Array} input - input 2D array as interleaved complex
   * @param {Float64Array} output - output 2D array as interleaved complex
   * @private
   */
  _fft2D(input, output) {
    if (input.length !== this.gridSize.width * this.gridSize.height * 2) {
      throw new Error(
        "FFT called with buffer size inconsistent with engine gridSize",
      );
    }
    const W = this.gridSize.width;
    const H = this.gridSize.height;

    // 1) row FFTs: transform each row in place
    for (let y = 0; y < H; y++) {
      const rowIn = input.subarray(y * W * 2, (y + 1) * W * 2);
      const rowOut = this.buffer1.subarray(y * W * 2, (y + 1) * W * 2);
      this._fftRow(rowIn, rowOut);
    }

    // 2) column FFTs: for each column, extract to temp buffer, FFT, then put back
    const colReal = this.colReal; // length == height
    const colImag = this.colImag;

    for (let x = 0; x < W; x++) {
      // extract column x into temp arrays
      for (let y = 0; y < H; y++) {
        const idx = y * W + x;
        colReal[y] = this.buffer1[idx * 2];
        colImag[y] = this.buffer1[idx * 2 + 1];
      }

      // FFT the column with correct size
      fft(colReal, colImag);

      // put the result back
      for (let y = 0; y < H; y++) {
        const idx = y * W + x;
        output[idx * 2] = colReal[y];
        output[idx * 2 + 1] = colImag[y];
      }
    }
  }

  /**
   * perform 2D inverse FFT using row-column decomposition with proper buffer management
   * @param {Float64Array} input - input 2D array as interleaved complex
   * @param {Float64Array} output - output 2D array as interleaved complex
   * @private
   */
  _ifft2D(input, output) {
    if (input.length !== this.gridSize.width * this.gridSize.height * 2) {
      throw new Error(
        "IFFT called with buffer size inconsistent with engine gridSize",
      );
    }
    const W = this.gridSize.width;
    const H = this.gridSize.height;

    // 1) row IFFTs: transform each row in place
    for (let y = 0; y < H; y++) {
      const rowIn = input.subarray(y * W * 2, (y + 1) * W * 2);
      const rowOut = this.buffer1.subarray(y * W * 2, (y + 1) * W * 2);
      this._ifftRow(rowIn, rowOut);
    }

    // 2) column IFFTs: for each column, extract to temp buffer, IFFT, then put back
    const colReal = this.colReal; // length == height
    const colImag = this.colImag;

    for (let x = 0; x < W; x++) {
      // extract column x into temp arrays
      for (let y = 0; y < H; y++) {
        const idx = y * W + x;
        colReal[y] = this.buffer1[idx * 2];
        colImag[y] = this.buffer1[idx * 2 + 1];
      }

      // IFFT the column with correct size
      ifft(colReal, colImag);

      // put the result back
      for (let y = 0; y < H; y++) {
        const idx = y * W + x;
        output[idx * 2] = colReal[y];
        output[idx * 2 + 1] = colImag[y];
      }
    }
  }
}
