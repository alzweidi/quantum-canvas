import { PRESETS } from "./presets.js";

/**
 * UIController class - Handles all user interactions and updates the simulation state
 * Allows users to draw potential barriers by clicking and dragging on canvas
 */
export class UIController {
  /**
   * Initialize the UI controller with mouse interaction
   * @param {HTMLCanvasElement} canvasElement - The canvas to listen for mouse events
   * @param {SimulationState} state - The simulation state to modify
   */
  constructor(canvasElement, state) {
    this.canvas = canvasElement;
    this.state = state;
    this.isDrawing = false;
    this.brushSize = 5; // Radius of the drawing brush in grid units (matches HTML default)

    // Mouse mode tracking
    this.mouseMode = "draw"; // 'draw' or 'velocity'
    this.velocityStartPos = null; // For velocity mode tracking

    // Initial scaling - will be updated dynamically based on actual display size
    this.scaleX = 1.0;
    this.scaleY = 1.0;

    this._setupEventListeners();
  }

  /**
   * Set up all event listeners for UI interactions
   * @private
   */
  _setupEventListeners() {
    // Prevent context menu on right click
    this.canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
    });

    // Mouse down - start drawing, velocity setting, or move packet
    this.canvas.addEventListener("mousedown", (e) => {
      if (this.mouseMode === "draw") {
        this.isDrawing = true;
        this._drawAtPosition(e);
      } else if (this.mouseMode === "velocity") {
        this._startVelocitySelection(e);
      } else if (this.mouseMode === "move") {
        this._setStartPosition(e);
      }
    });

    // Mouse move - continue drawing if mouse is down
    this.canvas.addEventListener("mousemove", (e) => {
      if (this.isDrawing && this.mouseMode === "draw") {
        this._drawAtPosition(e);
      }
    });

    // Mouse up - stop drawing or complete velocity setting
    this.canvas.addEventListener("mouseup", (e) => {
      if (this.mouseMode === "draw") {
        this.isDrawing = false;
      } else if (this.mouseMode === "velocity" && this.velocityStartPos) {
        this._completeVelocitySelection(e);
      }
    });

    // Mouse leave - stop drawing if mouse leaves canvas
    this.canvas.addEventListener("mouseleave", () => {
      this.isDrawing = false;
    });

    // Touch support for mobile devices
    this.canvas.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.isDrawing = true;
      const touch = e.touches[0];
      const mouseEvent = new MouseEvent("mousedown", {
        clientX: touch.clientX,
        clientY: touch.clientY,
      });
      this._drawAtPosition(mouseEvent);
    });

    this.canvas.addEventListener("touchmove", (e) => {
      e.preventDefault();
      if (this.isDrawing) {
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent("mousemove", {
          clientX: touch.clientX,
          clientY: touch.clientY,
        });
        this._drawAtPosition(mouseEvent);
      }
    });

    this.canvas.addEventListener("touchend", (e) => {
      e.preventDefault();
      this.isDrawing = false;
    });

    // UI Control buttons
    const resetButton = document.getElementById("reset-button");
    const clearButton = document.getElementById("clear-button");

    resetButton.addEventListener("click", () => {
      this.resetSimulation();
    });

    clearButton.addEventListener("click", () => {
      this.clearWalls();
    });

    // Preset experiment buttons
    const doubleSlitButton = document.getElementById("double-slit-button");
    const tunnelingButton = document.getElementById("tunneling-button");

    doubleSlitButton.addEventListener("click", () => {
      this.applyPreset("DOUBLE_SLIT");
    });

    tunnelingButton.addEventListener("click", () => {
      this.applyPreset("TUNNELING");
    });

    // Brush size slider
    const brushSlider = document.getElementById("brush-slider");
    const brushSizeValue = document.getElementById("brush-size-value");

    brushSlider.addEventListener("input", (e) => {
      const newSize = parseInt(e.target.value);
      this.setBrushSize(newSize);
      brushSizeValue.textContent = newSize;
    });

    // Brightness slider
    const brightnessSlider = document.getElementById("brightness-slider");
    const brightnessValue = document.getElementById("brightness-value");

    brightnessSlider.addEventListener("input", (e) => {
      const newBrightness = parseFloat(e.target.value);
      this.state.params.brightness = newBrightness;
      brightnessValue.textContent = newBrightness.toFixed(1);
    });

    // Momentum X slider
    const pxSlider = document.getElementById("px-slider");
    const pxValue = document.getElementById("px-value");

    pxSlider.addEventListener("input", (e) => {
      const newPx = parseInt(e.target.value);
      this.state.params.px = newPx;
      pxValue.textContent = newPx;
      this.state.resetWaveFunction();
    });

    // Momentum Y slider
    const pySlider = document.getElementById("py-slider");
    const pyValue = document.getElementById("py-value");

    pySlider.addEventListener("input", (e) => {
      const newPy = parseInt(e.target.value);
      this.state.params.py = newPy;
      pyValue.textContent = newPy;
      this.state.resetWaveFunction();
    });

    // Packet Width slider
    const sigmaSlider = document.getElementById("sigma-slider");
    const sigmaValue = document.getElementById("sigma-value");

    sigmaSlider.addEventListener("input", (e) => {
      const newSigma = parseInt(e.target.value);
      this.state.params.sigma = newSigma;
      sigmaValue.textContent = newSigma;
      this.state.resetWaveFunction();
    });

    // Time Step (dt) slider
    const dtSlider = document.getElementById("dt-slider");
    const dtValue = document.getElementById("dt-value");

    dtSlider.addEventListener("input", (e) => {
      const newDt = parseFloat(e.target.value);
      this.state.params.dt = newDt;
      dtValue.textContent = newDt.toFixed(3);
    });

    // Mouse Mode radio buttons
    const mouseModeRadios = document.querySelectorAll(
      'input[name="mouse-mode"]',
    );

    mouseModeRadios.forEach((radio) => {
      radio.addEventListener("change", (e) => {
        this.mouseMode = e.target.value;
      });
    });

    // Window resize handler for responsive coordinate mapping
    window.addEventListener("resize", () => {
      this.updateScaling();
    });
  }

  /**
   * Draw a potential barrier at the mouse position
   * @param {MouseEvent} event - The mouse event containing position information
   * @private
   */
  _drawAtPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert from displayed canvas coordinates to grid coordinates
    // Use the actual displayed dimensions (rect) not internal resolution
    const scaleX = this.state.gridSize.width / rect.width;
    const scaleY = this.state.gridSize.height / rect.height;

    const gridX = Math.floor(mouseX * scaleX);
    // Flip Y coordinate: browser Y=0 at top, grid Y=0 at bottom
    const gridY = Math.floor((rect.height - mouseY) * scaleY);

    // Apply barrier with brush size
    this._applyBrush(gridX, gridY);
  }

  /**
   * Apply potential barrier in a circular brush pattern
   * @param {number} centerX - Center X coordinate in grid units
   * @param {number} centerY - Center Y coordinate in grid units
   * @private
   */
  _applyBrush(centerX, centerY) {
    const potentialStrength = 100.0; // High potential value to create barriers
    const brushRadius = this.brushSize;

    // Apply circular brush pattern
    for (let dx = -brushRadius; dx <= brushRadius; dx++) {
      for (let dy = -brushRadius; dy <= brushRadius; dy++) {
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Only apply within brush radius
        if (distance <= brushRadius) {
          const x = centerX + dx;
          const y = centerY + dy;

          // Check bounds
          if (
            x >= 0 &&
            x < this.state.gridSize.width &&
            y >= 0 &&
            y < this.state.gridSize.height
          ) {
            const index = y * this.state.gridSize.width + x;

            // Apply potential with falloff based on distance from center
            const falloff = 1.0 - distance / brushRadius;
            this.state.potential[index] = potentialStrength * falloff;
          }
        }
      }
    }
  }

  /**
   * Clear all potential barriers from the simulation
   */
  clearWalls() {
    for (let i = 0; i < this.state.potential.length; i++) {
      this.state.potential[i] = 0.0;
    }
  }

  /**
   * Reset the entire simulation to initial state
   */
  resetSimulation() {
    this.state.resetWaveFunction();
    this.clearWalls();
  }

  /**
   * Set the brush size for drawing barriers
   * @param {number} size - New brush size in grid units
   */
  setBrushSize(size) {
    this.brushSize = Math.max(1, Math.min(20, size)); // Clamp between 1 and 20
  }

  /**
   * Apply a preset quantum experiment configuration
   * @param {string} presetName - The name of the preset to apply
   */
  applyPreset(presetName) {
    // First clear any existing walls
    this.clearWalls();

    // Get the preset configuration
    const preset = PRESETS[presetName];
    if (!preset) {
      console.warn(`Unknown preset: ${presetName}`);
      return;
    }

    // Apply the preset's barrier pattern
    preset.draw(
      this.state.potential,
      this.state.gridSize.width,
      this.state.gridSize.height,
    );
  }

  /**
   * Start velocity selection mode - record starting position
   * @param {MouseEvent} event - The mouse event containing position information
   * @private
   */
  _startVelocitySelection(event) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Store starting position for velocity calculation
    this.velocityStartPos = { x: mouseX, y: mouseY };
  }

  /**
   * Complete velocity selection - calculate vector and set wave packet velocity
   * @param {MouseEvent} event - The mouse event containing end position
   * @private
   */
  _completeVelocitySelection(event) {
    if (!this.velocityStartPos) return;

    const rect = this.canvas.getBoundingClientRect();
    const endX = event.clientX - rect.left;
    const endY = event.clientY - rect.top;

    // Calculate drag vector
    const deltaX = endX - this.velocityStartPos.x;
    const deltaY = endY - this.velocityStartPos.y;

    // Convert to momentum values with appropriate scaling
    // Scale factor to map pixel distance to reasonable momentum range
    const momentumScale = 2.0;
    const newPx = Math.round(deltaX * momentumScale);
    const newPy = Math.round(-deltaY * momentumScale); // Negative because Y increases downward in screen space

    // Clamp momentum values to slider ranges
    this.state.params.px = Math.max(-150, Math.min(150, newPx));
    this.state.params.py = Math.max(-150, Math.min(150, newPy));

    // Update UI displays
    document.getElementById("px-value").textContent = this.state.params.px;
    document.getElementById("py-value").textContent = this.state.params.py;
    document.getElementById("px-slider").value = this.state.params.px;
    document.getElementById("py-slider").value = this.state.params.py;

    // Apply new momentum to wave function
    this.state.resetWaveFunction();

    // Clear starting position
    this.velocityStartPos = null;
  }

  /**
   * Set the start position for wave packet (applied on next reset)
   * @param {MouseEvent} event - The mouse event containing position information
   * @private
   */
  _setStartPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    // Convert from displayed canvas coordinates to grid coordinates
    const scaleX = this.state.gridSize.width / rect.width;
    const scaleY = this.state.gridSize.height / rect.height;

    const gridX = Math.floor(mouseX * scaleX);
    // Flip Y coordinate: browser Y=0 at top, grid Y=0 at bottom
    const gridY = Math.floor((rect.height - mouseY) * scaleY);

    // Clamp coordinates to valid grid bounds
    this.state.params.x0 = Math.max(
      0,
      Math.min(this.state.gridSize.width - 1, gridX),
    );
    this.state.params.y0 = Math.max(
      0,
      Math.min(this.state.gridSize.height - 1, gridY),
    );

    // Note: Does not call resetWaveFunction() - position will be applied on next reset
    console.log(
      `Start position set to (${this.state.params.x0}, ${this.state.params.y0})`,
    );
  }

  /**
   * Update canvas scaling if canvas size changes
   */
  updateScaling() {
    this.scaleX = this.state.gridSize.width / this.canvas.width;
    this.scaleY = this.state.gridSize.height / this.canvas.height;
  }
}
