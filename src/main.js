import { SimulationState } from './SimulationState.js';
import { ComputationEngine } from './ComputationEngine.js';
import { Renderer } from './Renderer.js';
import { UIController } from './UIController.js';
import * as C from './constants.js';

const canvas = document.getElementById('sim-canvas');
if (!canvas) {
    throw new Error('Critical error: Canvas element with id "sim-canvas" not found in DOM. Check index.html structure.');
}
// === DPR-AWARE CANVAS SIZING (Bug #12 fix) ===
const devicePixelRatio = window.devicePixelRatio || 1;
const backingStoreWidth = Math.ceil(C.GRID_SIZE * devicePixelRatio);
const backingStoreHeight = Math.ceil(C.GRID_SIZE * devicePixelRatio);

// Set backing store dimensions for sharp rendering on high-DPI displays
canvas.width = backingStoreWidth;
canvas.height = backingStoreHeight;

console.log(`[DPR FIX] Canvas sizing - DPR: ${devicePixelRatio}, CSS: ${C.GRID_SIZE}x${C.GRID_SIZE}, Backing store: ${backingStoreWidth}x${backingStoreHeight}`);

// Validate against WebGL texture limits
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
if (gl) {
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (backingStoreWidth > maxTextureSize || backingStoreHeight > maxTextureSize) {
        console.warn(`[DPR FIX] Backing store ${backingStoreWidth}x${backingStoreHeight} exceeds max texture size ${maxTextureSize}, falling back to base resolution`);
        canvas.width = C.GRID_SIZE;
        canvas.height = C.GRID_SIZE;
    }
}

// Store current DPR for change detection
let currentDPR = devicePixelRatio;
const state = new SimulationState();
const engine = new ComputationEngine(state.gridSize);
const renderer = new Renderer(canvas);
// eslint-disable-next-line no-unused-vars
const uiController = new UIController(canvas, state);

// Error tracking for robustness monitoring
let computationErrorCount = 0;
let renderingErrorCount = 0;
let consecutiveComputationErrors = 0;
let consecutiveRenderingErrors = 0;
let lastErrorLogTime = 0;
let skipComputationFrames = 0;

/**
 * animation loop with comprehensive error handling
 * guarantees RAF continuation even during exceptions - fixes bug #8
 */
