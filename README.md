# Quantum Physics Simulator Codebase

welcome to the quantum playground! what started as a playful idea; wanting to peek at a quantum wave packet (they're notoriously shy in real life) turned into this pretty neat quantum physics simulator. I got hooked on the idea and built this out using my physics and math background. Here's the rundown of what's under the hood, structured logically and functionally.

---

## How to Run This

Clone this repository to your local machine.

Since this project uses ES Modules, it needs to be served by a local web server.

- **Recommended**: Use the **Live Server extension** in Visual Studio Code:

  - Right-click on `index.html` and select **"Open with Live Server"**.

- **Alternative**: Run a simple Python server:

```bash
python -m http.server
```

---

## High-Level Architecture

The simulator follows a clear, modular structure divided into key logical components:

- **Quantum Simulation Core**

  - `SimulationState.js`
  - `ComputationEngine.js`

- **Mathematical Operations**

  - `fft.js` *(My pride and joy a completely self-coded FFT implementation)*
  - `constants.js`

- **Visualisation & Rendering**

  - `Renderer.js`

- **User Interface & Interaction** *(I'll admit it upfront: my web UI skills are... suboptimal. contributions here are more than welcome)*

  - `UIController.js`
  - `presets.js`
  - `index.html`
  - `style.css`



---

## Quantum Simulation Core

### SimulationState.js

handles the quantum wave function (ψ), potential fields, and kinetic energy operators. Initialises everything precisely to simulate quantum behavior accurately.

#### Mathematical Details

Initial Gaussian wave packet equation:

$$\psi(x, y) = A e^{-\frac{(x - x_0)^2 + (y - y_0)^2}{2\sigma^2}} e^{i\frac{p_x x + p_y y}{\hbar}}$$

- `_createReflectiveBoundary()` sets the boundary conditions.
- `_precalculateKineticOperator()` precomputes the kinetic operator:

$$T = \frac{\hbar^2 k^2}{2m}$$

- `resetWaveFunction()` initialises the Gaussian packet.

**Why Float32Array?** Chosen for optimal memory efficiency and high-performance compatibility with WebGL.

---

### ComputationEngine.js

Uses the Split-Step Fourier Method for quantum evolution:

$$\psi(t+\Delta t) = e^{-iV\frac{\Delta t}{2\hbar}} e^{-iT\frac{\Delta t}{\hbar}} e^{-iV\frac{\Delta t}{2\hbar}} \psi(t)$$

Key methods:

- `_applyPotential()` applies potential in position space.
- `_applyKinetic()` applies kinetic energy operator via FFT transformations.

**Why Split-Step Method?** It's stable and efficient for quantum simulations as it handles position and momentum evolutions separately.

---

## Mathematical Operations

### fft.js 

FFT: $$X_k = \sum_{n=0}^{N-1} x_n e^{-i \frac{2\pi}{N}kn}$$

Inverse FFT: $$x_n = \frac{1}{N}\sum_{k=0}^{N-1} X_k e^{i \frac{2\pi}{N}kn}$$

Implemented in-place to ensure maximum efficiency and avoid memory overhead.

### constants.js

Stores key constants:

```javascript
export const GRID_SIZE = 256;
export const HBAR = 1;
export const MASS = 1;
export const INITIAL_DT = 0.005;
```

---

## Visualization & Rendering

### Renderer.js

Visualises quantum wave functions using WebGL (`regl`).

Shader snippet:

```glsl
float magnitude = length(psi);
float phase = atan(psi.y, psi.x);
float hue = (phase / (2.0 * 3.14159)) + 0.5;
vec3 waveColor = hsl2rgb(vec3(hue, 1.0, smoothstep(0.0, 0.4, magnitude) * u_brightness));
```

Visual and interactive examples available in the **examples/** folder with videos and screenshots showcasing the simulator's beauty.

---

## User Interface & Interaction

### UIController.js

Handles interactions like drawing barriers and nudging wave packets:

**"Nudge" Feature Physics:** Applying phase $e^{i(\Delta p \cdot r)/\hbar}$ gives the quantum wave packet a momentum kick, demonstrating a quantum mechanical concept interactively.

### presets.js

Features classic quantum setups:

- Double Slit Experiment
- Quantum Tunneling

---

## How to Contribute

Contributions are very welcome Areas of particular interest:

- **UI/UX Improvements:** Enhance layout, styling (`style.css`), or interaction (`UIController.js`).
- **New Presets:** Add more quantum experiments (e.g., Quantum Harmonic Oscillator, Aharonov–Bohm effect).
- **Optimizations:** Improve rendering logic (`Renderer.js`) or FFT performance (`ComputationEngine.js`).
- **Bug Reports & Ideas:** Found a bug or have an idea? Open an issue!

---

## Future Plans & Improvements

*(I'm currently working on figuring out ways to improve graphics performance)*

---

Enjoy playing around! Contributions, especially UI improvements lol, are very welcome
