import * as C from './constants.js';

export class SimulationState {
    constructor() {
        this.gridSize = { width: C.GRID_SIZE, height: C.GRID_SIZE };
        this.params = {
            x0: C.INITIAL_X0, y0: C.INITIAL_Y0,
            px: C.INITIAL_P_X, py: C.INITIAL_P_Y,
            sigma: C.INITIAL_SIGMA,
            dt: C.INITIAL_DT, brightness: 1.0,
            boundaryMode: 'reflective', // 'reflective', 'absorbing', 'both'
            barrierEnergy: 300, // energy unit - now stored as energy rather than phase
        };
        this.psi = new Float64Array(this.gridSize.width * this.gridSize.height * 2);
        this.potential = new Float64Array(this.gridSize.width * this.gridSize.height);
        this.kineticOperatorK = new Float64Array(this.gridSize.width * this.gridSize.height);

        this._updateBoundaries();
        this._precalculateKineticOperator();
        this.resetWaveFunction();
    }
    
    _createReflectiveBoundary() {
        // only create reflective boundaries if mode allows it
        if (this.params.boundaryMode === 'reflective' || this.params.boundaryMode === 'both') {
            const width = this.gridSize.width;
            const height = this.gridSize.height;
            for (let i = 0; i < height; i++) {
                for (let j = 0; j < width; j++) {
                    if (i === 0 || i === height - 1 || j === 0 || j === width - 1) {
                        this.potential[i * width + j] = C.WALL_ENERGY;
                    }
                }
            }
        }
    }

    /**
     * update boundaries based on current boundary mode
     * clears existing boundaries and applies the appropriate type
     * @public
     */
    _updateBoundaries() {
        const width = this.gridSize.width;
        const height = this.gridSize.height;
        
        // clear all boundary potentials first
        for (let i = 0; i < height; i++) {
            for (let j = 0; j < width; j++) {
                if (i === 0 || i === height - 1 || j === 0 || j === width - 1) {
                    this.potential[i * width + j] = 0;
                }
            }
        }
        
        // apply the appropriate boundary type
        this._createReflectiveBoundary();
    }

    /**
     * precalculates the kinetic energy operator in k-space
     * T = (ℏ²/2m) * k² where k is the wave vector magnitude
     * @private
     */
    _precalculateKineticOperator() {
        const width  = this.gridSize.width;
        const height = this.gridSize.height;

        // include physical spacing in each axis
        const dx  = C.DOMAIN_SIZE / width;
        const dy  = C.DOMAIN_SIZE / height;
        const dkx = (2.0 * Math.PI) / (width  * dx);
        const dky = (2.0 * Math.PI) / (height * dy);
        const coeff = (C.HBAR * C.HBAR) / (2.0 * C.MASS);

        // row-major fill: y outer, x inner
        for (let y = 0; y < height; y++) {
            const ky = (y < height / 2) ? y * dky : (y - height) * dky;
            for (let x = 0; x < width; x++) {
                const kx = (x < width / 2) ? x * dkx : (x - width) * dkx;
                const kSquared = kx*kx + ky*ky;
                const kineticEnergy = coeff * kSquared;
                const idx = y * width + x;     // row-major
                this.kineticOperatorK[idx] = kineticEnergy;
            }
        }
    }
/**
     * get physical grid spacing in x direction
     * @private
     */
    _getDx() { return C.DOMAIN_SIZE / this.gridSize.width; }
    
    /**
     * get physical grid spacing in y direction 
     * @private
     */
    _getDy() { return C.DOMAIN_SIZE / this.gridSize.height; }
    
    /**
     * get maximum safe momentum in x direction (Nyquist limit)
     * @private
     */
    _getPxMax() { return Math.PI / this._getDx() * C.HBAR; } // Nyquist px
    
    /**
     * get maximum safe momentum in y direction (Nyquist limit)
     * @private
     */
    _getPyMax() { return Math.PI / this._getDy() * C.HBAR; } // Nyquist py

