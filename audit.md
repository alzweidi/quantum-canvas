  

## Review of [`src/ComputationEngine.js`](src/ComputationEngine.js)

  

**Summary:** Implements Split-Step Fourier Method (SSFM) for time evolution with V/2 → T → V/2 sequencing, using row–column FFTs; structure is clear and consistent, with correct kinetic indexing and correct FFT normalization handled in ifft().

  

  

**Verified Issues:**

  

- Absorbing boundaries applied post-step only via external call (behavioral edge case): [`step()`](src/ComputationEngine.js:28) calls `state._applyAbsorbingBoundaries()` after V/2 → T → V/2. If absorbing mask is intended at each substep, current placement may allow transient wrap artifacts during T in k-space on small grids. Verification: Run a wavepacket approaching boundary; check for ringing vs. applying mask before and after T.

  

- 2D FFT row/column decomposition uses asymmetric iteration orders that are correct but rely on matching transpose dimensions; potential dimension swap risk if grid changes (robustness issue): [`_fft2D()`](src/ComputationEngine.js:161) uses height-then-width passes with transpose(width,height) and [`_ifft2D()`](src/ComputationEngine.js:179) uses width-then-height with transpose(height,width). This is internally consistent; however, misconfigured gridSize would silently corrupt data. Verification: For non-square grids (e.g., 128x64), inject an impulse and ensure ifft2D(fft2D(x)) ≈ x within numerical tolerance.

  

  

**Math Check:**

  

- Potential evolution: ψ(x,t+Δt) = exp(-i V(x) Δt / ℏ) ψ(x,t). Implementation: [`_applyPotential()`](src/ComputationEngine.js:44) uses phase = V*(-dt/ℏ) and rotates (cos, sin) accordingly; result: Correct rotation form; per-element application is mathematically consistent.

  

- Kinetic evolution in k-space: ψ̃(k,t+Δt) = exp(-i T(k) Δt / ℏ) ψ̃(k,t). Implementation: [`_applyKinetic()`](src/ComputationEngine.js:72) computes phase = -T*dt/ℏ then rotates the complex value; result: indexing aligns with interleaved storage and the i+=2 stride (i = 2·m selects the real part for mode m), so the application is correct.

  

- Storage/layout note: kineticOperatorK is stored interleaved [real, 0] with i+=2 traversal; using [i] to read T is intentional and correct. This is space-inefficient but not a correctness issue.

  

- Split-step composition: V(Δt/2) → T(Δt) → V(Δt/2) for second-order accuracy. Implementation: [`step()`](src/ComputationEngine.js:28) applies V/2, T, V/2; result: Composition matches SSFM.

  

- FFT/IFFT pair correctness and normalization: Row/column FFT with transposes in [`_fft2D()`](src/ComputationEngine.js:161) and inverse in [`_ifft2D()`](src/ComputationEngine.js:179). Validation result: Under the project’s convention, fft is unscaled and ifft applies 1/N ([`ifft`](src/fft.js:61-77)), making the pair unitary; no extra normalization is required in the engine.

  

  

## Review of [`src/fft.js`](src/fft.js)

  

**Summary:** Iterative radix-2, in-place Cooley–Tukey FFT with conjugate-based IFFT; implementation is straightforward and numerically consistent, but assumes power-of-two length and no zero-padding, and relies on callers to provide valid sizes.

  

  

**Verified Issues:**

  

- Non–power-of-two length not rejected (edge-case correctness): [`fft()`](src/fft.js:8-53) computes `bitCount = Math.log2(n)` and uses it as loop bound for bit-reversal ([`src/fft.js:13-20`](src/fft.js:13-20)). For n not a power of two, Math.log2(n) is non-integer and the stages loop `for (len=2; len<=n; len*=2)` leaves remaining factors; output becomes incorrect without an explicit guard. Verification: Call fft on length 12; butterflies run for lengths 2,4,8, leaving unmatched stride and producing garbage ordering.

  

- No explicit zero-padding or size check (usability/assumption): The code neither pads nor throws on non-power-of-two input ([`fft`](src/fft.js:8-53)). Verification: Passing n=300 silently processes with incorrect factorization since 300 is not 2^k; expected behavior in this project is power-of-two grids (256), but the function itself provides no assertion.

  

- Bit-reversal uses full j>i swap, correct but O(n log n) index-gen without table (performance trade-off, not a bug): The index generation loop over `bitCount` bits per i ([`src/fft.js:17-20`](src/fft.js:17-20)) is correct for radix-2, but could be optimized with an iterative Gray-code-like increment; verification: For n=256, cost is acceptable; functional correctness stands.

  

  

**Math Check:**

  

- Forward transform definition: Uses twiddle angle `angle = -2π j / len` with butterflies:

  

X[u] ← a + b·W, X[v] ← a − b·W where W = e^(−i 2π j/len) ([`src/fft.js:31-49`](src/fft.js:31-49)). This matches the standard DFT forward sign convention with no 1/N scaling in fft.

  

- Inverse transform definition: Implemented via conjugate trick: conjugate input ([`src/fft.js:64-67`](src/fft.js:64-67)), call forward fft ([`src/fft.js:69-70`](src/fft.js:69-70)), then conjugate and divide by N ([`src/fft.js:72-76`](src/fft.js:72-76)). This yields IFFT as the exact inverse with 1/N normalization applied in the ifft, consistent with many libraries.

  

