import { SimulationState } from './SimulationState.js';
import { ComputationEngine } from './ComputationEngine.js';
import { Renderer } from './Renderer.js';
import { UIController } from './UIController.js';
import * as C from './constants.js';

// DEBUG flag: enable via ?debug URL parameter or localStorage.setItem('qc.debug','1')
const DEBUG = (new URLSearchParams(location.search).has('debug') || (typeof localStorage !== 'undefined' && localStorage.getItem('qc.debug') === '1'));

const canvas = document.getElementById('sim-canvas');
if (!canvas) {
    throw new Error('Critical error: Canvas element with id "sim-canvas" not found in DOM. Check index.html structure.');
}
// === DPR-AWARE CANVAS SIZING (Bug fixed) ===
const devicePixelRatio = window.devicePixelRatio || 1;
const backingStoreWidth = Math.ceil(C.GRID_SIZE * devicePixelRatio);
const backingStoreHeight = Math.ceil(C.GRID_SIZE * devicePixelRatio);

// set backing store dimensions for sharp rendering on high-DPI displays
canvas.width = backingStoreWidth;
canvas.height = backingStoreHeight;

if (DEBUG) {
    console.log(`[DPR FIX] Canvas sizing - DPR: ${devicePixelRatio}, CSS: ${C.GRID_SIZE}x${C.GRID_SIZE}, Backing store: ${backingStoreWidth}x${backingStoreHeight}`);
}

// validate against WebGL texture limits
const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
if (gl) {
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (backingStoreWidth > maxTextureSize || backingStoreHeight > maxTextureSize) {
        console.warn(`[DPR FIX] Backing store ${backingStoreWidth}x${backingStoreHeight} exceeds max texture size ${maxTextureSize}, falling back to base resolution`);
        canvas.width = C.GRID_SIZE;
        canvas.height = C.GRID_SIZE;
    }
}

// store current DPR for change detection
let currentDPR = devicePixelRatio;
const state = new SimulationState();
const engine = new ComputationEngine(state.gridSize);
const renderer = new Renderer(canvas);
// eslint-disable-next-line no-unused-vars
const uiController = new UIController(canvas, state);

// error tracking for robustness monitoring
let computationErrorCount = 0;
let renderingErrorCount = 0;
let consecutiveComputationErrors = 0;
let consecutiveRenderingErrors = 0;
let lastErrorLogTime = 0;
let skipComputationFrames = 0;

// animation loop control system (Bug/feat)
let isAnimationRunning = false;
let isPaused = false;
let isTabVisible = !document.hidden;
let animationFrameId = null;

/**
 * animation loop with comprehensive error handling and visibility control
 * fixed: conditional RAF execution based on visibility and pause state
 */
/**
 * check if computation should be skipped due to degraded mode
 * @private
 * @returns {boolean} true if computation should be skipped
 */
function _shouldSkipComputation() {
    if (skipComputationFrames > 0) {
        skipComputationFrames--;
        if (skipComputationFrames === 0) {
            if (DEBUG) {
                console.log('[RECOVERY] Attempting to resume computation after degradation period');
            }
        }
        return true;
    }
    return false;
}

/**
 * execute computation step with basic error handling
 * @private
 * @returns {Error|null} error if computation failed, null on success
 */
function _executeComputationStep() {
    try {
        engine.step(state);
        consecutiveComputationErrors = 0; // reset on success
        return null;
    } catch (error) {
        computationErrorCount++;
        consecutiveComputationErrors++;
        return error;
    }
}

/**
 * handle computation error logging and graceful degradation
 * @private
 * @param {Error} error - the computation error to handle
 */
