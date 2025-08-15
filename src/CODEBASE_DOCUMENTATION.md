# Quantum Canvas - Codebase Documentation

## Table of Contents

- [overview](#overview)
- [system architecture & file structure](#system-architecture--file-structure)
- [core modules & implementation details](#core-modules--implementation-details)
- [application core & lifecycle (main.js)](#application-core--lifecycle-mainjs)
- [state management (simulationstate.js)](#state-management-simulationstatejs)
- [physics engine (computationengine.js)](#physics-engine-computationenginejs)
- [rendering engine (renderer.js)](#rendering-engine-rendererjs)
- [UI & interaction (UIController.js)](#ui--interaction-uicontrollerjs)
- [mathematical foundations (fft.js & constants.js)](#mathematical-foundations-fftjs--constantsjs)
- [key features deep dive](#key-features-deep-dive)
- [robustness & error handling](#robustness--error-handling)
- [resource management & performance](#resource-management--performance)
- [debugging & testing interface](#debugging--testing-interface)
- [UI design system & layout](#ui-design-system--layout)

## Overview

this doc provides a comprehensive technical guide to the quantum canvas codebase. the web app is a browser-based 2D quantum wave function simulator that uses a custom physics engine and an advanced WebGL rendering pipeline.

the system is designed to be both an educational tool and a high-performance interactive simulation. it features a quantum-accurate solver for the time-dependent schrödinger equation, a rich visualisation layer, and extensive user interaction capabilities.

### Key Technical Features

- **robust animation control**: the main loop automatically pauses when the browser tab is hidden and provides manual pause/play controls, conserving system resources.

- **advanced error handling**: the system actively monitors for computation and rendering errors, entering a graceful degradation mode to prevent crashes and attempting recovery.

- **high-DPI rendering**: the canvas and renderer are fully aware of the device pixel ratio (DPR), ensuring sharp visuals on all displays and handling runtime DPR changes (e.g., browser zoom).

- **modular, data-Driven architecture**: physics, rendering, and UI logic are cleanly separated into distinct modules that operate on a central [`SimulationState`](src/SimulationState.js) object.

- **interactive physics playground**: users can directly manipulate the simulation by drawing potential barriers, dragging the wave packet, or applying physically accurate momentum "nudges".

## system architecture & file structure

the project follows a modular ES6 architecture, separating concerns into distinct files.

### module responsibilities

| file                                               | responsibility                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`main.js`](src/main.js)                           | application core: initialises all modules, runs the main animation loop, and manages error handling, resource conservation, and the debugging interface.   |
| [`SimulationState.js`](src/SimulationState.js)     | data model: contains the canonical state of the simulation, including the wave function (psi), potential fields, and all configurable physical parameters. |
| [`ComputationEngine.js`](src/ComputationEngine.js) | physics engine: implements the split-step fourier method to evolve the wave function over time.                                                            |
| [`Renderer.js`](src/Renderer.js)                   | visualisation: manages all WebGL rendering, including the GLSL shaders that visualise the quantum state and potential fields.                              |
| [`UIController.js`](src/UIController.js)           | user interaction: handles all input from the mouse and UI panel, translating user actions into state changes.                                              |
| [`presets.js`](src/presets.js)                     | experiment definitions: contains data and logic for setting up classic experiments like the double slit, with adaptive geometry.                           |
| [`constants.js`](src/constants.js)                 | configuration: stores fundamental physical constants and default simulation parameters.                                                                    |
| [`fft.js`](src/fft.js)                             | mathematics: provides a highly optimised, in-place Fast Fourier Transform and its inverse.                                                                 |
| [`index.html`](index.html)                         | application shell: defines the DOM structure for the canvas and the UI control panel.                                                                      |
| [`style.css`](src/style.css)                       | design system: implements the modern, GitHub-inspired dark theme and responsive layout for the UI.                                                         |

### Project File Structure

```text
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

the core of the application is the [`gameLoop()`](src/main.js:276), which is designed for robustness and efficiency. it only runs when the animation is active, not paused, and the browser tab is visible.

```javascript
function gameLoop() {
  const frameStart = performance.now();

  // step physics multiple times per rendered frame for faster apparent motion
  for (let s = 0; s < STEPS_PER_FRAME; s++) {
    if (_shouldSkipComputation()) break;
    const error = _executeComputationStep();
    if (error) {
      _logAndDegradeOnComputationError(error);
      break;
    }
  }
  _handleRenderingPhase();
  _monitorPerformance(frameStart);
  _scheduleNextFrame();
}
```

the loop is composed of distinct phases, each with its own error handling:

- [`_handleComputationPhase()`](src/main.js:155): executes one step of the physics simulation via [`ComputationEngine`](src/ComputationEngine.js). it includes logic to skip frames if the system is in a degraded state.

- [`_handleRenderingPhase()`](src/main.js:236): draws the current [`SimulationState`](src/SimulationState.js) using the [`Renderer`](src/Renderer.js).

- [`_monitorPerformance()`](src/main.js:249): logs a warning if a frame takes longer than the 60fps budget (16.67ms).

- [`_scheduleNextFrame()`](src/main.js:263): conditionally schedules the next call to [`gameLoop()`](src/main.js:276) using `requestAnimationFrame`.

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
const gl =
  canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
if (gl) {
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  if (
    backingStoreWidth > maxTextureSize ||
    backingStoreHeight > maxTextureSize
  ) {
    console.warn(
      `[DPR FIX] Backing store ${backingStoreWidth}x${backingStoreHeight} exceeds max texture size ${maxTextureSize}, falling back to base resolution`,
    );
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
  x0: C.INITIAL_X0,
  y0: C.INITIAL_Y0,
  px: C.INITIAL_P_X,
  py: C.INITIAL_P_Y,
  sigma: C.INITIAL_SIGMA,
  dt: C.INITIAL_DT,
  brightness: 1.0,
  boundaryMode: "reflective", // 'reflective', 'absorbing', 'both'
  barrierEnergy: 300, // energy unit - now stored as energy rather than phase
};

// Additional state properties:
this.potentialVersion = 0; // tracks potential changes for lazy renderer updates
```

#### Boundary Condition Management

the state manages two primary types of boundary conditions, controlled by [`params.boundaryMode`](src/SimulationState.js:11).

**Reflective Boundaries**: a high-potential wall is created at the edges of the grid.

**Absorbing Boundaries**: a damping field is applied near the edges to prevent wave reflection, simulating an infinite space. this absorption is scaled by dt to be time-step independent.

```javascript
// From _applyAbsorbingBoundaries(factor = 1.0)
if (
  this.params.boundaryMode === "absorbing" ||
  this.params.boundaryMode === "both"
) {
  // ...
  if (minDist < boundaryWidth) {
    // convert damping rate to physical units for resolution independence
    const cellSize = C.DOMAIN_SIZE / width;
    const dampingRate = 0.06 * (boundaryWidth - minDist) * cellSize; // physical units
    const dampingFactor = Math.exp(-dampingRate * this.params.dt * factor);

    this.psi[idx] *= dampingFactor; // real part
    this.psi[idx + 1] *= dampingFactor; // imaginary part
  }
}
```

#### Potential Version System

The state includes a lazy update system for potential changes:

```javascript
/**
 * increments potential version to signal lazy repack to renderer
 * @public
 */
bumpPotentialVersion() {
  this.potentialVersion = (this.potentialVersion + 1) | 0;
}
```

### Physics Engine (ComputationEngine.js)

this module contains the core physics logic, implementing the split-step fourier method to solve the time-dependent schrödinger equation.

#### The step() Method

the [`step()`](src/ComputationEngine.js:73) method advances the simulation by one time step using symmetric half-kicks for absorbing boundaries combined with Strang splitting.

```javascript
step(state) {
  // absorber is a separate non-Hermitian operator; apply as symmetric half-kicks
  // so the combined (Hamiltonian ⊕ absorber) scheme is second order
  state._applyAbsorbingBoundaries(0.5);
  this._applyPotential(state); // V/2
  this._applyKinetic(state); // T
  this._applyPotential(state); // V/2
  state._applyAbsorbingBoundaries(0.5);
}
```

- [`_applyPotential(state)`](src/ComputationEngine.js:90): applies the potential energy operator, $e^{-iV\Delta t / 2\hbar}$, in position space. the phase kick from user-drawn barriers is applied directly using half-step for Strang splitting.

- [`_applyKinetic(state)`](src/ComputationEngine.js:119): applies the kinetic energy operator, $e^{-iT\Delta t / \hbar}$, in momentum space. this involves a forward 2D FFT, multiplication by the pre-calculated kinetic operator, and an inverse 2D FFT.

### Rendering Engine (Renderer.js)

the renderer uses regl to manage WebGL and visualises the complex wave function data with domain coloring. It supports multiple texture formats (float32, half-float, uint8) with automatic fallback and DPR-aware scaling.

#### CPU-Side Data Preparation

the renderer supports multiple texture paths based on WebGL capabilities:

**Float/Half-Float Path**: direct storage of wave function data
**Uint8 Path**: uses global scaling with periodic rescanning to prevent clipping/flicker

the renderer includes lazy potential texture updates using the `potentialVersion` system:

```javascript
// determine if we must repack potential (b channel or separate texture)
const potDirty =
  this.needPotInit ||
  state.potentialVersion !== this.lastPotentialVersion ||
  this.lastBarrierEnergy !== barrierEnergy;

// uint8 path: pack ψ into rg using global scale
if (this.uint8Mode) {
  // periodic scan for optimal scaling
  if (this.frameCounter % this.uint8ScaleEveryN === 0) {
    let S = 0.0;
    for (let i = 0; i < psi.length; i += 2) {
      const ar = Math.abs(psi[i]);
      const ai = Math.abs(psi[i + 1]);
      if (ar > S) S = ar;
      if (ai > S) S = ai;
    }
    // smooth scaling to prevent flickering
    const smoothed =
      this.scaleSmoothAlpha * this.currentScale +
      (1.0 - this.scaleSmoothAlpha) * S;
    this.currentScale = Math.max(smoothed, S);
  }
}
```

#### Fragment Shader

the GLSL fragment shader uses domain coloring for quantum visualisation. it supports both single-texture and two-texture paths:

```glsl
// Core domain coloring shader (single texture path)
vec3 hsv2rgb(vec3 c) {
  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
  return c.z * mix(vec3(1.0), rgb, c.y);
}

void main() {
  vec4 t = texture2D(psiTexture, vUv);
  vec2 psi = (u_uint8Mode == 1) ? (t.rg * 2.0 - 1.0) * max(u_scale, 1e-12) : t.rg;

  float mag = length(psi);
  if (mag < u_magCutoff) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }

  float phase = atan(psi.y, psi.x);
  float hue   = fract((phase + PI) / TAU);
  float amp   = sqrt(mag) * u_brightness;
  vec3 base   = hsv2rgb(vec3(hue, 1.0, 1.0)) * amp;

  // Phase contours with K=24 stripes per 2π
  float K = 24.0;
  float f = abs(fract((phase + PI) / TAU * K) - 0.5);
  float contour = smoothstep(0.48, 0.5, f);
  base = mix(base, base * 0.7, contour * 0.25 * clamp(amp, 0.0, 1.0));

  // Potential overlay from B channel (normalized 0..1 in t.b)
  float pot = t.b;
  float potAlpha = 0.6 * pot * pot;
  vec3 barrier = vec3(0.85, 0.15, 0.15);
  vec3 color = mix(base, barrier, potAlpha);
  gl_FragColor = vec4(color, 1.0);
}
```

### UI & Interaction (UIController.js)

this class connects all DOM elements to the simulation state and handles all user input.

#### Mouse Interaction Modes

the controller supports three distinct mouse modes, selected via radio buttons.

**Draw/Erase**: [`_applyBrush()`](src/UIController.js:371) is called on mouse move. it uses `event.button === 2` to reliably detect right-clicks for erasing. the brush has a circular falloff pattern and respects the main boundary walls.

**Drag Packet**: calls [`state.shiftWaveFunction()`](src/SimulationState.js:267) to move the entire wave function with the mouse.

**Nudge Packet**: on mouse up, calculates the drag vector and calls [`_applyMomentumKick()`](src/UIController.js:485) to impart a quantum-mechanically accurate momentum change. it then updates the UI sliders to reflect the new total momentum.

#### Quantum Momentum Kicks

this method applies a momentum kick by multiplying the wave function by a complex phase factor, which is the quantum operator for a momentum translation.

```javascript
_applyMomentumKick(deltaPx, deltaPy) {
  const width = this.state.gridSize.width;
  const height = this.state.gridSize.height;
  const hbar = C.HBAR;

  // FIX: calculate grid spacing to convert indices to physical coordinates
  const dx = C.DOMAIN_SIZE / width;
  const dy = C.DOMAIN_SIZE / height;

  // Apply phase multiplication: ψ' = ψ * exp(i(Δp·r)/ℏ)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = 2 * (y * width + x);
      const real = this.state.psi[idx];
      const imag = this.state.psi[idx + 1];

      // FIX: convert grid indices to physical coordinates for correct momentum kick
      const phase = (deltaPx * x * dx + deltaPy * y * dy) / hbar;
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
export const GRID_SIZE = 256; // grid resolution, must be power of 2
export const DOMAIN_SIZE = 512.0; // physical domain size (independent of resolution)
export const HBAR = 1;
export const MASS = 1;
export const INITIAL_DT = 0.005;
export const INITIAL_SIGMA = 15.0;
export const INITIAL_P_X = 1.0; // below Nyquist for Δx=2 → k_max≈1.57
export const INITIAL_P_Y = 0.0;
export const INITIAL_X0 = DOMAIN_SIZE / 2; // center in physical coordinates
export const INITIAL_Y0 = DOMAIN_SIZE / 2;
export const POTENTIAL_STRENGTH = 100.0;
export const WALL_ENERGY = 1e4; // big, but finite, energy unit
```

#### fft.js

provides an in-place, power-of-2 Cooley-Tukey Fast Fourier Transform. it includes validation to throw an error if the input array size is not a power of 2. The FFT implementation uses in-place 1D Cooley–Tukey kernels with fixed row/column work buffers for efficient 2D transforms. the inverse FFT is implemented using the conjugate method.

```javascript
// From fft()
// validate that input size is a power of 2
if (!Number.isInteger(Math.log2(n))) {
  throw new Error(`FFT input size ${n} must be a power of 2`);
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
  console.warn(
    `[DEGRADATION] Skipping computation for ${skipComputationFrames} frames due to repeated failures`,
  );
}
```

### Resource Management & Performance

**Page Visibility API**: [`main.js`](src/main.js) uses the Page Visibility API to automatically pause the `requestAnimationFrame` loop when the tab is not in focus, reducing CPU/GPU usage to near zero. the animation resumes automatically when the tab becomes visible again.

**DPR Change Handling**: the system listens for resize and orientation change events to detect changes in `window.devicePixelRatio`. if a change occurs, the canvas backing store is resized and the renderer is re-initialised to prevent blurriness or pixelation from browser zoom or moving the window between monitors.

**Memory Optimisation**: simulation data are stored in Float64Array (ψ, V, T) for numerical accuracy. the renderer uploads as float/half-float when supported, or packs to Uint8 with a global scale and periodic rescans to avoid clipping/flicker.

### Debugging & Testing Interface

[`main.js`](src/main.js) exposes a suite of testing functions on the window object, allowing developers to test the robustness of the system directly from the browser console.

| Function                              | Description                                                            |
| ------------------------------------- | ---------------------------------------------------------------------- |
| `window.testComputationErrors(N)`     | injects N consecutive computation errors to test error handling.       |
| `window.testRenderingErrors(N)`       | injects N consecutive rendering errors.                                |
| `window.testComputationDegradation()` | injects 6 computation errors to trigger the graceful degradation mode. |
| `window.testRenderingRecovery()`      | injects 4 rendering errors to trigger the WebGL recovery attempt.      |
| `window.testStateCorruption()`        | manually corrupts the wave function data with NaN to test detection.   |
| `window.getErrorStats()`              | returns an object with the current error counts and system status.     |
| `window.resetErrorCounters()`         | resets all error statistics for fresh testing.                         |

## UI Design System & Layout

the UI is defined in [`index.html`](index.html) and styled by [`style.css`](src/style.css) to create a modern, functional control panel.

### index.html Structure

the HTML document provides the complete structure for the UI panel, including labelled control sections, buttons, radio inputs, and sliders for every configurable parameter.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Quantum Simulator</title>
    <link rel="stylesheet" href="src/style.css" />
  </head>
  <body>
    <canvas id="sim-canvas"></canvas>
    <div id="ui-panel">
      <h3>Quantum Laboratory</h3>

      <div class="control-section">
        <h4>Simulation Controls</h4>
        <div class="control-group button-group">
          <button id="pause-button" class="control-button">Pause</button>
          <button id="reset-button" class="control-button">
            Reset Simulation
          </button>
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
            <input
              type="radio"
              id="mode-draw"
              name="mouseMode"
              value="draw"
              checked
            />
            <label for="mode-draw">Draw/Erase</label>

            <input type="radio" id="mode-drag" name="mouseMode" value="drag" />
            <label for="mode-drag">Drag Packet</label>

            <input
              type="radio"
              id="mode-nudge"
              name="mouseMode"
              value="nudge"
            />
            <label for="mode-nudge">Nudge Packet</label>
          </div>
          <div class="mode-hint">
            <span id="mode-hint-text"
              >Left-click: Draw barriers • Right-click: Erase</span
            >
          </div>
        </div>
      </div>

      <div class="control-section">
        <h4>Boundary Physics</h4>
        <div class="control-group boundary-mode-group">
          <div class="radio-group">
            <input
              type="radio"
              id="boundary-reflective"
              name="boundaryMode"
              value="reflective"
              checked
            />
            <label for="boundary-reflective">Reflective Walls</label>

            <input
              type="radio"
              id="boundary-absorbing"
              name="boundaryMode"
              value="absorbing"
            />
            <label for="boundary-absorbing">Absorbing Boundaries</label>

            <input
              type="radio"
              id="boundary-both"
              name="boundaryMode"
              value="both"
            />
            <label for="boundary-both">Both (Demo Conflict)</label>
          </div>
          <div class="mode-hint">
            <span
              >Reflective: Waves bounce back • Absorbing: Waves fade at
              edges</span
            >
          </div>
        </div>
      </div>

      <div class="control-section">
        <h4>Real-time Parameters</h4>
        <div class="control-group">
          <label for="brush-slider"
            >Brush Size:
            <span id="brush-size-value" class="param-value">5</span></label
          >
          <input
            type="range"
            min="1"
            max="25"
            value="5"
            id="brush-slider"
            class="param-slider"
          />
        </div>
        <div class="control-group">
          <label for="brightness-slider"
            >Brightness:
            <span id="brightness-value" class="param-value">1.0</span></label
          >
          <input
            type="range"
            min="0.1"
            max="5"
            value="1.0"
            step="0.1"
            id="brightness-slider"
            class="param-slider"
          />
        </div>
        <div class="control-group">
          <label for="dt-slider"
            >Time Step (dt):
            <span id="dt-value" class="param-value">0.005</span></label
          >
          <input
            type="range"
            min="0.001"
            max="0.02"
            value="0.005"
            step="0.001"
            id="dt-slider"
            class="param-slider"
          />
        </div>
        <div class="control-group">
          <label for="barrier-strength-slider"
            >Barrier Strength:
            <span id="barrier-strength-value" class="param-value"
              >300</span
            ></label
          >
          <input
            type="range"
            min="0"
            max="1000"
            value="300"
            step="10"
            id="barrier-strength-slider"
            class="param-slider"
          />
        </div>
      </div>

      <div class="control-section initial-state-section">
        <h4>
          Initial State <span class="reset-note">(Applied on Reset)</span>
        </h4>
        <div class="control-group">
          <label for="px-slider"
            >Momentum X:
            <span id="px-value" class="param-value">60</span></label
          >
          <input
            type="range"
            min="-150"
            max="150"
            value="60"
            id="px-slider"
            class="initial-param-slider"
          />
        </div>
        <div class="control-group">
          <label for="py-slider"
            >Momentum Y: <span id="py-value" class="param-value">0</span></label
          >
          <input
            type="range"
            min="-150"
            max="150"
            value="0"
            id="py-slider"
            class="initial-param-slider"
          />
        </div>
        <div class="control-group">
          <label for="sigma-slider"
            >Packet Width:
            <span id="sigma-value" class="param-value">15</span></label
          >
          <input
            type="range"
            min="5"
            max="30"
            value="15"
            id="sigma-slider"
            class="initial-param-slider"
          />
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