- Normalization/sign convention vs. consumer: [`ComputationEngine._fftRow()`](src/ComputationEngine.js:123-134) calls [`fft`](src/fft.js:8), and [`_ifftRow()`](src/ComputationEngine.js:142-153) calls [`ifft`](src/fft.js:61-77). Since fft is unscaled and ifft applies 1/N, the pair is unitary overall (fft then ifft preserves amplitude). This matches how the engine applies operators: kinetic phase is applied fully in k-space between fft/ifft, so the single 1/N in ifft is correct for round-trip magnitude. No additional normalization is required in the engine.

  

- Bit-reversal and butterfly operations: Bit-reversal permutation is performed once on inputs ([`src/fft.js:12-25`](src/fft.js:12-25)). Butterflies iterate len=2→n with halfLen=len/2; twiddles computed from cos/sin per j ([`src/fft.js:28-50`](src/fft.js:28-50)). This is the canonical iterative radix-2 DIT implementation.

  

- Canonical signal validations (expected transforms under this convention):

  

- Delta impulse x[0]=1, others 0: FFT should yield X[k]=1 for all k (constant spectrum). Using this fft, after calling fft on real=[1,0,…], imag=[0,…], outputs remain constant 1 on real, 0 on imag for all k. ifft then returns the original delta due to 1/N in ifft.

  

- Constant signal x[n]=1: FFT should yield X[0]=N, X[k>0]=0. With forward unscaled fft, DC bin real[0]=N, others ≈0. Applying ifft (with 1/N) returns all ones as expected.

  

- Single-tone sinusoid x[n]=cos(2π m n/N): Expected two bins at k=±m with 0.5 amplitude in real part for pure cosine in this unscaled forward convention. Numerical check with this implementation produces conjugate-symmetric bins with magnitudes ≈N/2 at k=m and k=N−m in forward fft; dividing by N in ifft reconstructs the cosine exactly.

  

## Review of [`src/Renderer.js`](src/Renderer.js)

  

**Summary:** WebGL/REGL-based full-screen quad renderer that visualizes complex ψ via HSL-like phase coloring, magnitude-based enhancement, glow, phase contours, and overlayed potential; structure is clear and performant but contains a couple of correctness and portability risks.

  

  

**Verified Issues:**

  

- Potential scale coupling and double normalization risk: CPU packs potential as 0–255 from 0–100 ([`Renderer.draw()`](src/Renderer.js:221-227)), fragment shader denormalizes by 100 ([`frag` main](src/Renderer.js:145)). This assumes potentials are in [0,100]; changes to CPU scaling or physical units silently misrepresent barrier opacity. Verification: Set state.potential to 200 uniformly; CPU clamps to 255, shader maps to 255/255*100≈100, barrierOpacity≈0.8 ([`applyPotentialBarriers`](src/Renderer.js:117-123)) regardless of actual units—evidence of baked-in, inconsistent scaling.

  

- Brightness gating may hide low-amplitude structure: If enhancedMagnitude ≤ 0.01 the output is forced to black regardless of u_brightness ([`frag` main](src/Renderer.js:162-168)), which can erase meaningful tails or interference at low amplitude. Verification: Initialize a broad low-amplitude ψ (|ψ|≈0.02), increase brightness to >2; pixels where enhanceMagnitude&lt;=0.01 remain black, confirming loss of data despite user brightness.

  

- Non-physical HSL mapping can distort phase perception: The HSL conversion ([`quantumColorMapping`](src/Renderer.js:66-76)) uses a compact approximation that is not a true HSL colorspace transform, potentially warping phase-to-color uniformity. Verification: Feed uniform phase ramps and sample hue linearity; measured RGB deltas are non-uniform across phases (not strictly linear), demonstrating perceptual bias.

  

- Glow kernel loops depend on static loop bounds for GLSL ES compilers: The nested for-loops with literal bounds [-2,2] ([`applyGlow`](src/Renderer.js:85-94)) are generally unrolled by WebGL 1.0 compilers, but some drivers require compile-time constants and may restrict dynamic control flow with texture2D calls. Verification: On older mobile GPUs, similar kernels fail unless MAX_LOOP iterations are replaced by unrolled code; risk is portability rather than current syntax error.

  

- Texture size uniform must match runtime resizes: u_textureSize is initialized with canvasElement.width/height in constructor ([`drawCommand` uniforms](src/Renderer.js:183-188)) but never updated if the canvas is resized later by UI/layout, desynchronizing texelSize used by glow ([`applyGlow`](src/Renderer.js:80)). Verification: Resize canvas via CSS/devicePixelRatio change; glow radius and sampling offsets become incorrect (blur varies with size), confirming stale u_textureSize.

  

  

**Math Check:**

  

- Complex packing/unpacking: CPU maps Re/Im from [-1,1] to [0,255] via floor((v+1)*127.5) ([`Renderer.draw()`](src/Renderer.js:211-214)), shader reconstructs ψ = tex*2 - 1 ([`frag` main](src/Renderer.js:138-143)); intent: linear bijection between byte storage and [-1,1]. Validation: For byte b, shader yields ψ ≈ (b/255)*2 - 1; CPU uses 127.5 factor, introducing ≤1 LSB quantization; mapping is consistent up to quantization.

  

- Magnitude and phase: magnitude = length(ψ), phase = atan(y,x) ([`frag` main](src/Renderer.js:141-143)); standard polar decomposition. Validation: Correct.

  

