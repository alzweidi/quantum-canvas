import { PRESETS } from "./presets.js";
import * as C from "./constants.js";

export class UIController {
  constructor(canvas, state) {
    this.canvas = canvas;
    this.state = state;
    this.brushSize = 5;
    this.mouseMode = "draw"; // 'draw', 'drag', 'nudge'
    this.isDragging = false;
    this.isErasing = false; // robust right-click state tracking
    this.startDragPos = { x: 0, y: 0 };
    this._setupEventListeners();
    this.updateScaling();
    this._syncUIToState();

    // initialise DPR monitoring for robust scaling
    this.lastDevicePixelRatio = window.devicePixelRatio || 1;
    this._setupDPRMonitoring();
  }

  _setupMouseModeControls() {
    // mouse mode radio buttons
    const mouseModeRadios = document.getElementsByName("mouseMode");
    if (mouseModeRadios.length === 0) {
      console.warn("Warning: No mouse mode radio buttons found in DOM");
    } else {
      mouseModeRadios.forEach((radio) => {
        radio.addEventListener(
          "change",
          (e) => (this.mouseMode = e.target.value),
        );
      });
    }
  }

  _setupBoundaryModeControls() {
    // boundary mode radio buttons
    const boundaryModeRadios = document.getElementsByName("boundaryMode");
    if (boundaryModeRadios.length === 0) {
      console.warn("Warning: No boundary mode radio buttons found in DOM");
    } else {
      boundaryModeRadios.forEach((radio) => {
        radio.addEventListener("change", (e) => {
          this.state.params.boundaryMode = e.target.value;
          this.state._updateBoundaries();
        });
      });
    }
  }

  _setupCanvasEvents() {
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    this.canvas.addEventListener("mousedown", this._handleMouseDown.bind(this));
    this.canvas.addEventListener("mousemove", this._handleMouseMove.bind(this));
    this.canvas.addEventListener("mouseup", this._handleMouseUp.bind(this));
    this.canvas.addEventListener("mouseleave", () => {
      this.isDragging = false;
      this.isErasing = false; // reset erase state on mouse leave
    });
    window.addEventListener("resize", this.updateScaling.bind(this));
  }

  _setupButtonControls() {
    // other controls
    const pauseButton = document.getElementById("pause-button");
    if (pauseButton) {
      pauseButton.addEventListener("click", () => {
        if (window.toggleAnimation) {
          window.toggleAnimation();
          // update button text based on pause state
          const isPaused = window.isPaused();
          pauseButton.textContent = isPaused ? "Play" : "Pause";
        }
      });
    } else {
      console.warn("Warning: Pause button not found in DOM");
    }

    const resetButton = document.getElementById("reset-button");
    if (resetButton) {
      resetButton.addEventListener("click", () => {
        this.state.resetWaveFunction();
      });
    } else {
      console.warn("Warning: Reset button not found in DOM");
    }

    const clearButton = document.getElementById("clear-button");
    if (clearButton) {
      clearButton.addEventListener("click", () => {
        this.state.potential.fill(0);
        this.state._updateBoundaries();
      });
    } else {
      console.warn("Warning: Clear button not found in DOM");
    }

    // preset buttons
    const doubleSlitButton = document.getElementById("double-slit-button");
    if (doubleSlitButton) {
      doubleSlitButton.addEventListener("click", () => {
        this._applyPreset("DOUBLE_SLIT");
      });
    } else {
      console.warn("Warning: Double slit button not found in DOM");
    }

    const tunnelingButton = document.getElementById("tunneling-button");
    if (tunnelingButton) {
      tunnelingButton.addEventListener("click", () => {
        this._applyPreset("TUNNELING");
      });
    } else {
      console.warn("Warning: Tunneling button not found in DOM");
    }
  }

