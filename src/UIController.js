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
        this._syncUIToState();
    }

    _setupEventListeners() {
        // mouse mode radio buttons
        document.getElementsByName('mouseMode').forEach(radio => {
            radio.addEventListener('change', (e) => this.mouseMode = e.target.value);
        });

        // boundary mode radio buttons
        document.getElementsByName('boundaryMode').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.state.params.boundaryMode = e.target.value;
                this.state._updateBoundaries();
            });
        });

        this.canvas.addEventListener('contextmenu', e => e.preventDefault());
        this.canvas.addEventListener('mousedown', this._handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this._handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this._handleMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', () => this.isDragging = false);
        window.addEventListener('resize', this.updateScaling.bind(this));

        // other controls
        document.getElementById('reset-button').addEventListener('click', () => {
            this.state.resetWaveFunction();
        });
        document.getElementById('clear-button').addEventListener('click', () => {
            this.state.potential.fill(0);
            this.state._updateBoundaries();
        });

        // preset buttons
        document.getElementById('double-slit-button').addEventListener('click', () => {
            this._applyPreset('DOUBLE_SLIT');
        });
        document.getElementById('tunneling-button').addEventListener('click', () => {
            this._applyPreset('TUNNELING');
        });
        
        // sliders
        this._setupSlider('brush-slider', 'brush-size-value', (val) => this.brushSize = parseInt(val, 10));
        this._setupSlider('brightness-slider', 'brightness-value', (val) => this.state.params.brightness = parseFloat(val));
        this._setupSlider('dt-slider', 'dt-value', (val) => this.state.params.dt = parseFloat(val), 3);
        this._setupSlider('px-slider', 'px-value', (val) => this.state.params.px = parseInt(val, 10));
        this._setupSlider('py-slider', 'py-value', (val) => this.state.params.py = parseInt(val, 10));
        this._setupSlider('sigma-slider', 'sigma-value', (val) => this.state.params.sigma = parseInt(val, 10));

        // live updates for initial state sliders - triggers wave function regeneration on release
        const initialParamSliders = document.querySelectorAll('.initial-param-slider');
        initialParamSliders.forEach(slider => {
            slider.addEventListener('change', () => {
                // when the user releases the slider, reset the wave function with the new values
                this.state.resetWaveFunction();
            });
        });
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
            const isErasing = (event.buttons & 2) !== 0; // use bitwise AND to check for right mouse button
            this._applyBrush(gridX, gridY, isErasing);
        }
    }

    _handleMouseMove(event) {
        if (!this.isDragging) return;
        const { gridX, gridY } = this._getGridPos(event);
        
        if (this.mouseMode === 'draw') {
            const isErasing = (event.buttons & 2) !== 0; // use bitwise AND to check for right mouse button
            this._applyBrush(gridX, gridY, isErasing);
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
            
            // calculate momentum nudge from drag vector
            const nudgePx = dx * 2.0; // scaling factor for good feel
            const nudgePy = dy * 2.0;
            
            // apply quantum phase multiplication for real momentum kick
            this._applyMomentumKick(nudgePx, nudgePy);
            
            // update stored parameters for UI feedback
            this.state.params.px += nudgePx;
            this.state.params.py += nudgePy;
            
            // clamp momentum values to slider ranges
            this.state.params.px = Math.max(-150, Math.min(150, this.state.params.px));
            this.state.params.py = Math.max(-150, Math.min(150, this.state.params.py));
            
            // update UI sliders to reflect new total momentum
            document.getElementById('px-slider').value = this.state.params.px;
            document.getElementById('py-slider').value = this.state.params.py;
            document.getElementById('px-value').textContent = this.state.params.px;
            document.getElementById('py-value').textContent = this.state.params.py;
        }
    }
    
    _applyBrush(centerX, centerY, isErasing) {
        const potentialStrength = isErasing ? 0.0 : 100.0;
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
                    if (x >= 1 && x < this.state.gridSize.width - 1 && 
                        y >= 1 && y < this.state.gridSize.height - 1) {
                        
                        const index = y * this.state.gridSize.width + x;
                        
                        // apply potential with falloff based on distance from center
                        const falloff = 1.0 - (distance / brushRadius);
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
            this.state.gridSize.height
        );

        // set optimal initial parameters for the experiment
        if (presetName === 'DOUBLE_SLIT') {
            // optimal parameters for wave interference demonstration
            this.state.params.px = 40;
            this.state.params.py = 0;
            this.state.params.sigma = 10;
            this.state.params.x0 = 32;
            this.state.params.y0 = 128;
        } else if (presetName === 'TUNNELING') {
            // optimal parameters for tunneling demonstration
            this.state.params.px = 80;
            this.state.params.py = 0;
            this.state.params.sigma = 15;
            this.state.params.x0 = 64;
            this.state.params.y0 = 128;
        }

        // update UI sliders to reflect new parameters
        document.getElementById('px-slider').value = this.state.params.px;
        document.getElementById('py-slider').value = this.state.params.py;
        document.getElementById('sigma-slider').value = this.state.params.sigma;
        
        document.getElementById('px-value').textContent = this.state.params.px;
        document.getElementById('py-value').textContent = this.state.params.py;
        document.getElementById('sigma-value').textContent = this.state.params.sigma;

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

        // apply phase multiplication: ψ' = ψ * exp(i(Δp·r)/ℏ)
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

    /**
     * synchronises the UI controls to match the current simulation state.
     * ensures that sliders and value displays reflect the authoritative state on load.
     * @private
     */
    _syncUIToState() {
        // sync brush size (which is a direct property of the controller)
        document.getElementById('brush-slider').value = this.brushSize;
        document.getElementById('brush-size-value').textContent = this.brushSize;

        // sync all parameters from the state.params object
        const paramsToSync = ['brightness', 'dt', 'px', 'py', 'sigma'];
        paramsToSync.forEach(param => {
            const slider = document.getElementById(`${param}-slider`);
            const valueSpan = document.getElementById(`${param}-value`);
            const precision = (param === 'dt') ? 3 : 0;

            if (slider && valueSpan) {
                slider.value = this.state.params[param];
                valueSpan.textContent = parseFloat(this.state.params[param]).toFixed(precision);
            }
        });

        // sync boundary mode radio buttons
        const boundaryRadio = document.querySelector(`input[name="boundaryMode"][value="${this.state.params.boundaryMode}"]`);
        if (boundaryRadio) {
            boundaryRadio.checked = true;
        }
    }

    updateScaling() {
        const rect = this.canvas.getBoundingClientRect();
        this.scaleX = this.state.gridSize.width / rect.width;
        this.scaleY = this.state.gridSize.height / rect.height;
    }
}
