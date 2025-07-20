/**
 * @fileoverview Quantum experiment presets for the simulator
 * Contains famous quantum mechanics experiments as data-driven configurations
 */

export const PRESETS = {
    DOUBLE_SLIT: {
        description: "Demonstrates wave-particle duality and interference.",
        draw: (potential, width, height) => {
            const barrierCenterX = Math.floor(width / 2);
            const barrierWidth = 4; // Thickness of the barrier wall
            const slitHeight = 12; // Height of each slit opening
            const slitGap = 20;    // Gap between the centers of the two slits
            
            // Position the slits symmetrically around the vertical center
            const slit1_CenterY = Math.floor(height / 2 - slitGap / 2);
            const slit2_CenterY = Math.floor(height / 2 + slitGap / 2);

            for (let x = barrierCenterX - barrierWidth / 2; x < barrierCenterX + barrierWidth / 2; x++) {
                for (let y = 0; y < height; y++) {
                    // Check if the current y-position is within the bounds of either slit
                    const inSlit1 = (y > slit1_CenterY - slitHeight / 2) && (y < slit1_CenterY + slitHeight / 2);
                    const inSlit2 = (y > slit2_CenterY - slitHeight / 2) && (y < slit2_CenterY + slitHeight / 2);

                    // If the pixel is NOT in a slit, draw the barrier
                    if (!inSlit1 && !inSlit2) {
                        const idx = y * width + Math.floor(x);
                        potential[idx] = 200.0; // Use a high potential for a solid wall
                    }
                }
            }
        }
    },
    TUNNELING: {
        description: "Shows quantum tunneling through a potential barrier.",
        draw: (potential, width, height) => {
            const barrierCenterY = Math.floor(width / 2);
            const barrierThickness = 5;

            for (let y = 0; y < height; y++) {
                for (let x = barrierCenterY - barrierThickness / 2; x < barrierCenterY + barrierThickness / 2; x++) {
                    const idx = y * width + Math.floor(x);
                    potential[idx] = 100.0;
                }
            }
        }
    }
};