  _setupSliders() {
    // sliders
    this._setupSlider(
      "brush-slider",
      "brush-size-value",
      (val) => (this.brushSize = parseInt(val, 10)),
    );
    this._setupSlider(
      "brightness-slider",
      "brightness-value",
      (val) => (this.state.params.brightness = parseFloat(val)),
    );
    this._setupSlider(
      "dt-slider",
      "dt-value",
      (val) => (this.state.params.dt = parseFloat(val)),
      3,
    );
    this._setupSlider(
      "barrier-strength-slider",
      "barrier-strength-value",
      (val) => (this.state.params.barrierEnergy = parseFloat(val)),
      1,
    );
    this._setupSlider(
      "px-slider",
      "px-value",
      (val) => (this.state.params.px = parseInt(val, 10)),
    );
    this._setupSlider(
      "py-slider",
      "py-value",
      (val) => (this.state.params.py = parseInt(val, 10)),
    );
    this._setupSlider(
      "sigma-slider",
      "sigma-value",
      (val) => (this.state.params.sigma = parseInt(val, 10)),
    );
  }

  _setupInitialParamSliders() {
    // live updates for initial state sliders - triggers wave function regeneration on release
    const initialParamSliders = document.querySelectorAll(
      ".initial-param-slider",
    );
    if (initialParamSliders.length === 0) {
      console.warn("Warning: No initial parameter sliders found in DOM");
    } else {
      initialParamSliders.forEach((slider) => {
        slider.addEventListener("change", () => {
          // when the user releases the slider, reset the wave function with the new values
          this.state.resetWaveFunction();
        });
      });
    }
  }

  _setupEventListeners() {
    this._setupMouseModeControls();
    this._setupBoundaryModeControls();
    this._setupCanvasEvents();
    this._setupButtonControls();
    this._setupSliders();
    this._setupInitialParamSliders();
  }

  _setupSlider(sliderId, valueId, callback, precision = 0) {
    const slider = document.getElementById(sliderId);
    const valueSpan = document.getElementById(valueId);

    if (!slider) {
      console.warn(
        `Warning: Slider element with id "${sliderId}" not found in DOM`,
      );
      return;
    }

    if (!valueSpan) {
      console.warn(
        `Warning: Value span element with id "${valueId}" not found in DOM`,
      );
      return;
    }

    slider.addEventListener("input", (e) => {
      const value = e.target.value;
      callback(value);
      valueSpan.textContent = parseFloat(value).toFixed(precision);
    });
  }

  _getGridPos(event) {
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const gridX = Math.floor(x * this.scaleX);
    const gridY = Math.floor((rect.height - y) * this.scaleY);
    return { gridX, gridY };
  }

  _handleMouseDown(event) {
    this.isDragging = true;
    // robust right-click detection using event.button (reliable across browsers/trackpads)
    this.isErasing = event.button === 2;
    const { gridX, gridY } = this._getGridPos(event);
    this.startDragPos = {
      x: gridX,
      y: gridY,
      screenX: event.clientX,
      screenY: event.clientY,
    };

    if (this.mouseMode === "draw") {
      this._applyBrush(gridX, gridY, this.isErasing);
    }
  }

  _handleMouseMove(event) {
    if (!this.isDragging) return;
    const { gridX, gridY } = this._getGridPos(event);

    if (this.mouseMode === "draw") {
      // use persistent state instead of unreliable event.buttons during mousemove
      this._applyBrush(gridX, gridY, this.isErasing);
    } else if (this.mouseMode === "drag") {
      const dx = Math.floor(
        (event.clientX - this.startDragPos.screenX) * this.scaleX,
      );
      const dy = -Math.floor(
        (event.clientY - this.startDragPos.screenY) * this.scaleY,
      );
      if (dx !== 0 || dy !== 0) {
        this.state.shiftWaveFunction(dx, dy);
        this.startDragPos.screenX = event.clientX;
        this.startDragPos.screenY = event.clientY;
      }
    }
  }

  _handleMouseUp(event) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.isErasing = false; // reset erase state
    const { gridX, gridY } = this._getGridPos(event);

