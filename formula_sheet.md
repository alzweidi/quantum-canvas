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

**normalisation (discrete):** ψ is normalised numerically so that
$$\sum_{i,j} |\psi_{i,j}|^2\, \Delta x\, \Delta y = 1,$$
with grid spacings $\Delta x = L_x/N_x$ and $\Delta y = L_y/N_y$.

**defaults:**

- $(x_0, y_0) = (256, 256)$
- $(p_x, p_y) = (1.0, 0.0)$, clamped to $\pm 0.9\,\pi/\Delta x$ (Nyquist safety)
- $\sigma = 15.0$

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

$$\psi'(\mathbf{r}) = \psi(\mathbf{r}) \cdot e^{i\, \phi(\mathbf{r})}$$

**user-drawn barriers:**

$$\phi(\mathbf{r}) = -\frac{V \Delta t}{2\hbar} \text{ where } V = \text{barrierEnergy}$$

**reflective boundary walls:**

$$\phi_{\text{boundary}} = -\frac{V \Delta t}{2\hbar} \text{ where } V = \text{WALL-ENERGY}$$

Note on absorbers: absorbing boundaries are applied as symmetric half-kicks
before and after the V/2 → T → V/2 sequence for second-order accuracy.

## Grid and Coordinate Systems

### physical to grid mapping

conversion between physical coordinates and grid indices:

$$i = \text{floor}\left(\frac{x \cdot N_{\text{grid}}}{L_{\text{domain}}}\right), \quad j = \text{floor}\left(\frac{y \cdot N_{\text{grid}}}{L_{\text{domain}}}\right)$$

**constants:**

- $N_{\text{grid}} = 256$ (grid resolution)
- $L_{\text{domain}} = 512$ (physical domain size)

### array indexing

for a complex wave function stored as interleaved Float64Array (row-major):

$$\text{idx}_{\text{real}} = 2(j \cdot N + i), \quad \text{idx}_{\text{imag}} = 2(j \cdot N + i) + 1$$

---

## Boundary Conditions

### absorbing boundaries

Exponential damping near edges to simulate open boundaries. Let
$d_{\min}$ be the grid distance to the nearest edge and $w$ the
absorber width. Within $0 \le d_{\min} < w$:

$$\psi' = \psi \cdot \exp\!\big(-\,\alpha\, (w - d_{\min})\, \Delta x\, \Delta t\, \text{factor}\big),$$

with parameters:

- $w = \max(4,\,0.05\,N)$ (cells)
- $\alpha = 0.06$ (absorption coefficient)
- $\Delta x = L/N$ (cell size)
- absorber applied as symmetric half-kicks with factor = 0.5 each side

### momentum kick operator

quantum mechanical momentum translation:

$$\psi'(\mathbf{r}) = \psi(\mathbf{r}) \cdot e^{i(\Delta\mathbf{p} \cdot \mathbf{r})/\hbar}$$

**discrete implementation:** with $x_i = i\,\Delta x$, $y_j = j\,\Delta y$,

$$\phi(i,j) = \frac{\Delta p_x\, x_i + \Delta p_y\, y_j}{\hbar}$$

---

## Visualisation Mathematics

### wave function magnitude and phase

extraction from complex representation:

$$|\psi(\mathbf{r})| = \sqrt{\text{Re}[\psi]^2 + \text{Im}[\psi]^2}$$

$$\arg[\psi(\mathbf{r})] = \arctan\left(\frac{\text{Im}[\psi]}{\text{Re}[\psi]}\right)$$

### quantum colour mapping

HSV domain coloring in the fragment shader:

- hue: $h = \operatorname{fract}\big((\arg\psi + \pi)/2\pi\big)$
- value (brightness): $v = \sqrt{|\psi|}\,\cdot\,\text{brightness}$
- saturation: $s = 1$
- low-magnitude cutoff: discard if $|\psi| < \text{magCutoff}$

Potential overlay: a red tint mixed with base color using
$\alpha_{\text{pot}} = 0.6\,\mathrm{pot}^2$, where $\mathrm{pot}$ is the
potential normalized by the current barrier energy.

### phase contours

Contour stripes (K=24 per $2\pi$) modulate the base color:

$$f = \Big|\operatorname{fract}\big(((\phi+\pi)/2\pi)\,K\big) - \tfrac12\Big|,$$
$$\text{contour} = \operatorname{smoothstep}(0.48,\,0.5,\,f).$$

---

## Fast Fourier Transform

### 2d fft decomposition

row-column algorithm for efficient 2d transforms:

1. **row ffts:** $\tilde{\psi}(k_x, y) = \text{FFT}_x[\psi(x, y)]$
2. **column ffts (no transpose):** $\tilde{\psi}(k_x, k_y) = \text{FFT}_y[\tilde{\psi}(k_x, y)]$ (implemented via temporary column buffers)

### cooley-tukey algorithm

in-place fft for power-of-2 sizes:

$$\tilde{f}_k = \sum_{n=0}^{N-1} f_n \cdot e^{-2\pi i kn/N}$$

**bit-reversal permutation:** required preprocessing step for in-place computation.

inverse fft uses conjugation and $1/N$ normalisation.

---

## Physical Constants

### simulation parameters

| parameter           | symbol     | value | units  |
| ------------------- | ---------- | ----- | ------ |
| grid size           | $N$        | 256   | cells  |
| domain size         | $L$        | 512.0 | length |
| reduced planck      | $\hbar$    | 1     | –      |
| particle mass       | $m$        | 1     | –      |
| time step           | $\Delta t$ | 0.005 | time   |
| barrier energy (def)| –          | 300   | energy |
| wall energy         | –          | $10^4$| energy |
| absorber coeff       | $\alpha$  | 0.06  | –      |

