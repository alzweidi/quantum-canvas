# Quantum Canvas Formula Sheet

comprehensive mathematical reference for the 2D quantum wave function simulator

---

## Fundamental Quantum Mechanics

### time-dependent schrödinger equation

the core equation governing quantum evolution in 2D:

$$i\hbar \frac{\partial \psi}{\partial t} = \hat{H} \psi = \left(-\frac{\hbar^2}{2m}\nabla^2 + V(\mathbf{r})\right) \psi$$

where:

- $\psi(\mathbf{r}, t)$ is the complex wave function
- $\hbar = 1$ (reduced planck constant, normalised)
- $m = 1$ (particle mass, normalised)
- $V(\mathbf{r})$ is the potential energy field

### gaussian wave packet initialisation

the initial wave function is constructed as a gaussian wave packet:

$$\psi(x,y,0) = A \exp\left(-\frac{(x-x_0)^2 + (y-y_0)^2}{2\sigma^2}\right) \exp\left(\frac{i}{\hbar}(p_x x + p_y y)\right)$$

**normalisation constant:**

$$A = \left(\frac{1}{\pi\sigma^2}\right)^{1/2}$$

**physical parameters:**

- $(x_0, y_0) = (256, 256)$ - initial position (physical coordinates)
- $(p_x, p_y) = (60, 0)$ - initial momentum components
- $\sigma = 15.0$ - wave packet width parameter

---

## Split-Step Fourier Method

### operator splitting approximation

the time evolution operator is split using the symmetric strang splitting:

$$\psi(t+\Delta t) \approx e^{-i\frac{V\Delta t}{2\hbar}} \cdot e^{-i\frac{T\Delta t}{\hbar}} \cdot e^{-i\frac{V\Delta t}{2\hbar}} \psi(t)$$

where:

- $T = \frac{\hbar^2}{2m}|\mathbf{k}|^2$ is the kinetic energy operator
- $V$ is the potential energy operator
- $\Delta t = 0.005$ is the time step

### kinetic energy in momentum space

the kinetic operator in discretised k-space:

$$T_{k_x,k_y} = \frac{\hbar^2}{2m}(k_x^2 + k_y^2)$$

**momentum grid definition:**

$$k_x = \frac{2\pi n_x}{L_x}, \quad k_y = \frac{2\pi n_y}{L_y}$$

where $n_x, n_y \in [-N/2, N/2)$ and $L_x = L_y = 512$ (domain size).

### potential energy application

potential barriers apply a phase kick in position space:

$$\psi'(\mathbf{r}) = \psi(\mathbf{r}) \cdot e^{-i \phi(\mathbf{r})}$$

**user-drawn barriers:**

$$\phi(\mathbf{r}) = \text{barrierPhaseKick} = 1.5 \text{ rad}$$

**reflective boundary walls:**

$$\phi_{\text{boundary}} = 10^6 \cdot \Delta t / \hbar$$

---

## Grid and Coordinate Systems

### physical to grid mapping

conversion between physical coordinates and grid indices:

$$i = \text{floor}\left(\frac{x \cdot N_{\text{grid}}}{L_{\text{domain}}}\right), \quad j = \text{floor}\left(\frac{y \cdot N_{\text{grid}}}{L_{\text{domain}}}\right)$$

**constants:**

- $N_{\text{grid}} = 256$ (grid resolution)
- $L_{\text{domain}} = 512$ (physical domain size)

### array indexing

for a complex wave function stored as interleaved float32array:

$$\text{idx}_{\text{real}} = 2(j \cdot N + i), \quad \text{idx}_{\text{imag}} = 2(j \cdot N + i) + 1$$

---

## Boundary Conditions

### absorbing boundaries

exponential damping near edges to simulate infinite space:

$$\psi'(\mathbf{r}) = \psi(\mathbf{r}) \cdot e^{-\gamma d_{\text{min}} \Delta t}$$

where:

- $d_{\text{min}}$ is distance to nearest boundary
- $\gamma = 0.1$ is the absorption rate
- damping applies when $d_{\text{min}} < w_{\text{boundary}} = 20$ pixels

### momentum kick operator