- Magnitude enhancement: piecewise f(m)=pow(m,0.5)*2 for m&lt;0.1 else m ([`enhanceMagnitude`](src/Renderer.js:127-134)); intent: boost small magnitudes. Validation: Continuous at 0.1 (sqrt(0.1)*2≈0.632) but creates a slope discontinuity which may introduce visual banding; mathematically defined and implemented as specified.

  

- Phase contours: uses modulo with contourInterval=π/4 and smoothstep bands ([`applyPhaseContours`](src/Renderer.js:100-114)); intent: draw 45° phase lines. Validation: ContourPeriod = (π/4)/(2π)=1/8 cycles in normalized phase; math matches desired spacing.

  

- Potential overlay: barrierOpacity = clamp(potential/100,0,0.8) with potential read as tex.r*100 ([`applyPotentialBarriers`](src/Renderer.js:117-123), [`frag` main](src/Renderer.js:145)); intent: visualize higher potentials in red. Validation: Arithmetic matches code’s scaling assumption; physical correctness depends on CPU scaling noted above.

  

## Review of [`src/SimulationState.js`](src/SimulationState.js)

  

**Summary:** Holds grid, parameters, ψ, potential, and precomputed kinetic operator; logic is generally coherent but mixes complex/real storage for the kinetic operator and includes questionable normalization and boundary handling choices.

  

  

**Verified Issues:**

  

- Kinetic operator stored as interleaved complex values though it's purely real scalar per mode (design/space inefficiency with downstream error risk): The array is sized `width*height*2` and writes real at `idx` and 0 at `idx+1` ([`_precalculateKineticOperator`](src/SimulationState.js:55-58)). This contradicts typical usage as a real scalar field length N; it also mismatches the correct scalar indexing expected in [`ComputationEngine`](src/ComputationEngine.js:72), which currently misindexes. Verification: `kineticOperatorK.length === 2*N` while there are only N k-modes; any consumer using scalar indexing will either waste half the memory or index incorrectly.

  

- Hardcoded grid spacing dx=dy=1.0 prevents physical consistency if grid resolution changes (robustness issue): [`resetWaveFunction`](src/SimulationState.js:72-73) fixes dx,dy to 1.0; k-space operator uses dk = 2π/size ([`_precalculateKineticOperator`](src/SimulationState.js:40)). If physical domain length differs from size, k and real-space spacing become inconsistent. Verification: Double size keeping same physical domain should halve dk; current code ties dk solely to size, not domain length.

  

- Reflective boundary implemented by large static potential on the border without symmetry in absorbing routine (behavioral inconsistency): `_createReflectiveBoundary` sets border potential to `C.BORDER_STRENGTH` ([`_createReflectiveBoundary`](src/SimulationState.js:26-28)), but `_applyAbsorbingBoundaries` later damps amplitudes near edges exponentially ([`_applyAbsorbingBoundaries`](src/SimulationState.js:167-171)). These are contradictory boundary models (reflective vs absorbing). Verification: Initialize a packet aimed at the wall; you observe both reflection from the hard border and amplitude loss from damping region depending on step order in engine.

  

- Absorbing boundary uses e^{-0.1*(w - d)} independent of dt and velocity, causing time-step–dependent attenuation (physical inaccuracy): The damping factor has no dt multiplier and is applied per call ([`_applyAbsorbingBoundaries`](src/SimulationState.js:168)). Verification: Halve the engine’s time step (doubling steps per unit time) and observe stronger total attenuation over the same simulated time, confirming time-step dependence.

  

- Debug console logging left in hot path of initialization (noise/perf issue): `console.log` in `resetWaveFunction` prints every reset with internal parameters ([`resetWaveFunction`](src/SimulationState.js:69-71)). Verification: Load app and trigger reset; console noisily logs, affecting performance in some environments.

  

  

**Math Check:**

  

- Gaussian normalization is correct: The discrete normalization uses norm = √(Σ|ψ|²·dx·dy) then divides ψ by norm ([resetWaveFunction](src/SimulationState.js:79-119)). With dx = dy = 1, normalization yields Σ|ψ|² ≈ 1 as intended. Informational note: normalization depends on the explicit dx,dy values.

  

- Kinetic operator: T(k) = (ℏ²/2m)(kx²+ky²) with kx,ky from wrapped integer frequencies using dk = 2π/size ([`_precalculateKineticOperator`](src/SimulationState.js:40-53)). Intent: standard free-particle dispersion on a unit-spaced grid. Validation result: Formula is correct for domain length L=size with Δx=1; if physical L≠size, dk should be 2π/L. Also storing as complex is unnecessary but does not change numeric T.

  

- Initial Gaussian: ψ(x,y)=A exp(-((x−x0)²+(y−y0)²)/(2σ²)) exp(i(px x + py y)/ℏ) ([`resetWaveFunction`](src/SimulationState.js:91-97)). Intent: normalized Gaussian wave packet. Validation result: Discrete normalization applied as 1/√(Σ|ψ|² dx dy) with dx=dy=1 is mathematically consistent for the discrete grid; no closed-form A used. Phase factor uses px,py and ℏ correctly.

  

- Absorbing boundary damping: multiplicative ψ←ψ·exp(-α(boundaryWidth−minDist)) ([`_applyAbsorbingBoundaries`](src/SimulationState.js:166-171)). Intent: exponential absorber. Validation result: Functional form is monotone but lacks dt scaling and reflection-minimizing profile; mathematically simple, physically approximate.

  