### initial conditions

| parameter    | symbol   | default | range                        |
| ------------ | -------- | ------- | ---------------------------- |
| position x   | $x_0$    | 256     | [0, 512]                     |
| position y   | $y_0$    | 256     | [0, 512]                     |
| momentum x   | $p_x$    | 1.0     | $\big[-0.9\tfrac{\pi}{\Delta x},\,0.9\tfrac{\pi}{\Delta x}\big]$ |
| momentum y   | $p_y$    | 0       | $\big[-0.9\tfrac{\pi}{\Delta y},\,0.9\tfrac{\pi}{\Delta y}\big]$ |
| packet width | $\sigma$ | 15.0    | [5, 30]                      |

---

## Numerical Stability

### time step and norm

- Time step: $\Delta t = 0.005$ (used in the implementation) with symmetric
  Strang splitting (second order).
- Unitarity: the $V$ and $T$ operators are unitary (with $\hbar=1$, $m=1$),
  but the absorber is non-unitary by design; total norm decreases when the
  absorber is active.

---

## References

- Feit, M. D., Fleck Jr., J. A., & Steiger, A. (1982). Solution of the Schrödinger equation by a spectral method. Journal of Computational Physics, 47(3), 412–433. DOI: https://doi.org/10.1016/0021-9991(82)90091-2

- Strang, G. (1968). On the Construction and Comparison of Difference Schemes. SIAM Journal on Numerical Analysis, 5(3), 506–517. DOI: https://doi.org/10.1137/0705041

- McLachlan, R. I., & Quispel, G. R. W. (2002). Splitting methods. Acta Numerica, 11, 341–434. DOI: https://doi.org/10.1017/S0962492902000053

- Cooley, J. W., & Tukey, J. W. (1965). An Algorithm for the Machine Calculation of Complex Fourier Series. Mathematics of Computation, 19(90), 297–301. AMS: https://www.ams.org/mcom/1965-19-090/S0025-5718-1965-0178586-1/

- Frigo, M., & Johnson, S. G. (2005/2021). FFTW 3 Users’ Manual. PDF: https://www.fftw.org/fftw3.pdf

- NumPy Developers. numpy.fft.fftfreq — NumPy Manual. https://numpy.org/doc/2.1/reference/generated/numpy.fft.fftfreq.html

- Caltech (Golwala). Gaussian Wave Packets (notes). PDF: https://sites.astro.caltech.edu/~golwala/ph125ab/ph125_notes_l15.pdf

- MIT OCW (EPFL supplement). Split-Operator Fourier Transform Algorithm. PDF: https://ocw.mit.edu/courses/res-3-004-visualizing-materials-science-fall-2017/6f0a55ec79c3bb82147925e16b64ba36_2017EPFL_anon2_supp.pdf

- Bao, W., Jin, S., & Markowich, P. A. (2002). On Time-Splitting Spectral Approximations for the Schrödinger Equation in the Semiclassical Regime. Journal of Computational Physics, 175(2), 487–524. DOI: https://doi.org/10.1006/jcph.2001.6956

- Bao, W., & Cai, Y. (2013). Mathematical theory and numerical methods for Bose–Einstein condensation. Kinetic and Related Models, 6(1), 1–135. DOI: https://doi.org/10.3934/krm.2013.6.1

- Muga, J. G., Palao, J. P., Navarro, B., & Egusquiza, I. L. (2004). Complex absorbing potentials. Physics Reports, 395(6), 357–426. DOI: https://doi.org/10.1016/j.physrep.2004.03.002

- Kosloff, R., & Kosloff, D. (1986). Absorbing Boundaries for Wave Propagation Problems. PDF: https://scholars.huji.ac.il/sites/default/files/ronniekosloff/files/k38.pdf

- De Giovannini, U., Larsen, A. H., & Rubio, A. (2015). Modeling electron dynamics coupled to continuum states in finite volumes with absorbing boundaries. European Physical Journal B, 88, 56. PDF: https://link.springer.com/content/pdf/10.1140/epjb/e2015-50808-0.pdf

- Wu, X., & Li, X. (2020). Absorbing boundary conditions for the time-dependent Schrödinger-type equations in R^3. Physical Review E, 101, 013304. DOI: https://link.aps.org/doi/10.1103/PhysRevE.101.013304

- FFTW Team. The 1D Discrete Fourier Transform (ordering/sign). https://www.fftw.org/doc/The-1d-Discrete-Fourier-Transform-_0028DFT_0029.html

- LibreTexts Physics. Free Particle – Wave Packets. https://phys.libretexts.org/Bookshelves/Quantum_Mechanics/Essential_Graduate_Physics_-_Quantum_Mechanics_(Likharev)/02%3A_1D_Wave_Mechanics/2.02%3A_Free_Particle-_Wave_Packets

- Wegert, E. (2016). Visual Exploration of Complex Functions. In: Mathematical Visualization (Springer). PDF: https://math.okstate.edu/people/scurry/5283/sp21/17_Wegert2016_Chapter_VisualExplorationOfComplexFunctions.pdf

- Poelke, K., & Polthier, K. (2012). Domain coloring of complex functions: An implementation-oriented introduction. IEEE Computer Graphics & Applications, 32(5), 90–97. PDF: https://www.mi.fu-berlin.de/en/math/groups/ag-geom/publications/db/ieee_article_old_low_v3_1.pdf

- Cooley–Tukey historical/primary PDF. AMS copy of the original paper. https://www.ams.org/mcom/1965-19-090/S0025-5718-1965-0178586-1/S0025-5718-1965-0178586-1.pdf