function gameLoop() {
    const frameStart = performance.now();
    
    // === computation phase ===
    // skip computation if in degraded mode due to repeated failures
    if (skipComputationFrames > 0) {
        skipComputationFrames--;
        if (skipComputationFrames === 0) {
            console.log('[RECOVERY] Attempting to resume computation after degradation period');
        }
    } else {
        try {
            engine.step(state);
            consecutiveComputationErrors = 0; // reset on success
        } catch (error) {
            computationErrorCount++;
            consecutiveComputationErrors++;
            
            // rate-limited logging to prevent console spam
            const now = Date.now();
            if (now - lastErrorLogTime > 1000) { // max 1 log per second
                console.error(`[COMPUTATION ERROR ${computationErrorCount}] Frame ${performance.now().toFixed(1)}ms:`,
                    error.message, error.stack?.split('\n')[1] || '');
                lastErrorLogTime = now;
                
                // state corruption detection
                if (state.psi && (isNaN(state.psi[0]) || !isFinite(state.psi[0]))) {
                    console.warn('[CRITICAL] Wave function corruption detected - simulation state may be invalid');
                }
            }
            
            // graceful degradation: skip computation for 60 frames after 5 consecutive failures
            if (consecutiveComputationErrors >= 5) {
                skipComputationFrames = 60;
                console.warn(`[DEGRADATION] Skipping computation for ${skipComputationFrames} frames due to repeated failures`);
            }
        }
    }
    
    // === rendering phase ===
    try {
        renderer.draw(state);
        consecutiveRenderingErrors = 0; // reset on success
    } catch (error) {
        renderingErrorCount++;
        consecutiveRenderingErrors++;
        
        // rate-limited logging to prevent console spam
        const now = Date.now();
        if (now - lastErrorLogTime > 1000) { // max 1 log per second
            console.error(`[RENDERING ERROR ${renderingErrorCount}] Frame ${performance.now().toFixed(1)}ms:`,
                error.message, error.stack?.split('\n')[1] || '');
            lastErrorLogTime = now;
            
            // WebGL context loss detection
            if (renderer.regl && renderer.regl._gl && renderer.regl._gl.isContextLost()) {
                console.warn('[CRITICAL] WebGL context lost - attempting recovery on next frame');
            }
        }
        
        // graceful degradation: attempt WebGL recovery after 3 consecutive failures
        if (consecutiveRenderingErrors >= 3) {
            console.warn('[RECOVERY] Attempting WebGL context recovery due to repeated rendering failures');
            try {
                // attempt to reinitialise renderer resources
                if (renderer.psiTexture) renderer.psiTexture.destroy();
                if (renderer.potentialTexture) renderer.potentialTexture.destroy();
                // note: full renderer reinitialisation would require canvas reference
                consecutiveRenderingErrors = 0; // reset after recovery attempt
            } catch (recoveryError) {
                console.error('[RECOVERY FAILED]', recoveryError.message);
            }
        }
    }
    
    // === performance monitoring ===
    const frameTime = performance.now() - frameStart;
    if (frameTime > 16.67) { // >60fps threshold
        console.warn(`[PERFORMANCE] Slow frame: ${frameTime.toFixed(2)}ms (target: <16.67ms)`);
    }
    
    // === guaranteed RAF continuation ===
    // this MUST execute regardless of any exceptions above
    // fixes: unguarded per-frame loop
    requestAnimationFrame(gameLoop);
}

gameLoop();

// === DPR CHANGE DETECTION AND RECOVERY (Bug #12) ===
function handleDPRChange() {
    const newDPR = window.devicePixelRatio || 1;
    if (newDPR !== currentDPR) {
        console.log(`[DPR CHANGE] Device pixel ratio changed from ${currentDPR} to ${newDPR} - updating canvas`);
        
        const newBackingStoreWidth = Math.ceil(C.GRID_SIZE * newDPR);
        const newBackingStoreHeight = Math.ceil(C.GRID_SIZE * newDPR);
        
        // Validate against WebGL texture limits
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (newBackingStoreWidth > maxTextureSize || newBackingStoreHeight > maxTextureSize) {
                console.warn(`[DPR CHANGE] New backing store ${newBackingStoreWidth}x${newBackingStoreHeight} exceeds max texture size ${maxTextureSize}, keeping current size`);
                return; // Don't change if it would exceed limits
            }
        }
        
        // Update canvas backing store
        canvas.width = newBackingStoreWidth;
        canvas.height = newBackingStoreHeight;
        
        // Recreate renderer with new dimensions (preserves simulation state)
        try {
            const newRenderer = new Renderer(canvas);
            // Replace the old renderer reference
            Object.setPrototypeOf(renderer, newRenderer.constructor.prototype);
            Object.assign(renderer, newRenderer);
            console.log(`[DPR CHANGE] Successfully updated renderer for ${newBackingStoreWidth}x${newBackingStoreHeight} backing store`);
        } catch (error) {
            console.error('[DPR CHANGE] Failed to recreate renderer:', error.message);
            // Fallback: revert canvas size
            canvas.width = Math.ceil(C.GRID_SIZE * currentDPR);
            canvas.height = Math.ceil(C.GRID_SIZE * currentDPR);
            return;
        }
        
        currentDPR = newDPR;
    }
}

// Monitor for DPR changes (browser zoom, display switching, window dragging between displays)
window.addEventListener('resize', handleDPRChange);
window.addEventListener('orientationchange', handleDPRChange);

// === robustness testing functions ===
// these functions can be called from browser console to test error handling

/**
 * test computation error handling by injecting temporary failures
 * usage: window.testComputationErrors(3) - injects 3 consecutive errors
 */