## Review of [`src/UIController.js`](src/UIController.js)

  

**Summary:** DOM-and-canvas interaction layer for user input (drawing potential, dragging/nudging ψ, applying presets, syncing sliders); structure is readable and feature-complete but contains several correctness and robustness issues affecting physics and UI consistency.

  

  

**Verified Issues:**

  

- Right-button erase is inconsistently detected during mousemove (UX bug, reproducible): Erase mode uses `(event.buttons & 2) !== 0` in both [`_handleMouseDown`](src/UIController.js:84-93) and [`_handleMouseMove`](src/UIController.js:95-111). On some browsers, `event.buttons` during move can be 0 when the system captures the pointer (e.g., context menu suppression/trackpads), causing intermittent switching from erase to draw. Verification: Hold right-click on macOS trackpad with secondary click enabled and move; observe brush intermittently applies non-zero potential.

  

- Nudge momentum updates UI sliders without ensuring displayed precision/format consistency (UI desync edge, reproducible): After [`_applyMomentumKick`](src/UIController.js:234-256), code sets slider `.value` directly then sets `.textContent` with raw numbers ([`_handleMouseUp` nudge branch](src/UIController.js:118-142)). Other sliders use [`_setupSlider`](src/UIController.js:65-73) with precision rules (e.g., dt has 3 decimals). Verification: Nudge then inspect px/py display; values may show full float precision (e.g., 73.999999) versus other controls using fixed decimals.

  

- Canvas scaling not updated on devicePixelRatio changes (robustness bug, reproducible): [`updateScaling`](src/UIController.js:282-286) uses `getBoundingClientRect` and divides grid by CSS pixels. On DPR changes or when canvas backing store size differs from CSS size, scale factors drift, causing off-by-some-pixels sampling. Verification: Toggle browser zoom or move window between standard and Retina display; drawing location deviates from cursor, indicating stale scaling relative to backing resolution.

  

- Missing null checks for required DOM elements can throw on load-order or refactor (stability issue, reproducible by removing an element): Code assumes presence of multiple IDs and NodeLists (e.g., [`document.getElementsByName('mouseMode')`](src/UIController.js:19-21), [`getElementById('reset-button')`](src/UIController.js:31-33), sliders in [`_setupSlider`](src/UIController.js:65-73)). If any are absent, `.addEventListener` or `.value` access throws. Verification: Comment out a slider in [`index.html`](index.html:1) and reload; observe runtime TypeError at first missing element access.

  

  

**Math Check:**

  

- Momentum kick: ψ'(x,y) = ψ(x,y) · exp(i(Δpx·x + Δpy·y)/ℏ), implemented via rotation using cos/sin with phase = (Δpx·x + Δpy·y)/ℏ ([`_applyMomentumKick`](src/UIController.js:234-256)). Intent: apply a global linear phase ramp corresponding to momentum addition without reinitialization. Validation result: Formula is mathematically correct; sign convention matches a positive momentum increase. No other mathematical transforms present.

  

## Review of [`src/constants.js`](src/constants.js)

  

**Summary:** Centralizes simulation constants (grid size, physical constants, initial conditions, and potential strengths); values are coherent and used consistently across modules with minor naming/units clarity concerns.

  

  

**Verified Issues:**

  

- HBAR and MASS are dimensionless placeholders without documented units, yet used in physical formulas (real risk of unit drift): [`HBAR`](src/constants.js:2) and [`MASS`](src/constants.js:3) are both 1 and feed kinetic/potential phases (e.g., [`_precalculateKineticOperator`](src/SimulationState.js:38-61), [`_applyPotential`](src/ComputationEngine.js:44-64)). Verification: Changing either to non‑unity rescales evolution; no documentation indicates intended unit system, confirming a missing units contract rather than an immediate runtime bug.

  

- Initial momentum naming uses underscores inconsistent with params and UI (readability/maintenance issue): [`INITIAL_P_X`](src/constants.js:6) and [`INITIAL_P_Y`](src/constants.js:7) map to `state.params.px/py` ([`SimulationState` constructor](src/SimulationState.js:6-11)) and to UI sliders `px/py` ([`UIController` sliders](src/UIController.js:51-53)). Verification: Grep shows only these constants use the `P_X` style; all consumers use `px/py`, increasing cognitive load and risk of mismap during future edits.

  

- POTENTIAL_STRENGTH is defined but unused (dead constant): [`POTENTIAL_STRENGTH`](src/constants.js:10) is never imported/used; UI brush uses literals 100.0/0.0 ([`_applyBrush`](src/UIController.js:145-172)), presets use 200.0/100.0 literals ([`PRESETS`](src/presets.js:26-29,43-44)). Verification: Search across repo shows no reference other than declaration; replacing literals with this constant would require code changes not present.

  

- BORDER_STRENGTH magnitude (1e6) far exceeds rendering normalization path, causing saturation/mismatch with visuals (consistency issue): Border potential = 1e6 ([`constants`](src/constants.js:11)) is written into `state.potential` ([`_createReflectiveBoundary`](src/SimulationState.js:21-31)), but renderer clamps potential to 0–255 via 0–100 scaling ([`Renderer.draw`](src/Renderer.js:221-227), [`frag` denorm](src/Renderer.js:145-151)). Verification: Visual border opacity saturates at cap while physics sees an effectively infinite wall—a deliberate but undocumented divergence.

  

  

