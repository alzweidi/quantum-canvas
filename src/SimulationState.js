import * as C from "./constants.js";

export class SimulationState {
  constructor() {
    this.gridSize = { width: C.GRID_SIZE, height: C.GRID_SIZE };
    this.params = {
      x0: C.INITIAL_X0,
      y0: C.INITIAL_Y0,
      px: C.INITIAL_P_X,
      py: C.INITIAL_P_Y,
      sigma: C.INITIAL_SIGMA,
      dt: C.INITIAL_DT,
      brightness: 1.0,
    };
    this.psi = new Float32Array(this.gridSize.width * this.gridSize.height * 2);
    this.potential = new Float32Array(
      this.gridSize.width * this.gridSize.height,
    );
    this.kineticOperatorK = new Float32Array(
      this.gridSize.width * this.gridSize.height * 2,
    );

    this._createReflectiveBoundary();
    this._precalculateKineticOperator();
    this.resetWaveFunction();
  }

  _createReflectiveBoundary() {
    const width = this.gridSize.width;
    const height = this.gridSize.height;
    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        if (i === 0 || i === height - 1 || j === 0 || j === width - 1) {
          this.potential[i * width + j] = C.BORDER_STRENGTH;
        }
      }
    }
  }

  /**
   * Precalculates the kinetic energy operator in k-space
   * T = (ℏ²/2m) * k² where k is the wave vector magnitude
   * @private
   */
  _precalculateKineticOperator() {
    const size = this.gridSize.width;
    const dk = (2.0 * Math.PI) / size;
    const coeff = (C.HBAR * C.HBAR) / (2.0 * C.MASS);

    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        // calculate k-space coordinates (FFT frequency domain)
        const kx = i < size / 2 ? i * dk : (i - size) * dk;
        const ky = j < size / 2 ? j * dk : (j - size) * dk;

        // calculate k² magnitude
        const kSquared = kx * kx + ky * ky;

        // kinetic energy operator value
        const kineticEnergy = coeff * kSquared;

        // store as complex number (real part = kinetic energy, imag part = 0)
        const idx = (i * size + j) * 2;
        this.kineticOperatorK[idx] = kineticEnergy; // Real part
        this.kineticOperatorK[idx + 1] = 0.0; // Imaginary part
      }
    }
  }

  /**
   * initialises the wave function as a normalised Gaussian wave packet
   * ψ(x,y) = A * exp(-(x-x₀)²/2σ² - (y-y₀)²/2σ²) * exp(i(px*x + py*y)/ℏ)
   * @private
   */
  resetWaveFunction() {
    // DEBUG: Log reset position values
    console.log(
      `DEBUG: Reset position - x0: ${this.params.x0}, y0: ${this.params.y0}, expected center: ${this.gridSize.width / 2}`,
    );
    const size = this.gridSize.width;
    const dx = 1.0; // grid spacing
    const dy = 1.0;

    // use tunable position parameters
    const x0 = this.params.x0;
    const y0 = this.params.y0;

    // calculate normalization constant
    let norm = 0.0;
    const tempReal = new Array(size * size);
    const tempImag = new Array(size * size);

    // first pass: calculate unnormalized wave function
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const x = i * dx;
        const y = j * dy;

        // gaussian envelope using tunable parameters
        const gaussianArg =
          -((x - x0) * (x - x0) + (y - y0) * (y - y0)) /
          (2.0 * this.params.sigma * this.params.sigma);
        const amplitude = Math.exp(gaussianArg);

        // phase factor using tunable momentum parameters
        const phaseArg = (this.params.px * x + this.params.py * y) / C.HBAR;
        const real = amplitude * Math.cos(phaseArg);
        const imag = amplitude * Math.sin(phaseArg);

        const idx = i * size + j;
        tempReal[idx] = real;
        tempImag[idx] = imag;

        // add to normalization
        norm += real * real + imag * imag;
      }
    }

    // normalise
    norm = Math.sqrt(norm * dx * dy);

    // second pass: store normalized wave function
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const idx = (i * size + j) * 2;
        const tempIdx = i * size + j;

        this.psi[idx] = tempReal[tempIdx] / norm; // real part
        this.psi[idx + 1] = tempImag[tempIdx] / norm; // imaginary part
      }
    }
  }

  shiftWaveFunction(dx, dy) {
    const tempPsi = new Float32Array(this.psi.length).fill(0);
    const width = this.gridSize.width;
    const height = this.gridSize.height;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const newX = x + dx;
        const newY = y + dy;
        if (newX >= 0 && newX < width && newY >= 0 && newY < height) {
          const oldIdx = (y * width + x) * 2;
          const newIdx = (newY * width + newX) * 2;
          tempPsi[newIdx] = this.psi[oldIdx];
          tempPsi[newIdx + 1] = this.psi[oldIdx + 1];
        }
      }
    }
    this.psi.set(tempPsi);
  }

  /**
   * apply absorbing boundaries to prevent wave function wrapping
   * gradually reduces amplitude near the edges to simulate infinite space
   * @private
   */
  _applyAbsorbingBoundaries() {
    const width = this.gridSize.width;
    const height = this.gridSize.height;
    const boundaryWidth = 10; // width of absorbing region

    for (let i = 0; i < height; i++) {
      for (let j = 0; j < width; j++) {
        const idx = (i * width + j) * 2;

        // calculate distance from edges
        const distFromLeft = j;
        const distFromRight = width - 1 - j;
        const distFromTop = i;
        const distFromBottom = height - 1 - i;

        // find minimum distance to any edge
        const minDist = Math.min(
          distFromLeft,
          distFromRight,
          distFromTop,
          distFromBottom,
        );

        // apply exponential decay within boundary region
        if (minDist < boundaryWidth) {
          const dampingFactor = Math.exp(-0.1 * (boundaryWidth - minDist));
          this.psi[idx] *= dampingFactor; // real part
          this.psi[idx + 1] *= dampingFactor; // imaginary part
        }
      }
    }
  }
}
