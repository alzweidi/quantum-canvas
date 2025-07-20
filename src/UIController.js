import { PRESETS } from './presets.js';
import * as C from './constants.js';

export class UIController {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.brushSize = 5;
        this.mouseMode = 'draw'; // 'draw', 'drag', 'nudge'
        this.isDragging = false;
        this.startDragPos = { x: 0, y: 0 };
        this._setupEventListeners();
        this.updateScaling();
    }

    _setupEventListeners() {
        // Mouse Mode Radio Buttons
        document.getElementsByName('mouseMode').forEach(radio => {
            radio.addEventListener('change', (e) => this.mouseMode = e.target.value);
        });

        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this._handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', () => this.isDragging = false);
        window.addEventListener('resize', this.updateScaling.bind(this));

        // Other controls
        document.getElementById('reset-button').addEventListener('click', () => {
            this.state.resetWaveFunction();
        });
        document.getElementById('clear-button').addEventListener('click', () => {
            this.state.potential.fill(0);
            this.state._createReflectiveBoundary();
        });

        // Preset buttons
        document.getElementById('double-slit-button').addEventListener('click', () => {
            this._applyPreset('DOUBLE_SLIT');
        });
        document.getElementById('tunneling-button').addEventListener('click', () => {
            this._applyPreset('TUNNELING');
        });
        
        // Sliders
        this._setupSlider('brush-slider', 'brush-size-value', (val) => this.brushSize = parseInt(val));
        this._setupSlider('brightness-slider', 'brightness-value', (val) => this.state.params.brightness = parseFloat(val));
        this._setupSlider('dt-slider', 'dt-value', (val) => this.state.params.dt = parseFloat(val), 3);
        this._setupSlider('px-slider', 'px-value', (val) => this.state.params.px = parseInt(val));
        this._setupSlider('py-slider', 'py-value', (val) => this.state.params.py = parseInt(val));
        this._setupSlider('sigma-slider', 'sigma-value', (val) => this.state.params.sigma = parseInt(val));
    }
    
    _setupSlider(sliderId, valueId, callback, precision = 0) {
        const slider = document.getElementById(sliderId);
        const valueSpan = document.getElementById(valueId);
        slider.addEventListener('input', (e) => {
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
        const { gridX, gridY } = this._getGridPos(event);
        this.startDragPos = { x: gridX, y: gridY, screenX: event.clientX, screenY: event.clientY };

        if (this.mouseMode === 'draw') {
            this._applyBrush(gridX, gridY, event.buttons === 2); // buttons===2 is right-click
        }
    }

    _handleMouseMove(event) {
        if (!this.isDragging) return;
        const { gridX, gridY } = this._getGridPos(event);
        
        if (this.mouseMode === 'draw') {
            this._applyBrush(gridX, gridY, event.buttons === 2);
        } else if (this.mouseMode === 'drag') {
            const dx = Math.floor((event.clientX - this.startDragPos.screenX) * this.scaleX);
            const dy = -Math.floor((event.clientY - this.startDragPos.screenY) * this.scaleY);
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
        const { gridX, gridY } = this._getGridPos(event);

        if (this.mouseMode === 'nudge') {
            const dx = gridX - this.startDragPos.x;
            const dy = gridY - this.startDragPos.y;
            
            // Calculate momentum nudge from drag vector
            const nudgePx = dx * 2.0; // Scaling factor for good feel
            const nudgePy = dy * 2.0;
            
            // Apply quantum phase multiplication for real momentum kick
            this._applyMomentumKick(nudgePx, nudgePy);
            
            // Update stored parameters for UI feedback
            this.state.params.px += nudgePx;
            this.state.params.py += nudgePy;
            
            // Clamp momentum values to slider ranges
            this.state.params.px = Math.max(-150, Math.min(150, this.state.params.px));
            this.state.params.py = Math.max(-150, Math.min(150, this.state.params.py));
            
            // Update UI sliders to reflect new total momentum
            document.getElementById('px-slider').value = this.state.params.px;
            document.getElementById('py-slider').value = this.state.params.py;
            document.getElementById('px-value').textContent = this.state.params.px;
            document.getElementById('py-value').textContent = this.state.params.py;
        }
    }
    
    _applyBrush(centerX, centerY, isErasing) {
        const potentialStrength = isErasing ? 0.0 : 100.0;
        const brushRadius = this.brushSize;

        // Apply circular brush pattern
        for (let dx = -brushRadius; dx <= brushRadius; dx++) {
            for (let dy = -brushRadius; dy <= brushRadius; dy++) {
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                // Only apply within brush radius
                if (distance <= brushRadius) {
                    const x = centerX + dx;
                    const y = centerY + dy;

                    // Check bounds and avoid overwriting boundary potential
                    if (x >= 1 && x < this.state.gridSize.width - 1 && 
                        y >= 1 && y < this.state.gridSize.height - 1) {
                        
                        const index = y * this.state.gridSize.width + x;
                        
                        // Apply potential with falloff based on distance from center
                        const falloff = 1.0 - (distance / brushRadius);
                        this.state.potential[index] = potentialStrength * falloff;
                    }
                }
            }
        }
    }

    /**
     * Apply a quantum experiment preset
     * @param {string} presetName - The name of the preset to apply
     * @private
     */
    _applyPreset(presetName) {
        const preset = PRESETS[presetName];
        if (!preset) {
            console.warn(`Unknown preset: ${presetName}`);
            return;
        }

        // Clear existing walls (preserve reflective boundaries)
        this.state.potential.fill(0);
        this.state._createReflectiveBoundary();

        // Apply the preset's barrier pattern
        preset.draw(
            this.state.potential,
            this.state.gridSize.width,
            this.state.gridSize.height
        );

        // Set optimal initial parameters for the experiment
        if (presetName === 'DOUBLE_SLIT') {
            // Optimal parameters for wave interference demonstration
            this.state.params.px = 40;
            this.state.params.py = 0;
            this.state.params.sigma = 10;
            this.state.params.x0 = 32;
            this.state.params.y0 = 128;
        } else if (presetName === 'TUNNELING') {
            // Optimal parameters for tunneling demonstration
            this.state.params.px = 80;
            this.state.params.py = 0;
            this.state.params.sigma = 15;
            this.state.params.x0 = 64;
            this.state.params.y0 = 128;
        }

        // Update UI sliders to reflect new parameters
        document.getElementById('px-slider').value = this.state.params.px;
        document.getElementById('py-slider').value = this.state.params.py;
        document.getElementById('sigma-slider').value = this.state.params.sigma;
        
        document.getElementById('px-value').textContent = this.state.params.px;
        document.getElementById('py-value').textContent = this.state.params.py;
        document.getElementById('sigma-value').textContent = this.state.params.sigma;

        // Reset wave function with new parameters
        this.state.resetWaveFunction();
    }

    /**
     * Apply a momentum kick to the wave function using quantum phase multiplication
     * Multiplies ψ(x,y) by exp(i(Δpx*x + Δpy*y)/ℏ) to add momentum without resetting
     * @param {number} deltaPx - Momentum change in x direction
     * @param {number} deltaPy - Momentum change in y direction
     * @private
     */
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
                
                // Calculate phase: (Δpx*x + Δpy*y)/ℏ
                const phase = (deltaPx * x + deltaPy * y) / hbar;
                const cosPhase = Math.cos(phase);
                const sinPhase = Math.sin(phase);
                
                // Complex multiplication: (real + i*imag) * (cos + i*sin)
                this.state.psi[idx] = real * cosPhase - imag * sinPhase;
                this.state.psi[idx + 1] = real * sinPhase + imag * cosPhase;
            }
        }
    }

    updateScaling() {
        const rect = this.canvas.getBoundingClientRect();
        this.scaleX = this.state.gridSize.width / rect.width;
        this.scaleY = this.state.gridSize.height / rect.height;
    }
}
