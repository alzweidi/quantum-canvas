/**
 * @fileoverview Physical and simulation constants for the quantum simulator
 * All simulation parameters are centralized here for easy tuning
 */

/** Grid size for the simulation (must be power of 2 for FFT) */
export const GRID_SIZE = 256;

/** Time step for simulation - critical for stability */
export const DT = 0.005;

/** Reduced Planck constant (set to 1 for simplicity) */
export const HBAR = 1;

/** Particle mass (set to 1 for simplicity) */
export const MASS = 1;

/** Initial width of the Gaussian wave packet */
export const SIGMA = 15.0;

/** Initial momentum in x-direction */
export const P_X = 60.0;

/** Initial momentum in y-direction */
export const P_Y = 0.0;
