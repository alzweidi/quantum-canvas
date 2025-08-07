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
        this.psi = new Float32Array(this.gridSize.width * this.gridSize.height * 2);
        this.potential = new Float32Array(this.gridSize.width * this.gridSize.height);
        this.kineticOperatorK = new Float32Array(this.gridSize.width * this.gridSize.height);

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
        const size = this.gridSize.width;
        // FIX: k-space frequency calculation must include physical grid spacing
        const dx = C.DOMAIN_SIZE / this.gridSize.width;
        const dk = (2.0 * Math.PI) / (size * dx);
        const coeff = (C.HBAR * C.HBAR) / (2.0 * C.MASS);

        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                // calculate k-space coordinates (FFT frequency domain)
                const kx = (i < size / 2) ? i * dk : (i - size) * dk;
                const ky = (j < size / 2) ? j * dk : (j - size) * dk;
                
                // calculate k² magnitude
                const kSquared = kx * kx + ky * ky;
                
                // kinetic energy operator value
                const kineticEnergy = coeff * kSquared;
                
                // store as real scalar (kinetic energy is purely real)
                const idx = i * size + j;
                this.kineticOperatorK[idx] = kineticEnergy;
            }
        }
    }

    /**
     * initialises the wave function as a normalised Gaussian wave packet
     * ψ(x,y) = A * exp(-(x-x₀)²/2σ² - (y-y₀)²/2σ²) * exp(i(px*x + py*y)/ℏ)
     * @private
     */
    resetWaveFunction() {
        const size = this.gridSize.width;
        // FIX: calculate grid spacing from physical domain size and resolution
        const dx = C.DOMAIN_SIZE / this.gridSize.width;
        const dy = C.DOMAIN_SIZE / this.gridSize.height;
        
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
                const gaussianArg = -((x - x0) * (x - x0) + (y - y0) * (y - y0)) / (2.0 * this.params.sigma * this.params.sigma);
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
                
                this.psi[idx] = tempReal[tempIdx] / norm;       // real part
                this.psi[idx + 1] = tempImag[tempIdx] / norm;  // imaginary part
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
