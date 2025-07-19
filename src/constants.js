// Grid and Simulation Parameters
export const GRID_SIZE = 256; // Must be a power of 2
export const DT = 0.005;      // Time step. Critical for stability. Tune if simulation "explodes".

// Physical Constants (can be set to 1 for simplicity)
export const HBAR = 1;
export const MASS = 1;

// Initial Wave Packet Parameters
export const SIGMA = 15.0; // Initial width of the Gaussian packet
export const P_X = 60.0;   // Initial momentum in x
export const P_Y = 0.0;    // Initial momentum in y
