/**
 * @fileoverview quantum experiment presets for the simulator
 * contains famous quantum mechanics experiments as data-driven configurations
 * with robust bounds validation and adaptive geometry scaling
 */

/**
 * validates that coordinates are within grid bounds
 * @param {number} x - x coordinate
 * @param {number} y - y coordinate  
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @returns {boolean} true if coordinates are valid
 */
function isValidGridIndex(x, y, width, height) {
    return x >= 0 && x < width && y >= 0 && y < height;
}

/**
 * clamps coordinates to valid grid range
 * @param {number} x - x coordinate
 * @param {number} y - y coordinate
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @returns {object} {x, y} clamped coordinates
 */
function clampToGrid(x, y, width, height) {
    return {
        x: Math.max(0, Math.min(width - 1, Math.floor(x))),
        y: Math.max(0, Math.min(height - 1, Math.floor(y)))
    };
}

/**
 * safely sets potential value with bounds checking
 * @param {Float32Array} potential - potential array
 * @param {number} x - x coordinate
 * @param {number} y - y coordinate
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @param {number} value - potential value to set
 * @returns {boolean} true if value was set, false if out of bounds
 */
function safeSetPotential(potential, x, y, width, height, value) {
    const clamped = clampToGrid(x, y, width, height);
    if (isValidGridIndex(clamped.x, clamped.y, width, height)) {
        const idx = clamped.y * width + clamped.x;
        potential[idx] = value;
        return true;
    }
    return false;
}

/**
 * calculates adaptive double slit geometry based on grid dimensions
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @returns {object} geometry parameters scaled to fit grid
 */
function calculateAdaptiveSlitGeometry(width, height) {
    // minimum viable dimensions for double slit experiment
    const minSlitHeight = 3;
    const minSlitGap = 6;
    const minBarrierWidth = 2;
    
    // adaptive scaling based on grid size
    const baseBarrierWidth = Math.max(minBarrierWidth, Math.floor(width * 0.02)); // 2% of width, min 2
    const baseSlitGap = Math.max(minSlitGap, Math.floor(height * 0.12)); // 12% of height, min 6
    const baseSlitHeight = Math.max(minSlitHeight, Math.floor(height * 0.08)); // 8% of height, min 3
    
    // ensure geometry fits within grid bounds
    const maxUsableHeight = height - 4; // leave 2 pixels margin top/bottom
    const totalSlitSpace = baseSlitGap + baseSlitHeight;
    
    let slitGap = baseSlitGap;
    let slitHeight = baseSlitHeight;
    
    // scale down if total space exceeds available height
    if (totalSlitSpace > maxUsableHeight) {
        const scaleFactor = maxUsableHeight / totalSlitSpace;
        slitGap = Math.max(minSlitGap, Math.floor(baseSlitGap * scaleFactor));
        slitHeight = Math.max(minSlitHeight, Math.floor(baseSlitHeight * scaleFactor));
    }
    
    return {
        barrierWidth: baseBarrierWidth,
        slitHeight: slitHeight,
        slitGap: slitGap,
        barrierCenterX: Math.floor(width / 2)
    };
}

/**
 * calculates adaptive barrier geometry for tunneling experiment
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @returns {object} geometry parameters scaled to fit grid
 */
function calculateAdaptiveBarrierGeometry(width, height) {
    const minThickness = 2;
    const baseThickness = Math.max(minThickness, Math.floor(width * 0.04)); // 4% of width, min 2
    
    return {
        barrierThickness: Math.min(baseThickness, width - 4), // ensure fits with margin
        barrierCenterX: Math.floor(width / 2)
    };
}

/**
 * validates preset compatibility with grid dimensions
 * @param {string} presetName - name of the preset
 * @param {number} width - grid width
 * @param {number} height - grid height
 * @returns {object} {compatible: boolean, warnings: string[]}
 */
