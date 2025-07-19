import * as C from './constants.js';

/**
 * SimulationState class - The single source of truth for all simulation data
 * Manages the quantum wave function, potential field, and kinetic operator
 */
export class SimulationState {
    /**
     * Initialize the simulation state with wave function and operators
     * Creates normalized Gaussian wave packet and precalculates kinetic operator
     */
    constructor() {
        this.gridSize = { width: C.GRID_SIZE, height: C.GRID_SIZE };

        // Tunable parameters for real-time physics control
        this.params = {
            px: C.P_X,           // Momentum in x-direction
            py: C.P_Y,           // Momentum in y-direction
            sigma: C.SIGMA,      // Wave packet width
            brightness: 1.0,     // Visualization brightness
            dt: 0.005            // Time step for simulation (critical for stability)
        };

        // Interleaved complex arrays: [real0, imag0, real1, imag1, ...]
        this.psi = new Float32Array(this.gridSize.width * this.gridSize.height * 2);
        this.potential = new Float32Array(this.gridSize.width * this.gridSize.height);
        this.kineticOperatorK = new Float32Array(this.gridSize.width * this.gridSize.height * 2);

        this._precalculateKineticOperator();
        this.resetWaveFunction();
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
                // Calculate k-space coordinates (FFT frequency domain)
                const kx = (i < size / 2) ? i * dk : (i - size) * dk;
                const ky = (j < size / 2) ? j * dk : (j - size) * dk;
                
                // Calculate k² magnitude
                const kSquared = kx * kx + ky * ky;
                
                // Kinetic energy operator value
                const kineticEnergy = coeff * kSquared;
                
                // Store as complex number (real part = kinetic energy, imag part = 0)
                const idx = (i * size + j) * 2;
                this.kineticOperatorK[idx] = kineticEnergy;     // Real part
                this.kineticOperatorK[idx + 1] = 0.0;          // Imaginary part
            }
        }
    }

    /**
     * Initializes the wave function as a normalized Gaussian wave packet
     * ψ(x,y) = A * exp(-(x-x₀)²/2σ² - (y-y₀)²/2σ²) * exp(i(px*x + py*y)/ℏ)
     * @private
     */
    resetWaveFunction() {
        const size = this.gridSize.width;
        const dx = 1.0; // Grid spacing
        const dy = 1.0;
        
        // Center the wave packet
        const x0 = size / 4; // Start at 1/4 of the grid
        const y0 = size / 2; // Center vertically
        
        // Clear potential (no barriers initially)
        this.potential.fill(0.0);
        
        // Calculate normalization constant
        let norm = 0.0;
        const tempReal = new Array(size * size);
        const tempImag = new Array(size * size);
        
        // First pass: calculate unnormalized wave function
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const x = i * dx;
                const y = j * dy;
                
                // Gaussian envelope using tunable parameters
                const gaussianArg = -((x - x0) * (x - x0) + (y - y0) * (y - y0)) / (2.0 * this.params.sigma * this.params.sigma);
                const amplitude = Math.exp(gaussianArg);
                
                // Phase factor using tunable momentum parameters
                const phaseArg = (this.params.px * x + this.params.py * y) / C.HBAR;
                const real = amplitude * Math.cos(phaseArg);
                const imag = amplitude * Math.sin(phaseArg);
                
                const idx = i * size + j;
                tempReal[idx] = real;
                tempImag[idx] = imag;
                
                // Add to normalization
                norm += real * real + imag * imag;
            }
        }
        
        // Normalize
        norm = Math.sqrt(norm * dx * dy);
        
        // Second pass: store normalized wave function
        for (let i = 0; i < size; i++) {
            for (let j = 0; j < size; j++) {
                const idx = (i * size + j) * 2;
                const tempIdx = i * size + j;
                
                this.psi[idx] = tempReal[tempIdx] / norm;       // Real part
                this.psi[idx + 1] = tempImag[tempIdx] / norm;  // Imaginary part
            }
        }
    }
}
