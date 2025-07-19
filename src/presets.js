/**
 * @fileoverview Quantum experiment presets for the simulator
 * Contains famous quantum mechanics experiments as data-driven configurations
 */

export const PRESETS = {
  DOUBLE_SLIT: {
    description: "Demonstrates wave-particle duality and interference.",
    draw: (potential, width, height) => {
      const slitCenterY = Math.floor(width / 2);
      const slitWidth = 4;
      const slitGap = 20;
      const barrierWidth = 4;

      for (let y = 0; y < height; y++) {
        // Main barrier
        for (
          let x = slitCenterY - barrierWidth / 2;
          x < slitCenterY + barrierWidth / 2;
          x++
        ) {
          const idx = y * width + Math.floor(x);
          // Leave gaps for the slits
          if (y < height / 2 - slitGap / 2 || y > height / 2 + slitGap / 2) {
            potential[idx] = 200.0;
          }
        }
      }
    },
  },
  TUNNELING: {
    description: "Shows quantum tunneling through a potential barrier.",
    draw: (potential, width, height) => {
      const barrierCenterY = Math.floor(width / 2);
      const barrierThickness = 5;

      for (let y = 0; y < height; y++) {
        for (
          let x = barrierCenterY - barrierThickness / 2;
          x < barrierCenterY + barrierThickness / 2;
          x++
        ) {
          const idx = y * width + Math.floor(x);
          potential[idx] = 100.0;
        }
      }
    },
  },
};
