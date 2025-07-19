export class UIController {
    constructor(canvas, state) {
        this.canvas = canvas;
        this.state = state;
        this.brushSize = 5;
        this.mouseMode = 'draw'; // 'draw', 'drag', 'throw'
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

        if (this.mouseMode === 'throw') {
            const dx = gridX - this.startDragPos.x;
            const dy = gridY - this.startDragPos.y;
            this.state.params.x0 = this.startDragPos.x;
            this.state.params.y0 = this.startDragPos.y;
            this.state.params.px = dx * 2.0; // Scaling factor for good feel
            this.state.params.py = dy * 2.0;
            this.state.resetWaveFunction();
            // Update UI sliders to reflect new momentum
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

    updateScaling() {
        const rect = this.canvas.getBoundingClientRect();
        this.scaleX = this.state.gridSize.width / rect.width;
        this.scaleY = this.state.gridSize.height / rect.height;
    }
}
