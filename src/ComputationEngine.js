import * as C from './constants.js'
import { fft, ifft } from './fft.js'

/**
 * computation engine class - executes quantum physics simulation time steps
 * implements the Split-Step Fourier Method for solving the time-dependent Schrödinger equation
 */
export class ComputationEngine {
  /**
   * initialise the computation engine with necessary buffers and FFT workspace
   * @param {Object} gridSize - grid dimensions with width and height properties
   */
  constructor (gridSize) {
    // safety: validate grid dimensions
    this._validateGridDimensions(gridSize)

    this.gridSize = gridSize
    this.buffer1 = new Float32Array(gridSize.width * gridSize.height * 2)
    this.buffer2 = new Float32Array(gridSize.width * gridSize.height * 2)

    // fix: buffers for data format conversion must handle both row and column processing
    // need max(width, height) to handle both row FFTs (width) and column FFTs (height)
    const maxDimension = Math.max(this.gridSize.width, this.gridSize.height)
    this.real = new Float32Array(maxDimension)
    this.imag = new Float32Array(maxDimension)
  }

  /**
   * validate grid dimensions for FFT compatibility
   * @param {Object} gridSize - grid dimensions with width and height properties
   * @private
   */
  _validateGridDimensions (gridSize) {
    if (
      !gridSize ||
      typeof gridSize.width !== 'number' ||
      typeof gridSize.height !== 'number'
    ) {
      throw new Error(
        'Invalid grid dimensions: must have numeric width and height'
      )
    }

    if (gridSize.width <= 0 || gridSize.height <= 0) {
      throw new Error(
        `Invalid grid dimensions: width=${gridSize.width}, height=${gridSize.height} - must be positive`
      )
    }

    if (
      !Number.isInteger(gridSize.width) ||
      !Number.isInteger(gridSize.height)
    ) {
      throw new Error(
        `Invalid grid dimensions: width=${gridSize.width}, height=${gridSize.height} - must be integers`
      )
    }

    // check if dimensions are powers of 2 (optimal for FFT)
    const isPowerOf2 = (n) => n > 0 && (n & (n - 1)) === 0
    if (!isPowerOf2(gridSize.width) || !isPowerOf2(gridSize.height)) {
      console.warn(
        `[WARNING] Grid dimensions ${gridSize.width}x${gridSize.height} are not powers of 2. FFT performance may be suboptimal.`
      )
    }
  }

  /**
   * execute one time step of the quantum simulation using Split-Step Fourier Method
   * applies V/2 → T → V/2 sequence for accurate time evolution
   * @param {SimulationState} state - the simulation state to advance
   */
  step (state) {
    this._applyPotential(state, state.params.dt / 2.0)

    // fixed a BUG: applied absorbing boundaries BEFORE kinetic evolution
    // which prevents wrap artifacts during FFT-based kinetic step in k-space
    // thank you to the dream i had last night
    state._applyAbsorbingBoundaries()

    this._applyKinetic(state)
    this._applyPotential(state, state.params.dt / 2.0)

    // keep post-step absorption for additional safety
    state._applyAbsorbingBoundaries()
  }

  /**
   * apply potential operator to wave function in position space
   * multiplies by exp(-iV*dt/ℏ) for each grid point
   * @param {SimulationState} state - the simulation state
   * @param {number} dt - time step for this potential application
   * @private
   */
  _applyPotential (state, dt) {
    const psi = state.psi
    const potential = state.potential
    const term_factor = -dt / C.HBAR

    for (let i = 0; i < potential.length; i++) {
      // eslint-disable-next-line id-length -- V is standard physics notation for potential energy
      const V = potential[i]
      if (V === 0) continue
      const phase = V * term_factor
      const cos_p = Math.cos(phase)
      const sin_p = Math.sin(phase)

      const idx = i * 2
      const real = psi[idx]
      const imag = psi[idx + 1]

      psi[idx] = real * cos_p - imag * sin_p
      psi[idx + 1] = real * sin_p + imag * cos_p
    }
  }

