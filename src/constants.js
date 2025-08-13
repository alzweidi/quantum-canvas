export const GRID_SIZE = 256; // grid resolution, must be power of 2, e.g. 256, 512, 1024, etc. You can change these via 'nano constant.js'
export const DOMAIN_SIZE = 512.0; // physical domain size (independent of resolution) You can change these via 'nano constant.js' (I have no idea how to hook this into a UI feature, was too code complex for such a weird need)
export const HBAR = 1;
export const MASS = 1;
export const INITIAL_DT = 0.005;
export const INITIAL_SIGMA = 15.0;
export const INITIAL_P_X = 1.0; // below Nyquist for Δx=2 → k_max≈1.57
export const INITIAL_P_Y = 0.0;
export const INITIAL_X0 = DOMAIN_SIZE / 2; // center in physical coordinates
export const INITIAL_Y0 = DOMAIN_SIZE / 2;
export const POTENTIAL_STRENGTH = 100.0;
export const WALL_ENERGY = 1e4;  // big, but finite, energy unit