window.testComputationErrors = function(errorCount = 1) {
    console.log(`[TEST] Injecting ${errorCount} computation errors...`);
    let errorsInjected = 0;
    
    const originalStep = engine.step.bind(engine);
    engine.step = function(simulationState) {
        if (errorsInjected < errorCount) {
            errorsInjected++;
            throw new Error(`TEST: Injected computation error ${errorsInjected}/${errorCount}`);
        } else {
            // restore original function after test
            engine.step = originalStep;
            console.log('[TEST] Computation error injection complete - restored original function');
            return originalStep(simulationState);
        }
    };
};

/**
 * test rendering error handling by injecting temporary failures
 * usage: window.testRenderingErrors(2) - injects 2 consecutive errors
 */
window.testRenderingErrors = function(errorCount = 1) {
    console.log(`[TEST] Injecting ${errorCount} rendering errors...`);
    let errorsInjected = 0;
    
    const originalDraw = renderer.draw.bind(renderer);
    renderer.draw = function(simulationState) {
        if (errorsInjected < errorCount) {
            errorsInjected++;
            throw new Error(`TEST: Injected rendering error ${errorsInjected}/${errorCount} - simulating WebGL failure`);
        } else {
            // restore original function after test
            renderer.draw = originalDraw;
            console.log('[TEST] Rendering error injection complete - restored original function');
            return originalDraw(simulationState);
        }
    };
};

/**
 * test severe computation errors that trigger graceful degradation
 * usage: window.testComputationDegradation() - triggers 5+ consecutive errors
 */
window.testComputationDegradation = function() {
    console.log('[TEST] Testing computation degradation (5+ consecutive errors)...');
    window.testComputationErrors(6);
};

/**
 * test severe rendering errors that trigger recovery attempts  
 * usage: window.testRenderingRecovery() - triggers 3+ consecutive errors
 */
window.testRenderingRecovery = function() {
    console.log('[TEST] Testing rendering recovery (3+ consecutive errors)...');
    window.testRenderingErrors(4);
};

/**
 * test state corruption detection
 * usage: window.testStateCorruption() - corrupts wave function data
 */
window.testStateCorruption = function() {
    console.log('[TEST] Testing state corruption detection...');
    if (state.psi && state.psi.length > 0) {
        state.psi[0] = NaN;
        state.psi[1] = Infinity;
        console.log('[TEST] Wave function corrupted with NaN/Infinity - check for detection on next frame');
    }
};

/**
 * monitor error rates and performance
 * usage: window.getErrorStats() - returns current error statistics
 */
window.getErrorStats = function() {
    return {
        computationErrors: computationErrorCount,
        renderingErrors: renderingErrorCount,
        consecutiveComputationErrors: consecutiveComputationErrors,
        consecutiveRenderingErrors: consecutiveRenderingErrors,
        skipComputationFrames: skipComputationFrames,
        status: skipComputationFrames > 0 ? 'DEGRADED' : 'NORMAL'
    };
};

/**
 * reset all error counters for fresh testing
 * usage: window.resetErrorCounters()
 */
window.resetErrorCounters = function() {
    computationErrorCount = 0;
    renderingErrorCount = 0;
    consecutiveComputationErrors = 0;
    consecutiveRenderingErrors = 0;
    skipComputationFrames = 0;
    lastErrorLogTime = 0;
    console.log('[TEST] All error counters reset');
};

console.log(`
bug 8 (unguarded per-frame loop) fixed - testing functions available:

• window.testComputationErrors(N) - inject N computation errors
• window.testRenderingErrors(N) - inject N rendering errors  
• window.testComputationDegradation() - test graceful degradation
• window.testRenderingRecovery() - test recovery mechanisms
• window.testStateCorruption() - test corruption detection
• window.getErrorStats() - view current error statistics
• window.resetErrorCounters() - reset for fresh testing

the animation loop will never stop, even during severe errors.
monitor console for error handling and recovery messages.
`);