    if (this.mouseMode === "nudge") {
      const dx = gridX - this.startDragPos.x;
      const dy = gridY - this.startDragPos.y;

      // add unit conversion for physical momentum consistency
      const cellDx = C.DOMAIN_SIZE / this.state.gridSize.width;
      const cellDy = C.DOMAIN_SIZE / this.state.gridSize.height;

      // convert drag (cells) to physical momenta
      const nudgePx = (dx * 2.0) / cellDx; // physical momentum
      const nudgePy = (dy * 2.0) / cellDy; // physical momentum

      // apply quantum phase multiplication for real momentum kick
      this._applyMomentumKick(nudgePx, nudgePy);

      // update stored parameters for UI feedback
      this.state.params.px += nudgePx;
      this.state.params.py += nudgePy;

      // clamp momentum to Nyquist limits to prevent aliasing
      this.state._clampMomentumToNyquist();

      // clamp momentum values to slider ranges
      this.state.params.px = Math.max(
        -150,
        Math.min(150, this.state.params.px),
      );
      this.state.params.py = Math.max(
        -150,
        Math.min(150, this.state.params.py),
      );

      // update UI sliders to reflect new total momentum
      const pxSlider = document.getElementById("px-slider");
      const pySlider = document.getElementById("py-slider");
      const pxValue = document.getElementById("px-value");
      const pyValue = document.getElementById("py-value");

      if (pxSlider) {
        pxSlider.value = this.state.params.px;
      } else {
        console.warn(
          "Warning: px-slider element not found for momentum update",
        );
      }

      if (pySlider) {
        pySlider.value = this.state.params.py;
      } else {
        console.warn(
          "Warning: py-slider element not found for momentum update",
        );
      }

      if (pxValue) {
        pxValue.textContent = this.state.params.px;
      } else {
        console.warn("Warning: px-value element not found for momentum update");
      }

      if (pyValue) {
        pyValue.textContent = this.state.params.py;
      } else {
        console.warn("Warning: py-value element not found for momentum update");
      }
    }
  }

  _applyBrush(centerX, centerY, isErasing) {
    const potentialStrength = isErasing ? 0.0 : this.state.params.barrierEnergy;
    const brushRadius = this.brushSize;

    // apply circular brush pattern
    for (let dx = -brushRadius; dx <= brushRadius; dx++) {
      for (let dy = -brushRadius; dy <= brushRadius; dy++) {
        const distance = Math.sqrt(dx * dx + dy * dy);

        // only apply within brush radius
        if (distance <= brushRadius) {
          const x = centerX + dx;
          const y = centerY + dy;

          // check bounds and avoid overwriting boundary potential
          if (
            x >= 1 &&
            x < this.state.gridSize.width - 1 &&
            y >= 1 &&
            y < this.state.gridSize.height - 1
          ) {
            const index = y * this.state.gridSize.width + x;

            // apply potential with falloff based on distance from center
            const falloff = 1.0 - distance / brushRadius;
            this.state.potential[index] = potentialStrength * falloff;
          }
        }
      }
    }
  }

  /**
   * apply a quantum experiment preset
   * @param {string} presetName - the name of the preset to apply
   * @private
   */
  _applyPreset(presetName) {
    const preset = PRESETS[presetName];
    if (!preset) {
      console.warn(`Unknown preset: ${presetName}`);
      return;
    }

    // clear existing walls (preserve current boundary mode)
    this.state.potential.fill(0);
    this.state._updateBoundaries();

    // apply the preset's barrier pattern
    preset.draw(
      this.state.potential,
      this.state.gridSize.width,
      this.state.gridSize.height,
      this.state.params.barrierEnergy,
    );

    // set optimal initial parameters for the experiment with grid-relative positioning
    const width = this.state.gridSize.width;
    const height = this.state.gridSize.height;

    // calculate Nyquist-safe momentum values to prevent aliasing
    const dx = C.DOMAIN_SIZE / width;
    const kMax = Math.PI / dx; // Nyquist wavenumber
    const pxSafe = 0.6 * kMax * C.HBAR; // 60% of Nyquist for headroom
    this.state.params.px =
      presetName === "TUNNELING" ? pxSafe : 0.4 * kMax * C.HBAR;
    this.state.params.py = 0;

    if (presetName === "DOUBLE_SLIT") {
      // optimal parameters for wave interference demonstration
      this.state.params.sigma = Math.max(8, Math.floor(width * 0.04)); // ~4% of grid width, min 8
      this.state.params.x0 = Math.floor(width * 0.125); // 1/8 from left edge
      this.state.params.y0 = Math.floor(height * 0.5); // vertically centered
    } else if (presetName === "TUNNELING") {
      // optimal parameters for tunneling demonstration
      this.state.params.sigma = Math.max(10, Math.floor(width * 0.06)); // ~6% of grid width, min 10
      this.state.params.x0 = Math.floor(width * 0.25); // 1/4 from left edge
      this.state.params.y0 = Math.floor(height * 0.5); // vertically centered
    }

    // update UI sliders to reflect new parameters
    const pxSlider = document.getElementById("px-slider");
    const pySlider = document.getElementById("py-slider");
    const sigmaSlider = document.getElementById("sigma-slider");
    const pxValue = document.getElementById("px-value");
    const pyValue = document.getElementById("py-value");
    const sigmaValue = document.getElementById("sigma-value");

    if (pxSlider) pxSlider.value = this.state.params.px;
    if (pySlider) pySlider.value = this.state.params.py;
    if (sigmaSlider) sigmaSlider.value = this.state.params.sigma;
    if (pxValue) pxValue.textContent = this.state.params.px;
    if (pyValue) pyValue.textContent = this.state.params.py;
    if (sigmaValue) sigmaValue.textContent = this.state.params.sigma;

    // reset wave function with new parameters
    this.state.resetWaveFunction();
  }

  /**
   * apply a momentum kick to the wave function using quantum phase multiplication
   * multiplies ψ(x,y) by exp(i(Δpx*x + Δpy*y)/ℏ) to add momentum without resetting
   * @param {number} deltaPx - momentum change in x direction
   * @param {number} deltaPy - momentum change in y direction
   * @private
   */
  _applyMomentumKick(deltaPx, deltaPy) {
    const width = this.state.gridSize.width;
    const height = this.state.gridSize.height;
    const hbar = C.HBAR;

    // FIX: calculate grid spacing to convert indices to physical coordinates
    // this ensures consistency with wave function initialisation coordinate system
    const dx = C.DOMAIN_SIZE / width;
    const dy = C.DOMAIN_SIZE / height;

    // apply phase multiplication: ψ' = ψ * exp(i(Δp·r)/ℏ)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = 2 * (y * width + x);
        const real = this.state.psi[idx];
        const imag = this.state.psi[idx + 1];

        // FIX: convert grid indices to physical coordinates for correct momentum kick
        // calculate phase: (Δpx*x_physical + Δpy*y_physical)/ℏ
        const phase = (deltaPx * x * dx + deltaPy * y * dy) / hbar;
        const cosPhase = Math.cos(phase);
        const sinPhase = Math.sin(phase);

        // complex multiplication: (real + i*imag) * (cos + i*sin)
        this.state.psi[idx] = real * cosPhase - imag * sinPhase;
        this.state.psi[idx + 1] = real * sinPhase + imag * cosPhase;
      }
    }
  }

  /**
   * synchronises the UI controls to match the current simulation state.
   * ensures that sliders and value displays reflect the authoritative state on load.
   * @private
   */
  _syncUIToState() {
    // sync brush size (which is a direct property of the controller)
    const brushSlider = document.getElementById("brush-slider");
    const brushValue = document.getElementById("brush-size-value");

    if (brushSlider) {
      brushSlider.value = this.brushSize;
    } else {
      console.warn("Warning: brush-slider element not found during UI sync");
    }

    if (brushValue) {
      brushValue.textContent = this.brushSize;
    } else {
      console.warn(
        "Warning: brush-size-value element not found during UI sync",
      );
    }

    // sync all parameters from the state.params object
    const paramsToSync = [
      "brightness",
      "dt",
      "barrierEnergy",
      "px",
      "py",
      "sigma",
    ];
    paramsToSync.forEach((param) => {
      const sliderId =
        param === "barrierEnergy"
          ? "barrier-strength-slider"
          : `${param}-slider`;
      const valueId =
        param === "barrierEnergy" ? "barrier-strength-value" : `${param}-value`;
      const slider = document.getElementById(sliderId);
      const valueSpan = document.getElementById(valueId);
      const precision = param === "dt" ? 3 : param === "barrierEnergy" ? 1 : 0;

      if (slider && valueSpan) {
        slider.value = this.state.params[param];
        valueSpan.textContent = parseFloat(this.state.params[param]).toFixed(
          precision,
        );
      } else {
        if (!slider) {
          console.warn(`Warning: ${sliderId} element not found during UI sync`);
        }
        if (!valueSpan) {
          console.warn(`Warning: ${valueId} element not found during UI sync`);
        }
      }
    });

    // sync boundary mode radio buttons
    const boundaryRadio = document.querySelector(
      `input[name="boundaryMode"][value="${this.state.params.boundaryMode}"]`,
    );
    if (boundaryRadio) {
      boundaryRadio.checked = true;
    } else {
      console.warn(
        `Warning: boundary mode radio button with value "${this.state.params.boundaryMode}" not found during UI sync`,
      );
    }
  }

  /**
   * setup robust DPR monitoring to detect zoom and display changes
   * uses multiple detection strategies for maximum reliability
   */
  _setupDPRMonitoring() {
    // strategy 1: matchMedia for zoom detection (most efficient)
    this.mediaQueries = [];

    // monitor common zoom levels that change DPR
    const zoomLevels = [
      0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0,
    ];
    zoomLevels.forEach((zoom) => {
      try {
        const query = window.matchMedia(`(resolution: ${zoom}dppx)`);
        const handler = () => this._handleDPRChange();
        query.addListener(handler);
        this.mediaQueries.push({ query, handler });
      } catch (e) {
        // fallback for browsers that don't support resolution queries
      }
    });

    // strategy 2: polling fallback with throttling
    this.dprCheckInterval = setInterval(() => {
      this._checkDPRChange();
    }, 1000); // check every second (less aggressive than experiment)

    // strategy 3: visual viewport API if available
    if (window.visualViewport) {
      const handler = () => this._handleDPRChange();
      window.visualViewport.addEventListener("resize", handler);
      this.visualViewportHandler = handler;
    }
  }

  /**
   * check for devicePixelRatio changes (polling strategy)
   */
  _checkDPRChange() {
    const currentDPR = window.devicePixelRatio || 1;
    if (Math.abs(currentDPR - this.lastDevicePixelRatio) > 0.01) {
      this.lastDevicePixelRatio = currentDPR;
      this._handleDPRChange();
    }
  }

  /**
   * handle DPR changes with throttling to prevent excessive updates
   */
  _handleDPRChange() {
    // throttle updates to prevent excessive recalculation
    if (this.dprUpdatePending) return;

    this.dprUpdatePending = true;
    requestAnimationFrame(() => {
      this.updateScaling();
      this.dprUpdatePending = false;
    });
  }

  /**
   * cleanup DPR monitoring resources to prevent memory leaks
   */
  _cleanupDPRMonitoring() {
    // clear polling interval
    if (this.dprCheckInterval) {
      clearInterval(this.dprCheckInterval);
      this.dprCheckInterval = null;
    }

    // remove media query listeners
    if (this.mediaQueries) {
      this.mediaQueries.forEach(({ query, handler }) => {
        try {
          query.removeListener(handler);
        } catch (e) {
          // ignore cleanup errors
        }
      });
      this.mediaQueries = [];
    }

    // remove visual viewport listener
    if (this.visualViewportHandler && window.visualViewport) {
      window.visualViewport.removeEventListener(
        "resize",
        this.visualViewportHandler,
      );
      this.visualViewportHandler = null;
    }
  }

  /**
   * update canvas scaling factors with DPR awareness
   * FIXED: correct mouse-to-grid coordinate mapping
   */
  updateScaling() {
    const rect = this.canvas.getBoundingClientRect();

    // FIXED: Do NOT multiply rect dimensions by DPR for mouse coordinate mapping
    // rect.width/height are already in CSS pixels, which is what mouse events use
    // DPR scaling is handled at the canvas backing store level, not coordinate mapping
    this.scaleX = this.state.gridSize.width / rect.width;
    this.scaleY = this.state.gridSize.height / rect.height;
  }

  /**
   * cleanup resources when controller is destroyed
   */
  destroy() {
    this._cleanupDPRMonitoring();
  }
}