quantum mechanical momentum translation:

$$\psi'(\mathbf{r}) = \psi(\mathbf{r}) \cdot e^{i(\Delta\mathbf{p} \cdot \mathbf{r})/\hbar}$$

**discrete implementation:**

$$\phi(x,y) = \frac{\Delta p_x \cdot x + \Delta p_y \cdot y}{\hbar}$$

---

## Visualisation Mathematics

### wave function magnitude and phase

extraction from complex representation:

$$|\psi(\mathbf{r})| = \sqrt{\text{Re}[\psi]^2 + \text{Im}[\psi]^2}$$

$$\arg[\psi(\mathbf{r})] = \arctan\left(\frac{\text{Im}[\psi]}{\text{Re}[\psi]}\right)$$

### magnitude enhancement

logarithmic scaling for visibility of small amplitudes:

$$
|\psi|_{\text{enhanced}} = \left\{
\begin{array}{ll}
2|\psi|^{0.5} & \text{if } |\psi| < 0.1 \\
|\psi| & \text{otherwise}
\end{array}
\right.
$$

### quantum colour mapping

hsl to rgb conversion for phase visualisation:

$$\text{hue} = \frac{\arg[\psi]}{2\pi}, \quad \text{saturation} = \min(2|\psi|, 1), \quad \text{lightness} = 0.3 + 0.7|\psi|$$

### phase contours

contour line generation every $\pi/4$ radians:

$$\text{contour}(\phi) = \text{smoothstep}(0, w, \phi') - \text{smoothstep}(\pi/4 - w, \pi/4, \phi')$$

where $\phi' = \phi \bmod (\pi/4)$ and $w = 0.02$ is the contour width.

---

## Fast Fourier Transform

### 2d fft decomposition

row-column algorithm for efficient 2d transforms:

1. **row ffts:** $\tilde{\psi}(k_x, y) = \text{FFT}_x[\psi(x, y)]$
2. **transpose:** $\tilde{\psi}(y, k_x) \leftarrow \tilde{\psi}(k_x, y)$
3. **column ffts:** $\tilde{\psi}(k_y, k_x) = \text{FFT}_y[\tilde{\psi}(y, k_x)]$

### cooley-tukey algorithm

in-place fft for power-of-2 sizes:

$$\tilde{f}_k = \sum_{n=0}^{N-1} f_n \cdot e^{-2\pi i kn/N}$$

**bit-reversal permutation:** required preprocessing step for in-place computation.

---

## Physical Constants

### simulation parameters

| parameter        | symbol     | value | units   |
| ---------------- | ---------- | ----- | ------- |
| grid size        | $N$        | 256   | pixels  |
| domain size      | $L$        | 512.0 | length  |
| reduced planck   | $\hbar$    | 1     | action  |
| particle mass    | $m$        | 1     | mass    |
| time step        | $\Delta t$ | 0.005 | time    |
| barrier strength | $\phi_0$   | 1.5   | radians |
| absorption rate  | $\gamma$   | 0.1   | time⁻¹  |

### initial conditions

| parameter    | symbol   | default | range       |
| ------------ | -------- | ------- | ----------- |
| position x   | $x_0$    | 256     | [0, 512]    |
| position y   | $y_0$    | 256     | [0, 512]    |
| momentum x   | $p_x$    | 60      | [-150, 150] |
| momentum y   | $p_y$    | 0       | [-150, 150] |
| packet width | $\sigma$ | 15.0    | [5, 30]     |

---

## Numerical Stability

### cfl condition

for numerical stability in the split-step method:

$$\Delta t < \frac{m (\Delta x)^2}{\hbar}$$

**implemented values:** $\Delta t = 0.005$, $\Delta x = 2.0$, giving stability factor ≈ 800.

### normalisation preservation

the split-step method preserves the norm:

$$\int |\psi(\mathbf{r}, t)|^2 d^2\mathbf{r} = \text{constant}$$

verified through unitary operators $e^{-iT\Delta t/\hbar}$ and $e^{-iV\Delta t/\hbar}$.

---

_mathematical foundation for quantum canvas simulator_  
_implementation: split-step fourier method with webgl visualisation_
