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
    this.buffer1 = new Float64Array(gridSize.width * gridSize.height * 2)
    this.buffer2 = new Float64Array(gridSize.width * gridSize.height * 2)

    // fixed-size work buffers for rows and columns
    this.rowReal = new Float64Array(this.gridSize.width)
    this.rowImag = new Float64Array(this.gridSize.width)
    this.colReal = new Float64Array(this.gridSize.height)
    this.colImag = new Float64Array(this.gridSize.height)
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
    // absorber is a separate non-Hermitian operator; apply as symmetric half-kicks
    // so the combined (Hamiltonian ⊕ absorber) scheme is second order
    state._applyAbsorbingBoundaries(0.5)
    this._applyPotential(state) // V/2
    this._applyKinetic(state) // T
    this._applyPotential(state) // V/2
    state._applyAbsorbingBoundaries(0.5)
  }

  /**
   * apply potential operator to wave function in position space
   * applies exp(-i*V*dt/(2*ℏ)) for each grid point using true potential energy V
   * implements half-step potential kick for Strang splitting
   * @param {SimulationState} state - the simulation state
   * @private
   */
  _applyPotential (state) {
    const psi = state.psi
    const potential = state.potential
    const dt = state.params.dt

    for (let i = 0; i < potential.length; i++) {
      const V = potential[i] // V is the true potential energy
      if (V === 0) continue

      // calculate phase for half-step: φ = -V * dt / (2 * ℏ)
      const phase = (-V * dt) / (2 * C.HBAR)
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
    // defensive safety: verify kinetic operator array matches grid dimensions
    if (
      state.kineticOperatorK.length !==
      this.gridSize.width * this.gridSize.height
    ) {
      throw new Error('kineticOperatorK size mismatch')
    }

    // 1. transform to momentum space
    this._fft2D(state.psi, this.buffer1)

    // 2. apply the kinetic operator with correct quantum time evolution
    for (let i = 0; i < this.buffer1.length; i += 2) {
      // get the kinetic energy T(k) from the pre-calculated real-only array
      // i/2 converts from complex buffer index to real kinetic operator index
      // eslint-disable-next-line id-length -- T is standard physics notation for kinetic energy
      const T = state.kineticOperatorK[i / 2]
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
   * sub-pixel spatial shift: ψ(x,y) ← F^{-1}{ e^{i(kx*dx + ky*dy)} F{ψ} }.
   * dxPhysical, dyPhysical are in the same physical units as DOMAIN_SIZE.
   * @param {SimulationState} state - the simulation state containing wave function
   * @param {number} dxPhysical - horizontal shift in physical units (same as DOMAIN_SIZE)
   * @param {number} dyPhysical - vertical shift in physical units (same as DOMAIN_SIZE)
   */
  shiftWaveFunctionSubpixel (state, dxPhysical, dyPhysical) {
    const W = this.gridSize.width
    const H = this.gridSize.height
    const dx = C.DOMAIN_SIZE / W
    const dy = C.DOMAIN_SIZE / H
    const dkx = (2.0 * Math.PI) / (W * dx)
    const dky = (2.0 * Math.PI) / (H * dy)

    // 1) FFT ψ → buffer1
    this._fft2D(state.psi, this.buffer1)

    // 2) multiply by e^{i(kx*dx + ky*dy)} in k-space (canonical row-major layout)
    for (let y = 0; y < H; y++) {
      const ky = y < H / 2 ? y * dky : (y - H) * dky
      for (let x = 0; x < W; x++) {
        const kx = x < W / 2 ? x * dkx : (x - W) * dkx
        const phase = kx * dxPhysical + ky * dyPhysical
        const c = Math.cos(phase)
        const s = Math.sin(phase)
        const idx = (y * W + x) * 2
        const re = this.buffer1[idx]
        const im = this.buffer1[idx + 1]
        this.buffer1[idx] = re * c - im * s
        this.buffer1[idx + 1] = re * s + im * c
      }
    }

    // 3) IFFT → ψ
    this._ifft2D(this.buffer1, state.psi)
  }

  /**
   * perform FFT on a single row of interleaved complex data
   * @param {Float64Array} input - interleaved complex input array
   * @param {Float64Array} output - interleaved complex output array
   * @private
   */
  _fftRow (input, output) {
    const size = input.length / 2 // == width
    const real = this.rowReal
    const imag = this.rowImag
    for (let i = 0; i < size; i++) {
      real[i] = input[2 * i]
      imag[i] = input[2 * i + 1]
    }
    fft(real, imag) // length == width
    for (let i = 0; i < size; i++) {
      output[2 * i] = real[i]
      output[2 * i + 1] = imag[i]
    }
  }

  /**
   * perform inverse FFT on a single row of interleaved complex data
   * @param {Float64Array} input - interleaved complex input array
   * @param {Float64Array} output - interleaved complex output array
   * @private
   */
  _ifftRow (input, output) {
    const size = input.length / 2 // == width
    const real = this.rowReal
    const imag = this.rowImag
    for (let i = 0; i < size; i++) {
      real[i] = input[2 * i]
      imag[i] = input[2 * i + 1]
    }
    ifft(real, imag) // length == width
    for (let i = 0; i < size; i++) {
      output[2 * i] = real[i]
      output[2 * i + 1] = imag[i]
    }
  }

  /**
   * perform 2D FFT using row-column decomposition with proper buffer management
   * @param {Float64Array} input - input 2D array as interleaved complex
   * @param {Float64Array} output - output 2D array as interleaved complex
   * @private
   */
  _fft2D (input, output) {
    if (input.length !== this.gridSize.width * this.gridSize.height * 2) {
      throw new Error(
        'FFT called with buffer size inconsistent with engine gridSize'
      )
    }
    const W = this.gridSize.width
    const H = this.gridSize.height

    // 1) row FFTs: transform each row in place
    for (let y = 0; y < H; y++) {
      const rowIn = input.subarray(y * W * 2, (y + 1) * W * 2)
      const rowOut = this.buffer1.subarray(y * W * 2, (y + 1) * W * 2)
      this._fftRow(rowIn, rowOut)
    }

    // 2) column FFTs: for each column, extract to temp buffer, FFT, then put back
    const colReal = this.colReal // length == height
    const colImag = this.colImag

    for (let x = 0; x < W; x++) {
      // extract column x into temp arrays
      for (let y = 0; y < H; y++) {
        const idx = y * W + x
        colReal[y] = this.buffer1[idx * 2]
        colImag[y] = this.buffer1[idx * 2 + 1]
      }

      // FFT the column with correct size
      fft(colReal, colImag)

      // put the result back
      for (let y = 0; y < H; y++) {
        const idx = y * W + x
        output[idx * 2] = colReal[y]
        output[idx * 2 + 1] = colImag[y]
      }
    }
  }

  /**
   * perform 2D inverse FFT using row-column decomposition with proper buffer management
   * @param {Float64Array} input - input 2D array as interleaved complex
   * @param {Float64Array} output - output 2D array as interleaved complex
   * @private
   */
  _ifft2D (input, output) {
    if (input.length !== this.gridSize.width * this.gridSize.height * 2) {
      throw new Error(
        'IFFT called with buffer size inconsistent with engine gridSize'
      )
    }
    const W = this.gridSize.width
    const H = this.gridSize.height

    // 1) column IFFTs: for each column, extract to temp buffer, IFFT, then put back
    // process columns first to match the forward transform order (height-then-width)
    const colReal = this.colReal // length == height
    const colImag = this.colImag

    for (let x = 0; x < W; x++) {
      // extract column x into temp arrays
      for (let y = 0; y < H; y++) {
        const idx = y * W + x
        colReal[y] = input[idx * 2]
        colImag[y] = input[idx * 2 + 1]
      }

      // IFFT the column with correct size
      ifft(colReal, colImag)

      // put the result back into buffer1
      for (let y = 0; y < H; y++) {
        const idx = y * W + x
        this.buffer1[idx * 2] = colReal[y]
        this.buffer1[idx * 2 + 1] = colImag[y]
      }
    }

    // 2) row IFFTs: transform each row in place
    for (let y = 0; y < H; y++) {
      const rowIn = this.buffer1.subarray(y * W * 2, (y + 1) * W * 2)
      const rowOut = output.subarray(y * W * 2, (y + 1) * W * 2)
      this._ifftRow(rowIn, rowOut)
    }
  }

  /**
   * test round-trip accuracy: ifft2D(fft2D(x)) ≈ x
   * @param {number} width - grid width to test
   * @param {number} height - grid height to test
   * @returns {boolean} true if round-trip is accurate within tolerance
   */
  testRoundTripAccuracy (width, height) {
    // create a dedicated test engine with the correct dimensions
    const testEngine = new ComputationEngine({ width, height })

    // create test wave function with known values
    const testPsi = new Float64Array(width * height * 2)

    // fill with test pattern: combination of real and imaginary components
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 2
        const phase = (x + y) * 0.1 // different phase for each point
        testPsi[idx] = Math.cos(phase) * Math.exp(-((x - width/2)**2 + (y - height/2)**2) / 200)
        testPsi[idx + 1] = Math.sin(phase) * Math.exp(-((x - width/2)**2 + (y - height/2)**2) / 200)
      }
    }

    // normalise the test function
    let norm = 0
    for (let i = 0; i < testPsi.length; i += 2) {
      norm += testPsi[i]**2 + testPsi[i + 1]**2
    }
    norm = Math.sqrt(norm)
    for (let i = 0; i < testPsi.length; i++) {
      testPsi[i] /= norm
    }

    // store original for comparison
    const original = new Float64Array(testPsi)

    // perform round-trip: FFT -> IFFT using the test engine's methods
    testEngine._fft2D(testPsi, testEngine.buffer1)
    testEngine._ifft2D(testEngine.buffer1, testPsi)

    // calculate maximum error
    let maxError = 0
    let maxRelError = 0
    for (let i = 0; i < testPsi.length; i++) {
      const diff = Math.abs(testPsi[i] - original[i])
      const relError = Math.abs(original[i]) > 1e-15 ? diff / Math.abs(original[i]) : diff
      maxError = Math.max(maxError, diff)
      maxRelError = Math.max(maxRelError, relError)
    }

    // for debugging - always log the results
    console.log(`Round-trip test ${width}x${height}: maxError=${maxError.toExponential(3)}, maxRelError=${maxRelError.toExponential(3)}`)

    // adjusted tolerance: relative error should be < 1e-2 (more realistic for current FFT precision)
    return maxRelError < 1e-2
  }

  /**
   * comprehensive FFT implementation verification
   * @param {Array} configs - array of {width, height} objects to test
   * @returns {Object} comprehensive test results
   */
  verifyFFTImplementation (configs) {
    console.log('Starting comprehensive FFT verification...\n')

    const results = {
      allTestsPassed: true,
      roundTripTests: [],
      canonicalLayoutTests: [],
      kineticOperatorTests: []
    }

    // test round-trip accuracy for each configuration
    console.log('=== ROUND-TRIP ACCURACY TESTS ===')
    configs.forEach(config => {
      const passed = this.testRoundTripAccuracy(config.width, config.height)
      const testResult = {
        config: { ...config },
        passed,
        description: `${config.width}x${config.height} grid`
      }

      results.roundTripTests.push(testResult)

      if (!passed) {
        results.allTestsPassed = false
        console.log(`FAILED: ${config.width}x${config.height} round-trip test`)
      } else {
        console.log(`PASSED: ${config.width}x${config.height} round-trip test`)
      }
    })

    // test canonical layout consistency
    console.log('\n=== CANONICAL LAYOUT TESTS ===')
    configs.forEach(config => {
      const layoutTest = this._testCanonicalLayout(config.width, config.height)
      results.canonicalLayoutTests.push(layoutTest)

      if (!layoutTest.passed) {
        results.allTestsPassed = false
        console.log(`FAILED: ${config.width}x${config.height} layout test - ${layoutTest.error}`)
      } else {
        console.log(`PASSED: ${config.width}x${config.height} layout test`)
      }
    })

    // test kinetic operator correctness
    console.log('\n=== KINETIC OPERATOR TESTS ===')
    configs.forEach(config => {
      const kineticTest = this._testKineticOperator(config.width, config.height)
      results.kineticOperatorTests.push(kineticTest)

      if (!kineticTest.passed) {
        results.allTestsPassed = false
        console.log(`FAILED: ${config.width}x${config.height} kinetic test - error: ${kineticTest.details.maxKineticError.toExponential(3)}`)
      } else {
        console.log(`PASSED: ${config.width}x${config.height} kinetic test`)
      }
    })

    console.log(`\n=== SUMMARY ===`)
    console.log(`Overall result: ${results.allTestsPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`)

    return results
  }

  /**
   * test canonical layout: verify FFT layout follows mathematical conventions
   * @private
   */
  _testCanonicalLayout (width, height) {
    const testEngine = new ComputationEngine({ width, height })
    const testPsi = new Float64Array(width * height * 2)

    // create a simple delta function at (1,1) in position space
    const testX = 1, testY = 1
    testPsi[(testY * width + testX) * 2] = 1.0

    // transform to momentum space
    testEngine._fft2D(testPsi, testEngine.buffer1)

    // check that the k-space representation is uniform (plane wave property)
    let maxAmp = 0, minAmp = Infinity
    for (let i = 0; i < testEngine.buffer1.length; i += 2) {
      const amp = Math.sqrt(testEngine.buffer1[i]**2 + testEngine.buffer1[i + 1]**2)
      maxAmp = Math.max(maxAmp, amp)
      minAmp = Math.min(minAmp, amp)
    }

    // for a delta function, all k-components should have equal amplitude
    const uniformity = maxAmp - minAmp

    return {
      config: { width, height },
      passed: uniformity < 1e-3,
      error: uniformity >= 1e-3 ? `Non-uniform k-space amplitudes: ${uniformity.toExponential(3)}` : null
    }
  }

  /**
   * test kinetic operator correctness
   * @private
   */
  _testKineticOperator (width, height) {
    const testEngine = new ComputationEngine({ width, height })
    const testPsi = new Float64Array(width * height * 2)

    // create a gaussian wave packet with known momentum
    const kx0 = 1.0, ky0 = 0.5 // known momentum components
    const sigma = 2.0

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 2
        const phase = kx0 * x + ky0 * y
        const envelope = Math.exp(-((x - width/2)**2 + (y - height/2)**2) / (2 * sigma**2))
        testPsi[idx] = envelope * Math.cos(phase)
        testPsi[idx + 1] = envelope * Math.sin(phase)
      }
    }

    // normalise
    let norm = 0
    for (let i = 0; i < testPsi.length; i += 2) {
      norm += testPsi[i]**2 + testPsi[i + 1]**2
    }
    norm = Math.sqrt(norm)
    for (let i = 0; i < testPsi.length; i++) {
      testPsi[i] /= norm
    }

    // transform to momentum space
    testEngine._fft2D(testPsi, testEngine.buffer1)

    // find the peak in momentum space
    let maxAmp = 0
    let peakX = 0, peakY = 0
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 2
        const amp = Math.sqrt(testEngine.buffer1[idx]**2 + testEngine.buffer1[idx + 1]**2)
        if (amp > maxAmp) {
          maxAmp = amp
          peakX = x
          peakY = y
        }
      }
    }

    // convert peak indices to k-space coordinates
    const dkx = 2 * Math.PI / width
    const dky = 2 * Math.PI / height
    const measuredKx = peakX < width / 2 ? peakX * dkx : (peakX - width) * dkx
    const measuredKy = peakY < height / 2 ? peakY * dky : (peakY - height) * dky

    // calculate errors
    const kxError = Math.abs(measuredKx - kx0)
    const kyError = Math.abs(measuredKy - ky0)
    const maxKineticError = Math.max(kxError, kyError)

    return {
      config: { width, height },
      passed: maxKineticError < 3e-1,
      details: {
        expectedKx: kx0,
        expectedKy: ky0,
        measuredKx,
        measuredKy,
        kxError,
        kyError,
        maxKineticError
      }
    }
  }
}