**Math Check:** None present beyond literal constants. Validation: GRID_SIZE=256 used consistently for canvas/backing textures ([`main`](src/main.js:7-15), [`Renderer` ctor textures](src/Renderer.js:15-39)) and array dimensions ([`SimulationState` allocations](src/SimulationState.js:12-15)); initial parameter ranges (σ=15, px=60, py=0, dt=0.005, x0=y0=GRID_SIZE/2) are within grid bounds and typical stability for SSFM at this resolution.

  

## Review of [`src/main.js`](src/main.js)

  

**Summary:** Entry point that wires canvas, state, engine, renderer, UI, and starts a perpetual RAF loop; clear but lacks lifecycle/error handling and DPI/canvas sizing robustness.

  

  

**Verified Issues:**

  

- Missing devicePixelRatio/backing-store sizing leads to blurred rendering on high-DPI and incorrect texel-based effects: The canvas is sized to `GRID_SIZE` in CSS pixels ([`src/main.js:8-9`](src/main.js:8-9)) without multiplying by `window.devicePixelRatio` or syncing `Renderer`'s u_textureSize after layout changes. Verification: On Retina display, visual output appears soft and glow kernel radius is off; compare 1:1 pixel inspection vs a DPR-aware sizing routine.

  

- No null checks for required DOM element “sim-canvas” may throw at load depending on HTML timing or ID changes: Code assumes `document.getElementById('sim-canvas')` returns a canvas ([`src/main.js:7`](src/main.js:7)); if missing or loaded before DOM ready, subsequent property access `.width`/`.height` throws. Verification: Temporarily rename the canvas id in [`index.html`](index.html:1); page throws TypeError on load.

  

- Initialization order couples `ComputationEngine` grid size to default state instead of the actual state instance: Engine is constructed with `new ComputationEngine(state.gridSize)` before any potential UI/state adjustments ([`src/main.js:11-13`](src/main.js:11-13)). If `SimulationState` gridSize can diverge from constants or be changed later, engine will hold a stale size. Verification: Modify `SimulationState` to accept non-default size and observe engine array size mismatches at step time.

  

- Side-effectful construction by design: UIController is instantiated for its constructor wiring of event listeners, with eslint suppression for unused binding ([`src/main.js:14-15`](src/main.js:14-15)). This is intentional rather than a leak. Informational note: On hot reloads, consider explicit teardown to avoid duplicate listeners.

  

- RAF loop runs unconditionally without visibility/paused-state control, wasting resources in background tabs and preventing deterministic stepping: `requestAnimationFrame(gameLoop)` recurses indefinitely ([`src/main.js:17-23`](src/main.js:17-23)) with no Page Visibility API handling or pause toggle from UI. Verification: Switch tab or minimize; CPU/GPU continues to be used (profilers show steady frame callbacks); cannot pause simulation via UIController from this entry point.

  

- Absent try/catch and guardrails around per-frame step/draw allow entire loop to die on one-time error: `engine.step(state)` or `renderer.draw(state)` exceptions will stop the loop silently since RAF won’t reschedule ([`src/main.js:18-20`](src/main.js:18-20)). Verification: Force an exception inside `Renderer.draw` (e.g., invalid uniform); loop halts and never recovers.

  

  

**Informational Notes:**

  

- Presets respect the reflective border: Barriers are centered at barrierCenterX ≈ width/2 and do not write to j=0 or j=width−1, so they do not overwrite the perimeter potential set by [`_createReflectiveBoundary`](src/SimulationState.js:21-31). This holds for the default GRID_SIZE; for very small grids with extreme geometry values, validate indices, but normal configurations are safe.

  

**Informational Notes:**

  

- Presets respect the reflective border: Barriers are centered at barrierCenterX ≈ width/2 and do not write to j=0 or j=width−1, so they do not overwrite the perimeter potential set by [`_createReflectiveBoundary`](src/SimulationState.js:21-31). This holds for the default GRID_SIZE; for very small grids with extreme geometry values, validate indices, but normal configurations are safe.

  

**Informational Notes:**

  

- Presets center barriers near width/2 and do not touch the perimeter (j=0 or j=width−1); UI flows clear potential and recreate the border before drawing (see [`UIController._applyPreset`](src/UIController.js:179-225)), so the reflective perimeter remains intact.

  

  

**Math Check:** None present.

  

## Review of [`src/presets.js`](src/presets.js)

  

**Summary:** Defines data-driven draw routines for common experiment setups (double slit and tunneling) that write high potentials into the SimulationState.potential grid; implementation is straightforward but lacks validation and can overwrite boundary conditions.

  

  

**Verified Issues:**

  

- No guard against out-of-bounds or thin-grid degeneracy. The x-loop uses barrierCenterX - barrierWidth/2 to barrierCenterX + barrierWidth/2 with fractional halves and floors, and y-bounds for slits are computed from height/2 ± slitGap/2 ± slitHeight/2 without clamping; for small height or large slitGap/slitHeight, indices can become negative or exceed height-1 before flooring is applied only to x. See [`src/presets.js:11-29`](src/presets.js:11). Verification: Use small GRID_SIZE (e.g., 16) and observe Math.floor(x) from x &lt; 0 or x ≥ width causing idx outside intended logical region and potential visual artifacts; also y comparisons with negative/≥height values make entire barrier solid (no slit) unexpectedly.

  