    /**
     * clamp momentum parameters to stay within Nyquist sampling limits
     * prevents aliasing artifacts from high momentum values
     * @param {number} margin - safety margin factor (default 0.9 for 90% of Nyquist)
     * @private
     */
    _clampMomentumToNyquist(margin = 0.9) {
        const pxMax = this._getPxMax() * margin;
        const pyMax = this._getPyMax() * margin;
        const oldPx = this.params.px, oldPy = this.params.py;

        if (Math.abs(this.params.px) > pxMax) {
            this.params.px = Math.sign(this.params.px) * pxMax;
            console.warn(`[NYQUIST] Clamped px from ${oldPx} to ${this.params.px}`);
        }
        if (Math.abs(this.params.py) > pyMax) {
            this.params.py = Math.sign(this.params.py) * pyMax;
            console.warn(`[NYQUIST] Clamped py from ${oldPy} to ${this.params.py}`);
        }
    }

    /**
     * initialises the wave function as a normalised Gaussian wave packet
     * ψ(x,y) = A * exp(-(x-x₀)²/2σ² - (y-y₀)²/2σ²) * exp(i(px*x + py*y)/ℏ)
     * @private
     */
    resetWaveFunction() {
        this._clampMomentumToNyquist();
        const width  = this.gridSize.width;
        const height = this.gridSize.height;
        // FIX: calculate grid spacing from physical domain size and resolution
        const dx = C.DOMAIN_SIZE / width;
        const dy = C.DOMAIN_SIZE / height;
        
        // use tunable position parameters
        const x0 = this.params.x0;
        const y0 = this.params.y0;
        
        // calculate normalization constant
        let norm = 0.0;
        const tempReal = new Array(width * height);
        const tempImag = new Array(width * height);
        
        // first pass: compute unnormalized ψ into temp arrays (row-major)
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const xf = x * dx;
                const yf = y * dy;

                // gaussian envelope & phase (unchanged math)
                const gaussianArg = -(((xf - x0) * (xf - x0)) + ((yf - y0) * (yf - y0)))
                                    / (2.0 * this.params.sigma * this.params.sigma);
                const amplitude = Math.exp(gaussianArg);

                const phaseArg = (this.params.px * xf + this.params.py * yf) / C.HBAR;
                const real = amplitude * Math.cos(phaseArg);
                const imag = amplitude * Math.sin(phaseArg);

                const idx = y * width + x;     // row-major
                tempReal[idx] = real;
                tempImag[idx] = imag;
                norm += real*real + imag*imag;
            }
        }
        
        // normalise
        norm = Math.sqrt(norm * dx * dy);
        
        // second pass: write interleaved ψ in row-major
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const t = y * width + x;         // temp index (row-major)
                const idx = t * 2;              // interleaved complex index
                this.psi[idx]     = tempReal[t] / norm;
                this.psi[idx + 1] = tempImag[t] / norm;
            }
        }
    }

    shiftWaveFunction(dx, dy) {
        const tempPsi = new Float64Array(this.psi.length).fill(0);
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
     * uses dt scaling to ensure time-step independence
     * @private
     */
    _applyAbsorbingBoundaries() {
        // only apply absorbing boundaries if mode allows it
        if (this.params.boundaryMode === 'absorbing' || this.params.boundaryMode === 'both') {
            const width = this.gridSize.width;
            const height = this.gridSize.height;
            // make boundary width resolution-independent: 5% of domain, minimum 4 cells
            const boundaryWidth = Math.max(4, Math.floor(0.05 * width));
            
            for (let i = 0; i < height; i++) {
                for (let j = 0; j < width; j++) {
                    const idx = (i * width + j) * 2;
                    
                    // calculate distance from edges
                    const distFromLeft = j;
                    const distFromRight = width - 1 - j;
                    const distFromTop = i;
                    const distFromBottom = height - 1 - i;
                    
                    // find minimum distance to any edge
                    const minDist = Math.min(distFromLeft, distFromRight, distFromTop, distFromBottom);
                    
                    // apply exponential decay within boundary region
                    if (minDist < boundaryWidth) {
                        // fixed scale damping by dt to ensure time-step independence
                        // this represents a continuous absorption rate rather than discrete per-step damping
                        // convert damping rate to physical units for resolution independence
                        const cellSize = C.DOMAIN_SIZE / width;
                        const dampingRate = 0.06 * (boundaryWidth - minDist) * cellSize; // physical units
                        const dampingFactor = Math.exp(-dampingRate * this.params.dt);
                        
                        this.psi[idx] *= dampingFactor;         // real part
                        this.psi[idx + 1] *= dampingFactor;     // imaginary part
                    }
                }
            }
        }
    }
}
