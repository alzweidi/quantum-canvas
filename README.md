# Quantum Canvas: An Interactive 2D Quantum Physics Simulator

welcome to **Quantum Canvas**! this project leverages my custom-built physics engine and a WebGL-based rendering pipeline to bring quantum mechanics to life directly in your browser.

## Features

### Real-time Quantum Simulation

- solves the 2D time-dependent schrödinger equation using the performant **split-step fourier method**

### WebGL Rendering

A beautiful visualisation powered by a custom GLSL shader that includes:

- **perceptually uniform color mapping** based on the wave function's phase and magnitude
- **multi-scale glow effect** to give the wave packet a realistic, field-like appearance
- **phase contour lines** to clearly visualise wave structure and interference patterns
- **integrated, real-time visualisation** of user-drawn potential barriers

### Interactive Physics Playground

- **draw/erase potential walls**: left-click to draw potential barriers and right-click to erase them
- **drag the wave packet**: physically move the wave packet's position in real-time
- **nudge the wave packet**: apply a momentum "kick" by dragging and releasing, demonstrating a core quantum mechanical concept interactively
- **classic experiment presets**: load famous quantum mechanics experiments with a single click, including the double slit experiment and quantum tunneling (Not perfect)
- **dynamic parameter control**: fine-tune the simulation in real-time with a comprehensive UI panel to adjust everything from the time step (dt) to the initial momentum and width of the wave packet

### Robust and Efficient

- features a **hand-coded, in-place Fast Fourier Transform (FFT)** implementation
- the animation loop **pauses automatically** when the tab is not visible to conserve resources
- includes **graceful error handling and recovery** for both the computation and rendering engines
- handles browser zoom and display resolution changes seamlessly via **Device Pixel Ratio monitoring**

## How to Run This

1. **clone this repository** to your local machine

2. since this project uses **ES Modules**, it must be served by a local web server

3. **recommended**: Use the Live Server extension in Visual Studio Code
   - right-click on [`index.html`](index.html) and select "Open with Live Server"

4. **alternative**: Run a simple Python server from the project's root directory:

```bash
python -m http.server
```

then navigate to `http://localhost:8000` in your browser.

## Architecture

the simulator follows a clear, modular structure that separates concerns into distinct components:

- **[`main.js`](src/main.js)** _(Application Core)_: initialises all modules, runs the primary animation loop, and manages application-level state like pause/play and visibility

- **[`SimulationState.js`](src/SimulationState.js)** _(Physics State)_: manages the simulation's state, including the wave function (ψ), potential fields, boundary conditions, and all physical parameters

- **[`ComputationEngine.js`](src/ComputationEngine.js)** _(Physics Engine)_: executes the time evolution of the wave function using the split-step fourier method

- **[`fft.js`](src/fft.js)** _(Mathematical Operations)_: a self-coded, in-place fast fourier transform and its inverse

- **[`constants.js`](src/constants.js)**: stores fundamental constants and initial simulation parameters

- **[`Renderer.js`](src/Renderer.js)** _(visualisation)_: handles all WebGL rendering via regl, including the advanced shaders that visualise the quantum state

- **[`UIController.js`](src/UIController.js)** _(user interaction)_: manages all user input from the UI panel and the canvas, translating it into changes in the simulation state

- **[`presets.js`](src/presets.js)**: defines the configurations for the included quantum experiments

- **[`index.html`](index.html) & [`style.css`](src/style.css)**: the application's structure and styling, featuring a modern, responsive UI panel

## Technical

### The Physics Engine

[`SimulationState.js`](src/SimulationState.js) is the data-heart of the simulation. it initialises the system with a **Gaussian wave packet**, a common and physically meaningful initial state, defined by the equation:

$$\psi(x,y) = A e^{-\frac{(x-x_0)^2 + (y-y_0)^2}{2\sigma^2}} e^{\frac{i}{\hbar}(p_x x + p_y y)}$$

it also manages boundary conditions, which can be **reflective** (high-potential walls) or **absorbing** (a damping field at the edges to simulate infinite space).

[`ComputationEngine.js`](src/ComputationEngine.js) evolves the wave function in time using the **split-step fourier method**. this numerical method is highly efficient and stable for solving the time-dependent schrödinger equation. it works by splitting the evolution operator into a potential energy step (in position space) and a kinetic energy step (in momentum space). the evolution for a single time step $\Delta t$ is approximated as:

$$\psi(t+\Delta t) \approx e^{-i\frac{V\Delta t}{2\hbar}} \cdot e^{-i\frac{T\Delta t}{\hbar}} \cdot e^{-i\frac{V\Delta t}{2\hbar}} \psi(t)$$

this symmetric splitting (also known as a **strang splitting**) makes the method accurate to the second order in $\Delta t$.

### visualisation and rendering

[`Renderer.js`](src/Renderer.js) uses **regl**, a functional WebGL library, to render the quantum state. the visualisation is not just a simple plot; it's a shader pipeline designed to be both beautiful and physically informative. the core of this is the fragment shader, which executes the following steps for every pixel:

```glsl
// GLSL (Simplified for clarity)
void main() {
    // 1. read and decode the complex wave function from a texture
    vec2 psi = (texture2D(psiTexture, uv).rg * 2.0) - 1.0;
    float magnitude = length(psi);
    float phase = atan(psi.y, psi.x);

    // 2. read potential barrier data from another texture
    float potential = texture2D(potentialTexture, uv).r * 100.0;

    // 3. enhance small magnitudes to make faint parts of the wave more visible
    float enhancedMagnitude = enhanceMagnitude(magnitude);

    // 4. apply the visualisation pipeline
    vec3 baseColor = quantumColorMapping(enhancedMagnitude, phase); // map phase/mag to HSL color
    vec3 glowColor = applyGlow(baseColor, enhancedMagnitude, uv);   // add a soft glow
    vec3 contourColor = applyPhaseContours(glowColor, phase, enhancedMagnitude); // draw phase lines

    // 5. filter out low-magnitude noise and apply user-controlled brightness
    vec3 quantumColor = (magnitude < 0.01) ? vec3(0.0) : contourColor * u_brightness;

    // 6. overlay the potential barriers in a distinct color
    vec3 finalColor = applyPotentialBarriers(quantumColor, potential);
    gl_FragColor = vec4(finalColor, 1.0);
}
```

### user interaction

[`UIController.js`](src/UIController.js) is the bridge between the user and the simulation. a particularly interesting feature is the **"nudge" mode**. when you drag and release the mouse, it applies a momentum kick to the wave packet. this is achieved by multiplying the wave function by a complex phase factor, which is the quantum mechanical operator for a momentum translation:

$$\psi_{\text{new}}(\mathbf{r}) = \psi_{\text{old}}(\mathbf{r}) \cdot e^{i(\Delta\mathbf{p} \cdot \mathbf{r})/\hbar}$$

## How to Contribute

contributions are very welcome! any help to make it better is greatly appreciated. areas of particular interest are:

- **UI/UX improvements**: enhancements to the layout, styling ([`style.css`](src/style.css)), or interaction flow ([`UIController.js`](src/UIController.js)) would be fantastic since i suck at UI/UX design lol

- **new presets**: add more classic quantum experiments (e.g., quantum harmonic oscillator, Aharonov–Bohm effect)

- **optimisations**: can you make it even faster? improvements to the rendering logic ([`Renderer.js`](src/Renderer.js)) or physics computations ([`ComputationEngine.js`](src/ComputationEngine.js)) are always welcome

- **bug reports & ideas**: found a bug or have a cool idea for a new feature? please open an issue!

---

_Built with determination by Abedalaziz Alzweidi_