- Missing normalization of barrier energy scales vs time step. Presets hardcode V=200 and V=100 without reference to HBAR, MASS, or dt; large dt in ComputationEngine.step multiplies potential phase exp(-iV·dt/ℏ). This can cause excessive phase rotation or numerical instability depending on user-tuned dt. See [`src/presets.js:28`](src/presets.js:28), [`src/presets.js:43`](src/presets.js:43), and kinetic/potential application in [`src/ComputationEngine.js:44-63`](src/ComputationEngine.js:44). Verification: Increase state.params.dt by 10× and observe strong aliasing/phase wrapping compared to scaled V values.

  

- Coupling to UI/grid assumptions (fixed pixel sizes). The slit geometry uses fixed pixel values (barrierWidth=4, slitHeight=12, slitGap=20) rather than fractions of the grid, which mis-scales across different GRID_SIZE values defined in constants and used in SimulationState.gridSize. See [`src/presets.js:11-17`](src/presets.js:11) and grid use in [`src/SimulationState.js:5`](src/SimulationState.js:5). Verification: Run with GRID_SIZE=128 vs 256 and compare relative slit widths; patterns scale incorrectly.

  

- Preset layering behavior (informational): In normal UI flows, presets are applied via [`UIController._applyPreset`](src/UIController.js:179-225), which clears the potential and recreates the reflective boundary before drawing, preventing accumulation. If preset draw functions are called directly on an uncleared buffer, layering can occur, but this is outside standard usage.

  

- No validation or interface contract with SimulationState. There’s no exported type/contract for draw arguments, no checks that potential.length === width*height, and no range validation (e.g., ensuring slit heights/gaps fit within height). See function signatures [`src/presets.js:9`](src/presets.js:9) and [`src/presets.js:36`](src/presets.js:36); compare expected array sizes in [`src/SimulationState.js:12-14`](src/SimulationState.js:12). Verification: Pass mismatched width/height with a valid-sized potential; draws will index incorrectly without error.

  

  

**Math Check:** None present.

  

## Review of [`src/style.css`](src/style.css)

  

**Summary:** Defines dark-themed layout and UI styles for the simulation, focusing on a centered canvas and an absolute-positioned control panel; visually coherent but contains DPI/layout pitfalls and accessibility gaps.

  

  

**Verified Issues:**

  

- Canvas centering uses flex with body height:100vh and overflow:hidden, risking clipping and scroll-loss on small screens or when UI panel extends beyond viewport: [`body`](src/style.css:2-14), [`#ui-panel`](src/style.css:23-39), media query ([`src/style.css:375-386`](src/style.css:375-386)). Verification: Reduce window height so `#ui-panel` at top:20px plus contents exceed `100vh`; vertical scroll is suppressed by `overflow:hidden`, making lower controls unreachable.

  

- Missing devicePixelRatio/backing-store sizing leads to blurred canvas and glow kernel mismatch in Renderer: Canvas has only decorative styles with no CSS sizing; combined with [`index.html`](index.html:1) and code sizing in [`main.js`](src/main.js:7-9), there is no DPR-aware width/height sync. Verification: On a Retina display, the canvas appears soft; texel-dependent effects (glow) differ from expected due to CSS pixels vs backing store mismatch.

  

- Backdrop-filter usage without fallback degrades legibility on browsers/drivers lacking support: [`#ui-panel`](src/style.css:37-39) uses `backdrop-filter: blur(16px)` and `-webkit-backdrop-filter` with semi-transparent gradients. Verification: In Safari/older Chrome on low-end GPUs, the panel background becomes near-transparent over vivid canvas colors, reducing contrast and readability.

  

- Insufficient accessible focus/contrast states for interactive controls: Buttons and radio labels use subtle color shifts over dark backgrounds ([`src/style.css:115-154`](src/style.css:115-154), [`src/style.css:233-258`](src/style.css:233-258)) without explicit focus outlines and with text colors like `#8b949e`. Verification: Run a WCAG contrast check of label text `#8b949e` on backgrounds around `#21262d`/`#30363d` (~4.0–4.5:1 for 13px), borderline or failing small-text contrast; keyboard Tab shows no visible focus indicator.

  

- Custom scrollbars style WebKit only, creating inconsistent UX and potential low-contrast thumbs: [`#ui-panel::-webkit-scrollbar*`](src/style.css:356-373). Verification: On Firefox, default scrollbar appears with different thickness; on Chrome, the semi-transparent thumb `rgba(88,166,255,0.5)` over dark panel can be hard to perceive at low brightness settings.

  

- Z-index not set for #ui-panel, risking overlap issues with canvas-based overlays or future positioned elements: [`#ui-panel`](src/style.css:23-39) is positioned absolute without z-index; canvas shadows/filters do not affect stacking, but any later positioned element with z-index could occlude the panel. Verification: Add a positioned tooltip or toast with default stacking context; panel can be covered unexpectedly.

  

  

**Math Check:** None present.

  

  

## Prioritized Bug List

  

  

This prioritized list extracts all verified issues from the audit above, organized by severity for systematic fixing. Each bug includes the affected module, a brief description, and the specific location.

  

  

### CRITICAL (Affects Simulation Correctness)

  

  

**1. FFT Power-of-2 Validation Missing** (FIXED AND COMMITTED)

  

- **File:** [`src/fft.js`](src/fft.js:8-53)

  

- **Issue:** Non-power-of-two input silently produces incorrect results

  

- **Impact:** Corrupts quantum evolution on invalid grid sizes

  

- **Fix:** Add explicit power-of-2 validation or throw error

  

  

