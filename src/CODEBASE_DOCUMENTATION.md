# Quantum Canvas - Codebase Documentation

## Table of Contents

- [Overview](#overview)
- [System Architecture & File Structure](#system-architecture--file-structure)
- [Core Modules & Implementation Details](#core-modules--implementation-details)
  - [Application Core & Lifecycle (main.js)](#application-core--lifecycle-mainjs)
  - [State Management (SimulationState.js)](#state-management-simulationstatejs)
  - [Physics Engine (ComputationEngine.js)](#physics-engine-computationenginejs)
  - [Rendering Engine (Renderer.js)](#rendering-engine-rendererjs)
  - [UI & Interaction (UIController.js)](#ui--interaction-uicontrollerjs)
  - [Mathematical Foundations (fft.js & constants.js)](#mathematical-foundations-fftjs--constantsjs)
- [Key Features Deep Dive](#key-features-deep-dive)
  - [Robustness & Error Handling](#robustness--error-handling)
  - [Resource Management & Performance](#resource-management--performance)
  - [Debugging & Testing Interface](#debugging--testing-interface)
- [UI Design System & Layout](#ui-design-system--layout)

## Overview

this document provides a comprehensive technical guide to the Quantum Canvas codebase. The application is a browser-based 2D quantum wave function simulator that leverages a custom physics engine and an advanced WebGL rendering pipeline.

the system is designed to be both an educational tool and a high-performance interactive simulation. it features a quantum-accurate solver for the time-dependent schrödinger equation, a rich visualisation layer, and extensive user interaction capabilities.

### Key Technical Features

- **Robust Animation Control**: the main loop automatically pauses when the browser tab is hidden and provides manual pause/play controls, conserving system resources.

- **Advanced Error Handling**: the system actively monitors for computation and rendering errors, entering a graceful degradation mode to prevent crashes and attempting recovery.

- **High-DPI Rendering**: the canvas and renderer are fully aware of the device pixel ratio (DPR), ensuring sharp visuals on all displays and handling runtime DPR changes (e.g., browser zoom).

- **Modular, Data-Driven Architecture**: physics, rendering, and UI logic are cleanly separated into distinct modules that operate on a central [`SimulationState`](src/SimulationState.js) object.

- **Interactive Physics Playground**: users can directly manipulate the simulation by drawing potential barriers, dragging the wave packet, or applying physically accurate momentum "nudges".

## System Architecture & File Structure

the project follows a modular ES6 architecture, separating concerns into distinct files.

### Module Responsibilities

| File | Responsibility |
|------|----------------|
| [`main.js`](src/main.js) | application core: Initialises all modules, runs the main animation loop, and manages error handling, resource conservation, and the debugging interface. |
| [`SimulationState.js`](src/SimulationState.js) | data model: Contains the canonical state of the simulation, including the wave function (psi), potential fields, and all configurable physical parameters. |
| [`ComputationEngine.js`](src/ComputationEngine.js) | physics engine: Implements the split-step fourier method to evolve the wave function over time. |
| [`Renderer.js`](src/Renderer.js) | visualisation: manages all WebGL rendering, including the GLSL shaders that visualise the quantum state and potential fields. |
| [`UIController.js`](src/UIController.js) | user interaction: handles all input from the mouse and UI panel, translating user actions into state changes. |
| [`presets.js`](src/presets.js) | experiment definitions: contains data and logic for setting up classic experiments like the double slit, with adaptive geometry. |
| [`constants.js`](src/constants.js) | configuration: stores fundamental physical constants and default simulation parameters. |
| [`fft.js`](src/fft.js) | mathematics: provides a highly optimised, in-place Fast Fourier Transform and its inverse. |
| [`index.html`](index.html) | application shell: defines the DOM structure for the canvas and the UI control panel. |
| [`style.css`](src/style.css) | design system: implements the modern, GitHub-inspired dark theme and responsive layout for the UI. |

### Project File Structure
```
quantum-canvas/
├── index.html
└── src/
    ├── main.js
    ├── SimulationState.js
    ├── ComputationEngine.js
    ├── Renderer.js
    ├── UIController.js
    ├── presets.js
    ├── constants.js
    ├── fft.js
    └── style.css
```

## Core Modules & Implementation Details

### Application Core & Lifecycle (main.js)

[`main.js`](src/main.js) serves as the application's entry point and orchestrator. it initialises all other modules, sets up the DPR-aware canvas, and runs the main [`gameLoop()`](src/main.js:228).

#### Animation Lifecycle

the core of the application is the [`gameLoop()`](src/main.js:228), which is designed for robustness and efficiency. it only runs when the animation is active, not paused, and the browser tab is visible.

```javascript
function gameLoop() {
    const frameStart = performance.now();
    
    _handleComputationPhase();
    _handleRenderingPhase();
    _monitorPerformance(frameStart);
    _scheduleNextFrame();
}
```

the loop is composed of distinct phases, each with its own error handling:

- [`_handleComputationPhase()`](src/main.js:122): executes one step of the physics simulation via [`ComputationEngine`](src/ComputationEngine.js). it includes logic to skip frames if the system is in a degraded state.

- [`_handleRenderingPhase()`](src/main.js:191): draws the current [`SimulationState`](src/SimulationState.js) using the [`Renderer`](src/Renderer.js).

- [`_monitorPerformance()`](src/main.js:204): logs a warning if a frame takes longer than the 60fps budget (16.67ms).

- [`_scheduleNextFrame()`](src/main.js:215): conditionally schedules the next call to [`gameLoop()`](src/main.js:228) using `requestAnimationFrame`.

#### DPR-Aware Canvas Initialisation

the canvas is initialised with a backing store resolution that matches the device's pixel ratio, ensuring crisp rendering. it includes a fallback if the required texture size exceeds WebGL limits.

```javascript
const devicePixelRatio = window.devicePixelRatio || 1;
const backingStoreWidth = Math.ceil(C.GRID_SIZE * devicePixelRatio);
const backingStoreHeight = Math.ceil(C.GRID_SIZE * devicePixelRatio);

// set backing store dimensions for sharp rendering on high-DPI displays
canvas.width = backingStoreWidth;
canvas.height = backingStoreHeight;

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
```

### State Management (SimulationState.js)

this class is the single source of truth for the simulation's state.

#### params Object

all tunable physics and rendering parameters are stored in a centralised [`params`](src/SimulationState.js:6) object, allowing for easy runtime modification and UI synchronisation.

```javascript
this.params = {
    x0: C.INITIAL_X0, y0: C.INITIAL_Y0,
    px: C.INITIAL_P_X, py: C.INITIAL_P_Y,
    sigma: C.INITIAL_SIGMA,
    dt: C.INITIAL_DT, brightness: 1.0,
    boundaryMode: 'reflective', // 'reflective', 'absorbing', 'both'
    barrierPhaseKick: 1.5, // phase per step (radians) - dt-independent barrier strength
};
```

#### Boundary Condition Management

the state manages two primary types of boundary conditions, controlled by [`params.boundaryMode`](src/SimulationState.js:11).

**Reflective Boundaries**: a high-potential wall is created at the edges of the grid.

**Absorbing Boundaries**: a damping field is applied near the edges to prevent wave reflection, simulating an infinite space. this absorption is scaled by dt to be time-step independent.

```javascript
// From _applyAbsorbingBoundaries()
if (this.params.boundaryMode === 'absorbing' || this.params.boundaryMode === 'both') {
    // ...
    if (minDist < boundaryWidth) {
        // scale damping by dt to ensure time-step independence
        // this represents a continuous absorption rate rather than discrete per-step damping
        const dampingRate = 0.1 * (boundaryWidth - minDist); // absorption rate per unit time
        const dampingFactor = Math.exp(-dampingRate * this.params.dt);
        
        this.psi[idx] *= dampingFactor;         // real part
        this.psi[idx + 1] *= dampingFactor;     // imaginary part
    }
}
```

### Physics Engine (ComputationEngine.js)

this module contains the core physics logic, implementing the split-step fourier method to solve the time-dependent schrödinger equation.

#### The step() Method

the [`step()`](src/ComputationEngine.js:58) method advances the simulation by one time step. a critical bug was fixed where absorbing boundaries are now applied before the kinetic step to prevent artefacts from the FFT's periodic nature.

```javascript
step(state) {
    this._applyPotential(state);
    
    // fixed a BUG: applied absorbing boundaries BEFORE kinetic evolution
    // which prevents wrap artefacts during FFT-based kinetic step in k-space
    state._applyAbsorbingBoundaries();
    
    this._applyKinetic(state);
    this._applyPotential(state);
    
    // keep post-step absorption for additional safety
    state._applyAbsorbingBoundaries();
}
```

- [`_applyPotential(state)`](src/ComputationEngine.js:79): applies the potential energy operator, $e^{-iV\Delta t / 2\hbar}$, in position space. the phase kick from user-drawn barriers is applied directly, independent of dt.

- [`_applyKinetic(state)`](src/ComputationEngine.js:107): applies the kinetic energy operator, $e^{-iT\Delta t / \hbar}$, in momentum space. this involves a forward 2D FFT, multiplication by the pre-calculated kinetic operator, and an inverse 2D FFT.

### Rendering Engine (Renderer.js)

the renderer uses regl to manage WebGL and visualises the complex wave function data with a custom GLSL shader.

#### CPU-Side Data Preparation

before rendering, the Float32Array data for psi and potential must be packed into Uint8Array textures. this process scales the data to the DPR-aware backing store dimensions of the canvas.

```javascript
// In draw() method
// Get the simulation grid dimensions from the wave function array length
const simGridSize = Math.sqrt(state.psi.length / 2); // complex numbers = length/2
const scaleX = this.backingStoreWidth / simGridSize;
const scaleY = this.backingStoreHeight / simGridSize;

// pack complex wave function data into rgba texture format with DPR scaling
// convert float values to 0-255 byte range for uint8 texture
for (let backingY = 0; backingY < this.backingStoreHeight; backingY++) {
    for (let backingX = 0; backingX < this.backingStoreWidth; backingX++) {
        // map backing store coordinates to simulation grid coordinates
        const simX = Math.floor(backingX / scaleX);
        const simY = Math.floor(backingY / scaleY);
        const simIdx = (simY * simGridSize + simX) * 2; // complex array index
        const backingIdx = (backingY * this.backingStoreWidth + backingX) * 4; // rgba index
        
        // convert float values to 0-255 range
        // map from [-1, 1] to [0, 255] with offset for negative values
        const real = state.psi[simIdx];
        const imag = state.psi[simIdx + 1];
        
        this.textureDataBuffer[backingIdx] = Math.floor((real + 1.0) * 127.5);     // real -> r
        this.textureDataBuffer[backingIdx + 1] = Math.floor((imag + 1.0) * 127.5); // imag -> g
        this.textureDataBuffer[backingIdx + 2] = 0;                                // blue
        this.textureDataBuffer[backingIdx + 3] = 255;                              // alpha
    }
}
// ... (similar loop for potentialDataBuffer) ...
this.psiTexture.subimage(this.textureDataBuffer);
this.potentialTexture.subimage(this.potentialDataBuffer);
```

#### Fragment Shader

the GLSL fragment shader is responsible for the final look. it decodes the wave function from the texture, applies a series of effects, and outputs the final colour.

```glsl
// Full Fragment Shader from Renderer.js
precision mediump float;
uniform sampler2D psiTexture;
uniform sampler2D potentialTexture;
uniform float u_brightness;
uniform vec2 u_textureSize;
varying vec2 uv;

const float PI = 3.14159265359;
const float TWO_PI = 6.28318530718;

// Enhanced quantum colour mapping
vec3 quantumColorMapping(float magnitude, float phase) {
    // Phase-based colour mapping with improved perceptual uniformity
    float hue = phase / TWO_PI; // Normalise phase to [0,1]
    float saturation = clamp(magnitude * 2.0, 0.0, 1.0);
    float lightness = 0.3 + magnitude * 0.7;
    
    // HSL to RGB conversion
    vec3 hsl = vec3(hue, saturation, lightness);
    vec3 rgb = clamp(abs(mod(hsl.x*6.0+vec3(0.0,4.0,2.0), 6.0)-3.0)-1.0, 0.0, 1.0);
    return hsl.z + hsl.y * (rgb-0.5)*(1.0-abs(2.0*hsl.z-1.0));
}

// Simple glow effect using nearby samples
vec3 applyGlow(vec3 baseColor, float magnitude, vec2 uv) {
    vec2 texelSize = 1.0 / u_textureSize;
    vec3 glow = vec3(0.0);
    float glowStrength = magnitude * 0.5;
    
    // Sample nearby pixels for glow effect
    for (int x = -2; x <= 2; x++) {
        for (int y = -2; y <= 2; y++) {
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            vec2 samplePsi = texture2D(psiTexture, uv + offset).rg * 2.0 - 1.0;
            float sampleMag = length(samplePsi);
            float distance = length(vec2(float(x), float(y)));
            float weight = exp(-distance * distance / 8.0) * sampleMag;
            glow += baseColor * weight;
        }
    }
    
    return baseColor + glow * glowStrength * 0.1;
}

// Phase contours for quantum visualisation
vec3 applyPhaseContours(vec3 baseColor, float phase, float magnitude) {
    float contourInterval = PI / 4.0; // Contours every 45 degrees
    float normalizedPhase = mod(phase + PI, TWO_PI) / TWO_PI;
    float contourPhase = mod(normalizedPhase, contourInterval / TWO_PI);
    
    float contourWidth = 0.02;
    float contour = smoothstep(0.0, contourWidth, contourPhase) -
                   smoothstep(contourInterval / TWO_PI - contourWidth,
                            contourInterval / TWO_PI, contourPhase);
    
    float contourOpacity = 0.3 * smoothstep(0.1, 0.4, magnitude);
    vec3 contourColor = vec3(0.0, 0.0, 0.0);
    
    return mix(baseColor, contourColor, contour * contourOpacity);
}

// Potential barrier visualisation
vec3 applyPotentialBarriers(vec3 baseColor, float potential) {
    if (potential > 0.01) {
        vec3 barrierColor = vec3(0.8, 0.1, 0.1); // Red barriers
        float barrierOpacity = clamp(potential / 100.0, 0.0, 0.8);
        return mix(baseColor, barrierColor, barrierOpacity);
    }
    return baseColor;
}

// Enhanced magnitude scaling for better visibility
float enhanceMagnitude(float magnitude) {
    // Logarithmic scaling for small magnitudes
    if (magnitude < 0.1) {
        return pow(magnitude, 0.5) * 2.0;
    } else {
        return magnitude;
    }
}

void main() {
    // Read and convert complex wave function
    vec2 texel = texture2D(psiTexture, uv).rg;
    vec2 psi = (texel * 2.0) - 1.0;
    
    float magnitude = length(psi);
    float phase = atan(psi.y, psi.x);
    
    // Read potential barrier
    float potential = texture2D(potentialTexture, uv).r * 100.0; // Denormalise
    
    // Enhance small magnitudes for better visibility
    float enhancedMagnitude = enhanceMagnitude(magnitude);
    
    // Apply quantum colour mapping
    vec3 baseColor = quantumColorMapping(enhancedMagnitude, phase);
    
    // Apply glow effect
    vec3 glowColor = applyGlow(baseColor, enhancedMagnitude, uv);
    
    // Apply phase contours
    vec3 contourColor = applyPhaseContours(glowColor, phase, enhancedMagnitude);
    
    // Filter out low-magnitude quantisation noise to ensure the background remains pure black
    vec3 quantumColor;
    if (magnitude < 0.01) {
        // background stays pure black
        quantumColor = vec3(0.0);
    } else {
        // visible wave—brightness scales contour colour
        quantumColor = contourColor * u_brightness;
    }
    
    // overlay barriers at full strength
    vec3 finalColor = applyPotentialBarriers(quantumColor, potential);
    gl_FragColor = vec4(finalColor, 1.0);
}
```

### UI & Interaction (UIController.js)

this class connects all DOM elements to the simulation state and handles all user input.

#### Mouse Interaction Modes

the controller supports three distinct mouse modes, selected via radio buttons.

**Draw/Erase**: [`_applyBrush()`](src/UIController.js:268) is called on mouse move. it uses `event.button === 2` to reliably detect right-clicks for erasing. the brush has a circular falloff pattern and respects the main boundary walls.

**Drag Packet**: calls [`state.shiftWaveFunction()`](src/SimulationState.js:150) to move the entire wave function with the mouse.

**Nudge Packet**: on mouse up, calculates the drag vector and calls [`_applyMomentumKick()`](src/UIController.js:367) to impart a quantum-mechanically accurate momentum change. it then updates the UI sliders to reflect the new total momentum.

#### Quantum Momentum Kicks

this method applies a momentum kick by multiplying the wave function by a complex phase factor, which is the quantum operator for a momentum translation.

```javascript
_applyMomentumKick(deltaPx, deltaPy) {
    const width = this.state.gridSize.width;
    const height = this.state.gridSize.height;
    const hbar = C.HBAR;

    // Apply phase multiplication: ψ' = ψ * exp(i(Δp·r)/ℏ)
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = 2 * (y * width + x);
            const real = this.state.psi[idx];
            const imag = this.state.psi[idx + 1];
            
            // calculate phase: (Δpx*x + Δpy*y)/ℏ
            const phase = (deltaPx * x + deltaPy * y) / hbar;
            const cosPhase = Math.cos(phase);
            const sinPhase = Math.sin(phase);
            
            // complex multiplication: (real + i*imag) * (cos + i*sin)
            this.state.psi[idx] = real * cosPhase - imag * sinPhase;
            this.state.psi[idx + 1] = real * sinPhase + imag * cosPhase;
        }
    }
}
```

#### Experiment Presets

the UI controller can apply presets defined in [`presets.js`](src/presets.js). the preset logic clears any existing potentials, draws a new barrier configuration using adaptive geometry, sets optimal initial state parameters for that experiment, and resets the wave function.

### Mathematical Foundations (fft.js & constants.js)

#### constants.js

this file centralises all physical and simulation constants. a key addition is [`DOMAIN_SIZE`](src/constants.js:2), which decouples the physical dimensions of the simulation space from the grid resolution, allowing for more accurate physics calculations.

```javascript
export const GRID_SIZE = 256;
export const DOMAIN_SIZE = 512.0; // physical domain size (independent of resolution)
export const HBAR = 1;
export const MASS = 1;
export const INITIAL_DT = 0.005;
export const INITIAL_SIGMA = 15.0;
export const INITIAL_P_X = 60.0;
export const INITIAL_P_Y = 0.0;
export const INITIAL_X0 = DOMAIN_SIZE / 2; // centre in physical coordinates
export const INITIAL_Y0 = DOMAIN_SIZE / 2;
export const POTENTIAL_STRENGTH = 100.0;
export const BORDER_STRENGTH = 1e6;
```

#### fft.js

provides an in-place, power-of-2 Cooley-Tukey Fast Fourier Transform. it includes validation to throw an error if the input array size is not a power of 2. the inverse FFT is implemented using the conjugate method.

```javascript
// From fft()
// validate that input size is a power of 2
if (!Number.isInteger(Math.log2(n))) {
    throw new Error(`FFT requires input size to be a power of 2, but got ${n}. Valid sizes: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, etc.`);
}

// ... bit-reversal and Cooley-Tukey implementation ...
```

## Key Features Deep Dive

### Robustness & Error Handling

the application core in [`main.js`](src/main.js) features an extensive error handling and recovery system.

**Error Counting**: it tracks both total and consecutive errors for computation and rendering separately.

**Rate-Limited Logging**: errors are logged to the console at most once per second to prevent spam.

**State Corruption Detection**: after a computation error, it checks if the wave function data has become NaN or Infinity and logs a critical warning.

**Graceful Degradation**: if 5 consecutive computation errors occur, the physics engine is temporarily disabled for 60 frames to allow the system to recover, preventing a crash loop.

**WebGL Recovery**: after 3 consecutive rendering errors, it detects if the WebGL context was lost and attempts to re-initialise renderer resources.

```javascript
// Example: Graceful Degradation from _logAndDegradeOnComputationError()
if (consecutiveComputationErrors >= 5) {
    skipComputationFrames = 60;
    console.warn(`[DEGRADATION] Skipping computation for ${skipComputationFrames} frames due to repeated failures`);
}
```

### Resource Management & Performance

**Page Visibility API**: [`main.js`](src/main.js) uses the Page Visibility API to automatically pause the `requestAnimationFrame` loop when the tab is not in focus, reducing CPU/GPU usage to near zero. the animation resumes automatically when the tab becomes visible again.

**DPR Change Handling**: the system listens for resize and orientationchange events to detect changes in `window.devicePixelRatio`. if a change occurs, the canvas backing store is resized and the renderer is re-initialised to prevent blurriness or pixelation from browser zoom or moving the window between monitors.

**Memory Optimisation**: all numerical data is stored in Float32Arrays. the engine and renderer pre-allocate and reuse buffers to minimise garbage collection during the animation loop.

### Debugging & Testing Interface

[`main.js`](src/main.js) exposes a suite of testing functions on the window object, allowing developers to test the robustness of the system directly from the browser console.

| Function | Description |
|----------|-------------|
| `window.testComputationErrors(N)` | injects N consecutive computation errors to test error handling. |
| `window.testRenderingErrors(N)` | injects N consecutive rendering errors. |
| `window.testComputationDegradation()` | injects 6 computation errors to trigger the graceful degradation mode. |
| `window.testRenderingRecovery()` | injects 4 rendering errors to trigger the WebGL recovery attempt. |
| `window.testStateCorruption()` | manually corrupts the wave function data with NaN to test detection. |
| `window.getErrorStats()` | returns an object with the current error counts and system status. |
| `window.resetErrorCounters()` | resets all error statistics for fresh testing. |

## UI Design System & Layout

the UI is defined in [`index.html`](index.html) and styled by [`style.css`](src/style.css) to create a modern, functional control panel.

### index.html Structure

the HTML document provides the complete structure for the UI panel, including labelled control sections, buttons, radio inputs, and sliders for every configurable parameter.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Quantum Simulator</title>
    <link rel="stylesheet" href="src/style.css">
</head>
<body>
    <canvas id="sim-canvas"></canvas>
    <div id="ui-panel">
        <h3>Quantum Laboratory</h3>
        
        <div class="control-section">
            <h4>Simulation Controls</h4>
            <div class="control-group button-group">
                <button id="pause-button" class="control-button">Pause</button>
                <button id="reset-button" class="control-button">Reset Simulation</button>
                <button id="clear-button" class="control-button">Clear Walls</button>
            </div>
            
            <div class="control-group preset-group">
                <label class="section-label">Experiment Presets</label>
                <div class="preset-buttons">
                    <button id="double-slit-button" class="preset-button">
                        <span class="preset-name">Double Slit</span>
                        <span class="preset-desc">Wave Interference</span>
                    </button>
                    <button id="tunneling-button" class="preset-button">
                        <span class="preset-name">Tunneling Barrier</span>
                        <span class="preset-desc">Quantum Tunneling</span>
                    </button>
                </div>
            </div>
        </div>

        <div class="control-section">
            <h4>Mouse Interaction</h4>
            <div class="control-group mouse-mode-group">
                <div class="radio-group">
                    <input type="radio" id="mode-draw" name="mouseMode" value="draw" checked>
                    <label for="mode-draw">Draw/Erase</label>
                    
                    <input type="radio" id="mode-drag" name="mouseMode" value="drag">
                    <label for="mode-drag">Drag Packet</label>
                    
                    <input type="radio" id="mode-nudge" name="mouseMode" value="nudge">
                    <label for="mode-nudge">Nudge Packet</label>
                </div>
                <div class="mode-hint">
                    <span id="mode-hint-text">Left-click: Draw barriers • Right-click: Erase</span>
                </div>
            </div>
        </div>

        <div class="control-section">
            <h4>Boundary Physics</h4>
            <div class="control-group boundary-mode-group">
                <div class="radio-group">
                    <input type="radio" id="boundary-reflective" name="boundaryMode" value="reflective" checked>
                    <label for="boundary-reflective">Reflective Walls</label>
                    
                    <input type="radio" id="boundary-absorbing" name="boundaryMode" value="absorbing">
                    <label for="boundary-absorbing">Absorbing Boundaries</label>
                    
                    <input type="radio" id="boundary-both" name="boundaryMode" value="both">
                    <label for="boundary-both">Both (Demo Conflict)</label>
                </div>
                <div class="mode-hint">
                    <span>Reflective: Waves bounce back • Absorbing: Waves fade at edges</span>
                </div>
            </div>
        </div>

        <div class="control-section">
            <h4>Real-time Parameters</h4>
            <div class="control-group">
                <label for="brush-slider">Brush Size: <span id="brush-size-value" class="param-value">5</span></label>
                <input type="range" min="1" max="25" value="5" id="brush-slider" class="param-slider">
            </div>
            <div class="control-group">
                <label for="brightness-slider">Brightness: <span id="brightness-value" class="param-value">1.0</span></label>
                <input type="range" min="0.1" max="5" value="1.0" step="0.1" id="brightness-slider" class="param-slider">
            </div>
            <div class="control-group">
                <label for="dt-slider">Time Step (dt): <span id="dt-value" class="param-value">0.005</span></label>
                <input type="range" min="0.001" max="0.02" value="0.005" step="0.001" id="dt-slider" class="param-slider">
            </div>
            <div class="control-group">
                <label for="barrier-strength-slider">Barrier Strength: <span id="barrier-strength-value" class="param-value">1.5</span></label>
                <input type="range" min="0.0" max="3.14" value="1.5" step="0.1" id="barrier-strength-slider" class="param-slider">
            </div>
        </div>

        <div class="control-section initial-state-section">
            <h4>Initial State <span class="reset-note">(Applied on Reset)</span></h4>
            <div class="control-group">
                <label for="px-slider">Momentum X: <span id="px-value" class="param-value">60</span></label>
                <input type="range" min="-150" max="150" value="60" id="px-slider" class="initial-param-slider">
            </div>
            <div class="control-group">
                <label for="py-slider">Momentum Y: <span id="py-value" class="param-value">0</span></label>
                <input type="range" min="-150" max="150" value="0" id="py-slider" class="initial-param-slider">
            </div>
            <div class="control-group">
                <label for="sigma-slider">Packet Width: <span id="sigma-value" class="param-value">15</span></label>
                <input type="range" min="5" max="30" value="15" id="sigma-slider" class="initial-param-slider">
            </div>
        </div>
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/regl/dist/regl.min.js"></script>
    <script type="module" src="src/main.js"></script>
</body>
</html>
```

### style.css Design System

the stylesheet implements a GitHub-inspired dark theme with modern CSS features.

**Theme**: the colour palette, fonts, and layout mimic the GitHub UI for a professional, developer-friendly aesthetic.

**Glassmorphism**: the UI panel uses `backdrop-filter: blur(16px)` to create a modern semi-transparent "glass" effect over the simulation.

**Interactive Styles**: sliders and buttons have distinct hover and active states. the sliders for initial-state parameters are themed orange, whilst real-time parameters are themed blue, providing clear visual distinction.

**DPR Sizing**: the canvas CSS size is fixed with `!important` to ensure the backing store resolution can be managed independently by JavaScript for high-DPI displays.