function _logAndDegradeOnComputationError(error) {
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

/**
 * handle the computation phase with error handling and degradation
 * @private
 */
function _handleComputationPhase() {
    if (_shouldSkipComputation()) return;
    
    const error = _executeComputationStep();
    if (error) {
        _logAndDegradeOnComputationError(error);
    }
}

/**
 * execute rendering step with basic error handling
 * @private
 * @returns {Error|null} error if rendering failed, null on success
 */
function _executeRenderingStep() {
    try {
        renderer.draw(state);
        consecutiveRenderingErrors = 0; // reset on success
        return null;
    } catch (error) {
        renderingErrorCount++;
        consecutiveRenderingErrors++;
        return error;
    }
}

/**
 * handle rendering error logging and WebGL context detection
 * @private
 * @param {Error} error - the rendering error to handle
 */
function _handleRenderingErrors(error) {
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
}

/**
 * attempt WebGL context recovery after repeated failures
 * @private
 */
function _recoverFromWebGLLoss() {
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

/**
 * handle the rendering phase with error handling and recovery
 * @private
 */
function _handleRenderingPhase() {
    const error = _executeRenderingStep();
    if (error) {
        _handleRenderingErrors(error);
        _recoverFromWebGLLoss();
    }
}

/**
 * monitor frame performance and log warnings for slow frames
 * @param {number} frameStart - The performance.now() timestamp when frame started
 * @private
 */
function _monitorPerformance(frameStart) {
    const frameTime = performance.now() - frameStart;
    if (DEBUG && frameTime > 16.67) { // >60fps threshold
        console.warn(`[PERFORMANCE] Slow frame: ${frameTime.toFixed(2)}ms (target: <16.67ms)`);
    }
}

/**
 * schedule the next animation frame based on visibility and pause state
 * @private
 */
function _scheduleNextFrame() {
    // fixed: conditional RAF based on visibility and pause state
    if (isAnimationRunning && !isPaused && isTabVisible) {
        animationFrameId = requestAnimationFrame(gameLoop);
    } else {
        animationFrameId = null;
    }
}

/**
 * animation loop with comprehensive error handling and visibility control
 * fixed: conditional RAF execution based on visibility and pause state
 */
function gameLoop() {
    const frameStart = performance.now();
    
    _handleComputationPhase();
    _handleRenderingPhase();
    _monitorPerformance(frameStart);
    _scheduleNextFrame();
}

/**
 * start the animation loop
 */
function startAnimation() {
    if (!isAnimationRunning) {
        isAnimationRunning = true;
        if (DEBUG) {
            console.log('[ANIMATION CONTROL] Animation started');
        }
        if (!isPaused && isTabVisible) {
            animationFrameId = requestAnimationFrame(gameLoop);
        }
    }
}

/**
 * pause the animation loop
 */
function pauseAnimation() {
    if (!isPaused) {
        isPaused = true;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        if (DEBUG) {
            console.log('[ANIMATION CONTROL] Animation paused');
        }
    }
}

/**
 * resume the animation loop
 */
function resumeAnimation() {
    if (isPaused) {
        isPaused = false;
        if (DEBUG) {
            console.log('[ANIMATION CONTROL] Animation resumed');
        }
        if (isAnimationRunning && isTabVisible) {
            animationFrameId = requestAnimationFrame(gameLoop);
        }
    }
}

/**
 * Stop the animation loop completely
 */
function stopAnimation() {
    isAnimationRunning = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (DEBUG) {
        console.log('[ANIMATION CONTROL] Animation stopped');
    }
}

/**
 * toggle pause/resume state
 */
function toggleAnimation() {
    if (isPaused) {
        resumeAnimation();
    } else {
        pauseAnimation();
    }
}

// page visibility API integration (bug/feat)
function handleVisibilityChange() {
    const wasVisible = isTabVisible;
    isTabVisible = !document.hidden;
    
    if (isTabVisible && !wasVisible) {
        // tab became visible
        if (DEBUG) {
            console.log('[VISIBILITY] Tab became visible - resuming animation');
        }
        if (isAnimationRunning && !isPaused) {
            animationFrameId = requestAnimationFrame(gameLoop);
        }
    } else if (!isTabVisible && wasVisible) {
        // tab became hidden
        if (DEBUG) {
            console.log('[VISIBILITY] Tab became hidden - pausing animation to save resources');
        }
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
    }
}

// setup page visibility API listeners
document.addEventListener('visibilitychange', handleVisibilityChange);

// keyboard shortcut for pause/play (spacebar)
document.addEventListener('keydown', (event) => {
    if (event.code === 'Space' && !event.target.matches('input, textarea, select')) {
        event.preventDefault();
        toggleAnimation();
    }
});

// export animation control functions to window for UI access
window.startAnimation = startAnimation;
window.pauseAnimation = pauseAnimation;
window.resumeAnimation = resumeAnimation;
window.stopAnimation = stopAnimation;
window.toggleAnimation = toggleAnimation;
window.isPaused = () => isPaused;
window.isAnimationRunning = () => isAnimationRunning;
window.isTabVisible = () => isTabVisible;

// start the animation loop
startAnimation();

// === DPR CHANGE DETECTION AND RECOVERY (bug/feat) ===
function handleDPRChange() {
    const newDPR = window.devicePixelRatio || 1;
    if (newDPR !== currentDPR) {
        if (DEBUG) {
            console.log(`[DPR CHANGE] Device pixel ratio changed from ${currentDPR} to ${newDPR} - updating canvas`);
        }
        
        const newBackingStoreWidth = Math.ceil(C.GRID_SIZE * newDPR);
        const newBackingStoreHeight = Math.ceil(C.GRID_SIZE * newDPR);
        
        // validate against WebGL texture limits
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (gl) {
            const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
            if (newBackingStoreWidth > maxTextureSize || newBackingStoreHeight > maxTextureSize) {
                console.warn(`[DPR CHANGE] New backing store ${newBackingStoreWidth}x${newBackingStoreHeight} exceeds max texture size ${maxTextureSize}, keeping current size`);
                return; // don't change if it would exceed limits
            }
        }
        
        // update canvas backing store
        canvas.width = newBackingStoreWidth;
        canvas.height = newBackingStoreHeight;
        
        // recreate renderer with new dimensions (preserves simulation state)
        try {
            const newRenderer = new Renderer(canvas);
            // replace the old renderer reference
            Object.setPrototypeOf(renderer, newRenderer.constructor.prototype);
            Object.assign(renderer, newRenderer);
            if (DEBUG) {
                console.log(`[DPR CHANGE] Successfully updated renderer for ${newBackingStoreWidth}x${newBackingStoreHeight} backing store`);
            }
        } catch (error) {
            console.error('[DPR CHANGE] Failed to recreate renderer:', error.message);
            // fallback: revert canvas size
            canvas.width = Math.ceil(C.GRID_SIZE * currentDPR);
            canvas.height = Math.ceil(C.GRID_SIZE * currentDPR);
            return;
        }
        
        currentDPR = newDPR;
    }
}

// monitor for DPR changes (browser zoom, display switching, window dragging between displays)
window.addEventListener('resize', handleDPRChange);
window.addEventListener('orientationchange', handleDPRChange);

// === robustness testing functions ===
// these functions can be called from browser console to test error handling

// Wrap test utilities in DEBUG guard
if (DEBUG) {
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
     * test animation control system
     * usage: window.testAnimationControl() - test pause/resume functionality
     */
    window.testAnimationControl = function() {
        console.log('[TEST] Testing animation control system...');
        console.log('[TEST] Current state:', {
            running: isAnimationRunning,
            paused: isPaused,
            visible: isTabVisible
        });
        
        setTimeout(() => {
            console.log('[TEST] Pausing animation...');
            pauseAnimation();
        }, 1000);
        
        setTimeout(() => {
            console.log('[TEST] Resuming animation...');
            resumeAnimation();
        }, 3000);
        
        setTimeout(() => {
            console.log('[TEST] Animation control test complete');
        }, 4000);
    };
}

// Keep error monitoring and reset functions always available for production monitoring
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
    if (DEBUG) {
        console.log('[TEST] All error counters reset');
    }
};

if (DEBUG) {
    console.log(`
DEBUG MODE ENABLED - development features available:

ANIMATION CONTROL:
• Spacebar - pause/resume animation
• Pause button in UI - manual control
• Automatic pause when tab is hidden (Page Visibility API)
• Zero resource usage in background tabs

TESTING FUNCTIONS:
• window.testAnimationControl() - test pause/resume system
• window.testComputationErrors(N) - inject N computation errors
• window.testRenderingErrors(N) - inject N rendering errors
• window.testComputationDegradation() - test graceful degradation
• window.testRenderingRecovery() - test recovery mechanisms
• window.testStateCorruption() - test corruption detection

MONITORING FUNCTIONS (always available):
• window.getErrorStats() - view current error statistics
• window.resetErrorCounters() - reset for fresh testing

RESOURCE CONSERVATION: animation automatically pauses when tab is hidden.
switch to another tab and return - check console for visibility messages.
    `);
}