  /**
   * apply kinetic operator to wave function in momentum space
   * transforms to k-space, applies exp(-iT*dt/ℏ), then transforms back
   * @param {SimulationState} state - the simulation state
   * @private
   */
  _applyKinetic (state) {
    // 1. transform to momentum space
    this._fft2D(state.psi, this.buffer1)

    // 2. apply the kinetic operator with correct quantum time evolution
    for (let i = 0; i < this.buffer1.length; i += 2) {
      // get the kinetic energy T(k) from the pre-calculated array
      // eslint-disable-next-line id-length -- T is standard physics notation for kinetic energy
      const T = state.kineticOperatorK[i]

      // calculate the phase rotation: phi = -T * dt / hbar
      const phase = (-T * state.params.dt) / C.HBAR
      const cosP = Math.cos(phase)
      const sinP = Math.sin(phase)

      // apply the rotation: psi' = psi * exp(i*phi)
      const psi_r = this.buffer1[i]
      const psi_i = this.buffer1[i + 1]
      this.buffer1[i] = psi_r * cosP - psi_i * sinP
      this.buffer1[i + 1] = psi_r * sinP + psi_i * cosP
    }

    // 3. transform back to position space
    this._ifft2D(this.buffer1, state.psi)
  }

  /**
   * transpose a 2D complex array for efficient FFT computation
   * @param {Float32Array} source - source array to transpose
   * @param {Float32Array} destination - destination array for result
   * @param {number} width - width of the 2D array
   * @param {number} height - height of the 2D array
   * @private
   */
  _transpose (source, destination, width, height) {
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        const srcIdx = (i * width + j) * 2
        const dstIdx = (j * height + i) * 2
        destination[dstIdx] = source[srcIdx]
        destination[dstIdx + 1] = source[srcIdx + 1]
      }
    }
  }

  /**
   * perform FFT on a single row of interleaved complex data
   * @param {Float32Array} input - interleaved complex input array
   * @param {Float32Array} output - interleaved complex output array
   * @private
   */
  _fftRow (input, output) {
    const size = input.length / 2
    for (let i = 0; i < size; i++) {
      this.real[i] = input[i * 2]
      this.imag[i] = input[i * 2 + 1]
    }
    fft(this.real, this.imag)
    for (let i = 0; i < size; i++) {
      output[i * 2] = this.real[i]
      output[i * 2 + 1] = this.imag[i]
    }
  }

  /**
   * perform inverse FFT on a single row of interleaved complex data
   * @param {Float32Array} input - interleaved complex input array
   * @param {Float32Array} output - interleaved complex output array
   * @private
   */
  _ifftRow (input, output) {
    const size = input.length / 2
    for (let i = 0; i < size; i++) {
      this.real[i] = input[i * 2]
      this.imag[i] = input[i * 2 + 1]
    }
    ifft(this.real, this.imag)
    for (let i = 0; i < size; i++) {
      output[i * 2] = this.real[i]
      output[i * 2 + 1] = this.imag[i]
    }
  }

  /**
   * perform 2D FFT using symmetric row-column decomposition
   * @param {Float32Array} input - input 2D array as interleaved complex
   * @param {Float32Array} output - output 2D array as interleaved complex
   * @private
   */
  _fft2D (input, output) {
    // step 1: row FFTs (height rows, each of width elements)
    for (let i = 0; i < this.gridSize.height; i++) {
      const row_in = input.subarray(
        i * this.gridSize.width * 2,
        (i + 1) * this.gridSize.width * 2
      )
      this._fftRow(
        row_in,
        this.buffer2.subarray(
          i * this.gridSize.width * 2,
          (i + 1) * this.gridSize.width * 2
        )
      )
    }

    // step 2: transpose to prepare for column FFTs
    this._transpose(
      this.buffer2,
      this.buffer1,
      this.gridSize.width,
      this.gridSize.height
    )

    // step 3: column FFTs (width columns, each of height elements)
    for (let i = 0; i < this.gridSize.width; i++) {
      const col_in = this.buffer1.subarray(
        i * this.gridSize.height * 2,
        (i + 1) * this.gridSize.height * 2
      )
      this._fftRow(
        col_in,
        this.buffer2.subarray(
          i * this.gridSize.height * 2,
          (i + 1) * this.gridSize.height * 2
        )
      )
    }

    // copy result to output (buffer2 contains transposed result)
    for (let i = 0; i < this.gridSize.width * this.gridSize.height * 2; i++) {
      output[i] = this.buffer2[i]
    }
  }

  /**
   * perform 2D inverse FFT using symmetric row-column decomposition
   * @param {Float32Array} input - input 2D array as interleaved complex
   * @param {Float32Array} output - output 2D array as interleaved complex
   * @private
   */
  _ifft2D (input, output) {
    // fixed: use identical symmetric pattern to _fft2D
    // step 1: column IFFTs (width columns, each of height elements)
    for (let i = 0; i < this.gridSize.width; i++) {
      const col_in = input.subarray(
        i * this.gridSize.height * 2,
        (i + 1) * this.gridSize.height * 2
      )
      this._ifftRow(
        col_in,
        this.buffer1.subarray(
          i * this.gridSize.height * 2,
          (i + 1) * this.gridSize.height * 2
        )
      )
    }

    // step 2: transpose to prepare for row IFFTs
    this._transpose(
      this.buffer1,
      this.buffer2,
      this.gridSize.height,
      this.gridSize.width
    )

    // step 3: row IFFTs (height rows, each of width elements)
    for (let i = 0; i < this.gridSize.height; i++) {
      const row_in = this.buffer2.subarray(
        i * this.gridSize.width * 2,
        (i + 1) * this.gridSize.width * 2
      )
      this._ifftRow(
        row_in,
        output.subarray(
          i * this.gridSize.width * 2,
          (i + 1) * this.gridSize.width * 2
        )
      )
    }
  }

  /**
   * test round-trip accuracy for non-square grids with impulse injection
   * used for debugging dimension swap issues - can be removed in production
   * @param {number} width - grid width
   * @param {number} height - grid height
   */
  testRoundTripAccuracy (width, height) {
    console.log(`\n=== ROUND-TRIP TEST: ${width}x${height} ===`)

    // create test grid with impulse at center
    const testGrid = new Float32Array(width * height * 2)
    const centerX = Math.floor(width / 2)
    const centerY = Math.floor(height / 2)
    const centerIdx = (centerY * width + centerX) * 2

    // inject impulse: amplitude = 1.0 + 0i
    testGrid[centerIdx] = 1.0
    testGrid[centerIdx + 1] = 0.0

    console.log(
      `Impulse injected at (${centerX}, ${centerY}), idx=${centerIdx}`
    )
    console.log(
      `Original: real=${testGrid[centerIdx]}, imag=${testGrid[centerIdx + 1]}`
    )

    // create temporary grid with the new dimensions
    const tempEngine = new ComputationEngine({ width, height })
    const buffer1 = new Float32Array(width * height * 2)
    const buffer2 = new Float32Array(width * height * 2)

    // perform round-trip: FFT -> IFFT
    tempEngine._fft2D(testGrid, buffer1)
    tempEngine._ifft2D(buffer1, buffer2)

    // check round-trip accuracy
    const realDiff = Math.abs(testGrid[centerIdx] - buffer2[centerIdx])
    const imagDiff = Math.abs(testGrid[centerIdx + 1] - buffer2[centerIdx + 1])
    const tolerance = 1e-10

    console.log(
      `Round-trip result: real=${buffer2[centerIdx]}, imag=${buffer2[centerIdx + 1]}`
    )
    console.log(`Differences: real=${realDiff}, imag=${imagDiff}`)
    console.log(`Tolerance: ${tolerance}`)

    const passed = realDiff < tolerance && imagDiff < tolerance
    console.log(`Round-trip test: ${passed ? 'PASSED' : 'FAILED'}`)

    return passed
  }
}