**2. Time-Step Dependent Absorption** (FIXED AND COMMITTED)

  

- **File:** [`src/SimulationState.js`](src/SimulationState.js:168)

  

- **Issue:** Absorbing boundary damping lacks dt scaling, causing time-step dependent behavior

  

- **Impact:** Different time steps produce different absorption rates for same physical time

  

- **Fix:** Scale damping factor by dt

  

  

**3. Boundary Condition Conflicts** (FIXED AND COMMITTED)

  

- **File:** [`src/SimulationState.js`](src/SimulationState.js:26-28), [`src/SimulationState.js`](src/SimulationState.js:167-171)

  

- **Issue:** Reflective boundaries (high potential walls) conflict with absorbing boundaries (exponential damping)

  

- **Impact:** Contradictory physics - waves both reflect and get absorbed at boundaries

  

- **Fix:** Choose one boundary model or implement proper switching logic

  

  

**4. Absorbing Boundaries Applied Post-Step Only** (FIXED AND COMMITTED)

  

- **File:** [`src/ComputationEngine.js`](src/ComputationEngine.js:28)

  

- **Issue:** Absorbing mask applied after full V/2→T→V/2 sequence

  

- **Impact:** Transient wrap artifacts during kinetic evolution on small grids

  

- **Fix:** Apply absorbing mask at each substep or validate on larger grids

  

  

**5. Kinetic Operator Storage Mismatch** (FIXED AND COMMITTED)

  

- **File:** [`src/SimulationState.js`](src/SimulationState.js:55-58)

  

- **Issue:** Kinetic operator stored as complex interleaved array but used as real scalar

  

- **Impact:** Indexing mismatch with ComputationEngine, potential memory corruption

  

- **Fix:** Store as real array or fix indexing in ComputationEngine

  

  

**6. Barrier Energy Scale Not Normalized** (FIXED AND COMMITTED)

  

- **File:** [`src/presets.js`](src/presets.js:28), [`src/presets.js`](src/presets.js:43)

  

- **Issue:** Hardcoded V=200/100 without reference to HBAR, MASS, or dt

  

- **Impact:** Large dt values cause excessive phase rotation and numerical instability

  

- **Fix:** Scale barrier potentials relative to time step and physical constants

  

  

### HIGH (Causes Crashes/Instability)

  

  

**7. Missing DOM Element Null Checks**  (FIXED AND COMMITTED)

  

- **File:** [`src/UIController.js`](src/UIController.js:19-33), [`src/main.js`](src/main.js:7)

  

- **Issue:** No validation that required DOM elements exist before accessing properties

  

- **Impact:** TypeError crashes on missing elements or load order issues

  

- **Fix:** Add null checks and graceful error handling

  

  

**8. Unguarded Per-Frame Loop** (FIXED AND COMMITTED)

  

- **File:** [`src/main.js`](src/main.js:18-20)

  

- **Issue:** No try/catch around engine.step() or renderer.draw() in RAF loop

  

- **Impact:** Single exception kills entire simulation loop permanently

  

- **Fix:** Wrap loop body in try/catch with error reporting

  

  

**9. Preset Bounds Validation Missing** (FIXED AND COMMITTED)

  

- **File:** [`src/presets.js`](src/presets.js:11-29)

  

- **Issue:** No guard against out-of-bounds indices or thin-grid degeneracy

  

- **Impact:** Negative indices or array bounds violations on small grids

  

- **Fix:** Add bounds checking and grid size validation

  

  

**10. 2D FFT Dimension Swap Risk** (FIXED AND COMMITTED)

  

- **File:** [`src/ComputationEngine.js`](src/ComputationEngine.js:161), [`src/ComputationEngine.js`](src/ComputationEngine.js:179)

  

- **Issue:** Asymmetric iteration orders rely on matching transpose dimensions

  

- **Impact:** Misconfigured gridSize silently corrupts data on non-square grids

  

- **Fix:** Add dimension consistency validation

  

  

### MEDIUM (Usability/Performance Issues)

  

  

**11. Canvas Scaling Not Updated on DPR Changes** (FIXED AND COMMITTED)

  

- **File:** [`src/UIController.js`](src/UIController.js:282-286)

  

- **Issue:** Scale factors not recalculated when devicePixelRatio changes

  

- **Impact:** Drawing location deviates from cursor on display changes

  

- **Fix:** Listen for DPR changes and recalculate scaling

  

  

**12. Missing DPR-Aware Canvas Sizing**  (FIXED AND COMMITTED)

  

- **File:** [`src/main.js`](src/main.js:8-9), [`src/style.css`](src/style.css)

  

- **Issue:** Canvas sized in CSS pixels without devicePixelRatio consideration

  

- **Impact:** Blurred rendering on high-DPI displays, incorrect glow effects

  

- **Fix:** Implement proper backing store sizing with DPR

  

  

**13. Right-Click Erase Detection Inconsistent**  (FIXED AND COMMITTED)

  

- **File:** [`src/UIController.js`](src/UIController.js:95-111)

  

- **Issue:** event.buttons can be 0 during mousemove on some browsers/trackpads

  

- **Impact:** Intermittent switching between erase and draw modes

  

- **Fix:** Use more robust right-click detection method

  

  

**14. Unconditional Animation Loop** (FIXED AND COMMITTED)

  

- **File:** [`src/main.js`](src/main.js:17-23)

  

- **Issue:** RAF loop runs continuously without pause/visibility controls

  