function validatePresetCompatibility(presetName, width, height) {
    const warnings = [];
    let compatible = true;
    
    const minGridSize = 16;
    if (width < minGridSize || height < minGridSize) {
        compatible = false;
        warnings.push(`Grid too small (${width}x${height}). Minimum size: ${minGridSize}x${minGridSize}`);
    }
    
    if (presetName === 'DOUBLE_SLIT') {
        const geom = calculateAdaptiveSlitGeometry(width, height);
        if (geom.slitHeight < 3 || geom.slitGap < 6) {
            warnings.push('Grid size may produce suboptimal double slit visualization');
        }
    }
    
    if (presetName === 'TUNNELING') {
        const geom = calculateAdaptiveBarrierGeometry(width, height);
        if (geom.barrierThickness < 3) {
            warnings.push('Grid size may produce thin tunneling barrier - consider larger grid');
        }
    }
    
    return { compatible, warnings };
}

export const PRESETS = {
    DOUBLE_SLIT: {
        description: "demonstrates wave-particle duality and interference.",
        draw: (potential, width, height, barrierPhaseKick) => {
            // validate compatibility first
            const validation = validatePresetCompatibility('DOUBLE_SLIT', width, height);
            if (!validation.compatible) {
                console.error('DOUBLE_SLIT preset incompatible with grid size:', validation.warnings);
                return;
            }
            
            // log warnings if any
            validation.warnings.forEach(warning => console.warn('DOUBLE_SLIT:', warning));
            
            // calculate adaptive geometry
            const geom = calculateAdaptiveSlitGeometry(width, height);
            
            // position the slits symmetrically around the vertical center
            const slit1_CenterY = Math.floor(height / 2 - geom.slitGap / 2);
            const slit2_CenterY = Math.floor(height / 2 + geom.slitGap / 2);

            // draw barrier with bounds-safe iteration
            const xStart = geom.barrierCenterX - Math.floor(geom.barrierWidth / 2);
            const xEnd = geom.barrierCenterX + Math.floor(geom.barrierWidth / 2);
            
            for (let x = xStart; x < xEnd; x++) {
                for (let y = 0; y < height; y++) {
                    // check if the current y-position is within the bounds of either slit
                    const inSlit1 = (y >= slit1_CenterY - Math.floor(geom.slitHeight / 2)) && 
                                   (y < slit1_CenterY + Math.floor(geom.slitHeight / 2));
                    const inSlit2 = (y >= slit2_CenterY - Math.floor(geom.slitHeight / 2)) && 
                                   (y < slit2_CenterY + Math.floor(geom.slitHeight / 2));

                    // if the pixel is NOT in a slit, draw the barrier with bounds checking
                    if (!inSlit1 && !inSlit2) {
                        safeSetPotential(potential, x, y, width, height, barrierPhaseKick * 2.0);
                    }
                }
            }
        }
    },
    TUNNELING: {
        description: "shows quantum tunneling through a potential barrier.",
        draw: (potential, width, height, barrierPhaseKick) => {
            // validate compatibility first
            const validation = validatePresetCompatibility('TUNNELING', width, height);
            if (!validation.compatible) {
                console.error('TUNNELING preset incompatible with grid size:', validation.warnings);
                return;
            }
            
            // log warnings if any
            validation.warnings.forEach(warning => console.warn('TUNNELING:', warning));
            
            // calculate adaptive geometry
            const geom = calculateAdaptiveBarrierGeometry(width, height);

            // draw barrier with bounds-safe iteration
            const xStart = geom.barrierCenterX - Math.floor(geom.barrierThickness / 2);
            const xEnd = geom.barrierCenterX + Math.floor(geom.barrierThickness / 2);
            
            for (let y = 0; y < height; y++) {
                for (let x = xStart; x < xEnd; x++) {
                    safeSetPotential(potential, x, y, width, height, barrierPhaseKick);
                }
            }
        }
    }
};
