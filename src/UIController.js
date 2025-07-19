import * as C from './constants.js';

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
        this.brushSize = 3; // Radius of the drawing brush in grid units

        // Initial scaling - will be updated dynamically based on actual display size
        this.scaleX = 1.0;
        this.scaleY = 1.0;

        this._setupEventListeners();
        console.log('✓ UI Controller initialized with mouse interaction');
    }

    /**
     * Set up mouse event listeners for drawing potential barriers
     * @private
     */
    _setupEventListeners() {
        // Prevent context menu on right click
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
        });

        // Mouse down - start drawing
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDrawing = true;
            this._drawAtPosition(e);
        });

        // Mouse move - continue drawing if mouse is down
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.isDrawing) {
                this._drawAtPosition(e);
            }
        });

        // Mouse up - stop drawing
        this.canvas.addEventListener('mouseup', () => {
            this.isDrawing = false;
        });

        // Mouse leave - stop drawing if mouse leaves canvas
        this.canvas.addEventListener('mouseleave', () => {
            this.isDrawing = false;
        });

        // Touch support for mobile devices
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.isDrawing = true;
            const touch = e.touches[0];
            const mouseEvent = new MouseEvent('mousedown', {
                clientX: touch.clientX,
                clientY: touch.clientY
            });
            this._drawAtPosition(mouseEvent);
        });

        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            if (this.isDrawing) {
                const touch = e.touches[0];
                const mouseEvent = new MouseEvent('mousemove', {
                    clientX: touch.clientX,
                    clientY: touch.clientY
                });
                this._drawAtPosition(mouseEvent);
            }
        });

        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.isDrawing = false;
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

        // Debug logging to verify coordinate conversion
        console.log('Draw event:', {
            mouse: { x: mouseX, y: mouseY },
            grid: { x: gridX, y: gridY },
            displayedSize: { w: rect.width, h: rect.height },
            internalSize: { w: this.canvas.width, h: this.canvas.height },
            scale: { x: scaleX, y: scaleY }
        });

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
                    if (x >= 0 && x < this.state.gridSize.width && 
                        y >= 0 && y < this.state.gridSize.height) {
                        
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
     * Clear all potential barriers from the simulation
     */
    clearWalls() {
        for (let i = 0; i < this.state.potential.length; i++) {
            this.state.potential[i] = 0.0;
        }
        console.log('All potential barriers cleared');
    }

    /**
     * Reset the entire simulation to initial state
     */
    resetSimulation() {
        this.state.resetWaveFunction();
        this.clearWalls();
        console.log('Simulation reset to initial state');
    }

    /**
     * Set the brush size for drawing barriers
     * @param {number} size - New brush size in grid units
     */
    setBrushSize(size) {
        this.brushSize = Math.max(1, Math.min(10, size)); // Clamp between 1 and 10
    }

    /**
     * Update canvas scaling if canvas size changes
     */
    updateScaling() {
        this.scaleX = this.state.gridSize.width / this.canvas.width;
        this.scaleY = this.state.gridSize.height / this.canvas.height;
    }
}