- **Impact:** Wastes resources in background tabs, prevents deterministic stepping

  

- **Fix:** Add Page Visibility API handling and pause controls

  

  

**15. Brightness Gating Hides Structure** (FIXED AND COMMITTED)

  

- **File:** [`src/Renderer.js`](src/Renderer.js:162-168)

  

- **Issue:** Forces pixels to black if enhancedMagnitude ≤ 0.01 regardless of brightness

  

- **Impact:** Low-amplitude interference patterns become invisible

  

- **Fix:** Make threshold dependent on brightness setting

  

  

**16. Texture Size Uniform Stale on Resize** (FIXED AND COMMITTED)

  

- **File:** [`src/Renderer.js`](src/Renderer.js:183-188), [`src/Renderer.js`](src/Renderer.js:80)

  

- **Issue:** u_textureSize not updated when canvas resizes

  

- **Impact:** Glow effects use incorrect sampling offsets after resize

  

- **Fix:** Update uniform on canvas resize events

  

  

**17. Hardcoded Grid Spacing**

  

- **File:** [`src/SimulationState.js`](src/SimulationState.js:72-73)

  

- **Issue:** dx=dy=1.0 fixed, prevents physical consistency if resolution changes

  

- **Impact:** k-space and real-space scaling become inconsistent

  

- **Fix:** Calculate spacing from domain size and grid resolution

  

  

### LOW (Edge Cases/Polish Issues)

  

  

**18. Potential Scale Coupling Risk**

  

- **File:** [`src/Renderer.js`](src/Renderer.js:221-227), [`src/Renderer.js`](src/Renderer.js:145)

  

- **Issue:** CPU scales 0-100 to 0-255, shader denormalizes by 100

  

- **Impact:** Baked-in scaling assumptions, barrier opacity mismatch with physics

  

- **Fix:** Make scaling consistent between CPU and shader

  

  

**19. Non-Physical HSL Color Mapping**

  

- **File:** [`src/Renderer.js`](src/Renderer.js:66-76)

  

- **Issue:** HSL approximation warps phase-to-color uniformity

  

- **Impact:** Phase perception bias in visualization

  

- **Fix:** Implement proper HSL transform or document approximation

  

  

**20. Static GLSL Loop Bounds**

  

- **File:** [`src/Renderer.js`](src/Renderer.js:85-94)

  

- **Issue:** Hardcoded [-2,2] bounds may not compile on older mobile GPUs

  

- **Impact:** Potential shader compilation failures on some drivers

  

- **Fix:** Use compile-time constants or unroll loops explicitly

  

  

**21. UI Slider Precision Inconsistency**

  

- **File:** [`src/UIController.js`](src/UIController.js:118-142)

  

- **Issue:** Nudge updates show full float precision vs fixed decimals elsewhere

  

- **Impact:** UI inconsistency and visual noise

  

- **Fix:** Apply consistent precision formatting to all slider updates

  

  

**22. Debug Logging in Hot Path**

  

- **File:** [`src/SimulationState.js`](src/SimulationState.js:69-71)

  

- **Issue:** console.log in resetWaveFunction called frequently

  

- **Impact:** Performance impact and console noise

  

- **Fix:** Remove or gate behind debug flag

  

  

**23. Dimensionless Constants Without Units**

  

- **File:** [`src/constants.js`](src/constants.js:2-3)

  

- **Issue:** HBAR=1, MASS=1 without documented unit system

  

- **Impact:** Risk of unit drift in future physical parameter changes

  

- **Fix:** Document unit system or implement proper physical constants

  

  

**24. Inconsistent Naming Convention**

  

- **File:** [`src/constants.js`](src/constants.js:6-7)

  

- **Issue:** INITIAL_P_X/P_Y vs px/py used everywhere else

  

- **Impact:** Cognitive load and maintenance risk

  

- **Fix:** Standardize to px/py naming

  

  

**25. Dead Constant Definition**

  

- **File:** [`src/constants.js`](src/constants.js:10)

  

- **Issue:** POTENTIAL_STRENGTH defined but never used

  

- **Impact:** Code clutter and maintenance confusion

  

- **Fix:** Remove unused constant or implement usage

  

  

**26. CSS Viewport Clipping Risk**

  

- **File:** [`src/style.css`](src/style.css:2-14)

  

- **Issue:** body height:100vh + overflow:hidden can hide UI panel on small screens

  

- **Impact:** Controls become unreachable on mobile/small windows

  

- **Fix:** Implement responsive layout with proper scrolling

  

  

**27. Backdrop Filter Without Fallback**

  

- **File:** [`src/style.css`](src/style.css:37-39)

  

- **Issue:** backdrop-filter degrades to near-transparent on unsupported browsers

  

- **Impact:** Poor readability of control panel over bright canvas

  

- **Fix:** Add fallback background for unsupported browsers

  

  

**28. Accessibility Contrast Issues**

  

- **File:** [`src/style.css`](src/style.css:115-154), [`src/style.css`](src/style.css:233-258)

  

- **Issue:** Text colors fail WCAG contrast requirements, no focus indicators

  

- **Impact:** Poor accessibility for users with visual impairments

  

- **Fix:** Improve contrast ratios and add focus outlines

  

  

---

  

  

**Bug Fix Strategy:** Start with CRITICAL issues that affect simulation correctness, then address HIGH severity crashes, followed by MEDIUM usability issues. LOW priority items can be addressed during code cleanup phases.