// renderer.js — physically faithful renderer for the quantum wave function
// - uses float RGBA textures when supported; else uint8 + global scale (lossless phase, correct amplitude).
// - textures are sized to the SIMULATION GRID (not DPR), letting the GPU upscale cleanly.
// - no per-pixel normalisation: preserves |ψ| and phase so interference looks right.

const DEBUG =
  new URLSearchParams(location.search).has('debug') ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('qc.debug') === '1');

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvasElement
   */
  constructor(canvasElement) {
    this.canvas = canvasElement;

    // ---- GL context (prefer WebGL2) ----
    const gl2 = canvasElement.getContext('webgl2', { alpha: false, antialias: false }) || null;
    const gl =
      gl2 ||
      canvasElement.getContext('webgl', { alpha: false, antialias: false }) ||
      canvasElement.getContext('experimental-webgl', { alpha: false, antialias: false });
    if (!gl) throw new Error('WebGL not available');

    this.gl = gl;
    this.isWebGL2 = !!gl2;

    // precision check for fragment shader
    const spf = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    this.hasHighp = !!spf && spf.precision > 0;

    // float texture support (WebGL2 has it; WebGL1 via extension)
    this.supportsFloatTex = this.isWebGL2 || !!gl.getExtension('OES_texture_float');
    this.supportsFloatLinear = this.isWebGL2 || !!gl.getExtension('OES_texture_float_linear');

    // create regl on our context (ask for float extensions explicitly in WebGL1)
    this.regl = window.createREGL({
      gl,
      extensions: this.isWebGL2 ? [] : ['OES_texture_float', 'OES_texture_float_linear'],
    });

    // mode: true => uint8 fallback (with global scale); false => float textures
    this.uint8Mode = !this.supportsFloatTex;

    // current sim texture allocation
    this.texW = 0;
    this.texH = 0;

    // GPU resources
    this.psiTexture = null;
    this.potentialTexture = null;

    // CPU staging buffers (allocated on first draw)
    this.psiF32 = null;   // float path buffer (RGBA)
    this.potF32 = null;
    this.psiU8  = null;   // uint8 path buffer (RGBA)
    this.potU8  = null;

    // last computed global scale (uint8 mode only)
    this.currentScale = 1.0;

    // build draw command
    this.drawCommand = this._makeDrawCommand();

    if (DEBUG) {
      console.log(
        `[Renderer] WebGL${this.isWebGL2 ? '2' : '1'} | highp=${this.hasHighp} | floatTex=${this.supportsFloatTex} | floatLinear=${this.supportsFloatLinear} | mode=${this.uint8Mode ? 'UINT8+scale' : 'FLOAT'}`
      );
    }
  }

  // create / update textures and staging buffers for a given grid size
  _ensureTextures(simW, simH) {
    if (this.texW === simW && this.texH === simH && this.psiTexture && this.potentialTexture) {
      return;
    }

    this.texW = simW;
    this.texH = simH;

    // release old textures if any
    if (this.psiTexture) this.psiTexture.destroy();
    if (this.potentialTexture) this.potentialTexture.destroy();

    const filtering = this.supportsFloatLinear ? 'linear' : 'nearest';

    if (this.uint8Mode) {
      // ----- UINT8 TEXTURES (normalised upload) -----
      this.psiTexture = this.regl.texture({
        width: simW, height: simH,
        format: 'rgba', type: 'uint8',
        mag: 'linear', min: 'linear', wrapS: 'clamp', wrapT: 'clamp',
        data: null,
      });
      this.potentialTexture = this.regl.texture({
        width: simW, height: simH,
        format: 'rgba', type: 'uint8',
        mag: 'linear', min: 'linear', wrapS: 'clamp', wrapT: 'clamp',
        data: null,
      });

      this.psiU8 = new Uint8Array(simW * simH * 4);
      this.potU8 = new Uint8Array(simW * simH * 4);
      this.psiF32 = this.potF32 = null; // free
    } else {
      // ----- FLOAT TEXTURES (RGBA32F) -----
      this.psiTexture = this.regl.texture({
        width: simW, height: simH,
        format: 'rgba', type: 'float',
        mag: filtering, min: filtering, wrapS: 'clamp', wrapT: 'clamp',
        data: null,
      });
      this.potentialTexture = this.regl.texture({
        width: simW, height: simH,
        format: 'rgba', type: 'float',
        mag: filtering, min: filtering, wrapS: 'clamp', wrapT: 'clamp',
        data: null,
      });

      this.psiF32 = new Float32Array(simW * simH * 4);
      this.potF32 = new Float32Array(simW * simH * 4);
      this.psiU8 = this.potU8 = null; // free
    }

    if (DEBUG) {
      console.log(`[Renderer] Allocated textures ${simW}×${simH} (mode: ${this.uint8Mode ? 'uint8' : 'float'})`);
    }
  }

  _makeDrawCommand() {
    const precision = this.hasHighp ? 'highp' : 'mediump';

    const vert = `
      precision ${precision} float;
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = 0.5 * position + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    // domain-coloring: hue = phase, brightness ~ sqrt(|ψ|)
    // uint8 fallback reconstructs ψ via uniform u_scale (global).
    const frag = `
      precision ${precision} float;
      varying vec2 vUv;

      uniform sampler2D psiTexture;
      uniform sampler2D potentialTexture;

      uniform float u_brightness;
      uniform float u_magCutoff;
      uniform float u_scale;     // uint8 mode only (global amplitude scale)
      uniform int   u_uint8Mode; // 1 => uint8+scale, 0 => float

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;

      vec3 hsv2rgb(vec3 c) {
        // from Inigo Quilez
        vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return c.z * mix(vec3(1.0), rgb, c.y);
      }

      void main() {
        vec4 t = texture2D(psiTexture, vUv);
        vec2 psi;
        if (u_uint8Mode == 1) {
          // t.rg in [0,1] → [-1,1] → multiply global scale
          psi = (t.rg * 2.0 - 1.0) * max(u_scale, 1e-12);
        } else {
          // float path: stored as raw re,im in RG
          psi = t.rg;
        }

        float mag = length(psi);              // |ψ|
        if (mag < u_magCutoff) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }

        float phase = atan(psi.y, psi.x);     // [-π, π]
        float hue   = fract((phase + PI) / TAU); // [0,1]
        // perceptual brightness: use sqrt(|ψ|) and external brightness
        float amp   = sqrt(mag) * u_brightness;

        // base color: full saturation, value=1, then scale by amp
        vec3 base = hsv2rgb(vec3(hue, 1.0, 1.0)) * amp;

        // subtle phase contours (K lines per 2π)
        float K = 24.0;
        float f = abs(fract((phase + PI) / TAU * K) - 0.5);
        float contour = smoothstep(0.48, 0.5, f); // thin dark lines
        base = mix(base, base * 0.7, contour * 0.25 * clamp(amp, 0.0, 1.0));

        // Potential overlay (normalized 0..1 in texture R)
        float pot = texture2D(potentialTexture, vUv).r;
        // Slightly quadratic opacity to emphasize higher barriers
        float potAlpha = 0.6 * pot * pot;
        vec3 barrier = vec3(0.85, 0.15, 0.15);
        vec3 color = mix(base, barrier, potAlpha);

        gl_FragColor = vec4(color, 1.0);
      }
    `;

    return this.regl({
      vert,
      frag,
      attributes: {
        position: [
          [-1, -1], [ 1, -1], [-1,  1],
          [-1,  1], [ 1, -1], [ 1,  1],
        ],
      },
      uniforms: {
        psiTexture: this.regl.prop('psi'),
        potentialTexture: this.regl.prop('pot'),
        u_brightness: this.regl.prop('brightness'),
        u_magCutoff: this.regl.prop('magCutoff'),
        u_scale: this.regl.prop('uScale'),
        u_uint8Mode: this.regl.prop('uint8Mode'),
      },
      count: 6,
    });
  }

  /**
   * render the current quantum state
   * @param {SimulationState} state
   */
  draw(state) {
    const simW = state.gridSize.width;
    const simH = state.gridSize.height;
    this._ensureTextures(simW, simH);

    // potential normalisation base (kept same as your code path)
    const potentialMax = (state.params.barrierEnergy > 0) ? state.params.barrierEnergy : 300.0;

    if (this.uint8Mode) {
      // ---- pass 1: find global amplitude scale S = max(|re_i|, |im_i|) ----
      const psi = state.psi;
      let S = 0.0;
      for (let i = 0; i < psi.length; i += 2) {
        const ar = Math.abs(psi[i]);
        const ai = Math.abs(psi[i + 1]);
        if (ar > S) S = ar;
        if (ai > S) S = ai;
      }
      if (!Number.isFinite(S) || S < 1e-12) S = 1.0;
      this.currentScale = S;

      // ---- pass 2: pack ψ to RG (uint8), normalized by S (lossless phase; amp restored in shader) ----
      const out = this.psiU8;
      let o = 0;
      for (let i = 0; i < psi.length; i += 2) {
        const r = psi[i] / S;       // [-?, ?] → typically small
        const im = psi[i + 1] / S;
        // map [-1,1] → [0,255]
        const r01 = Math.max(0, Math.min(1, r * 0.5 + 0.5));
        const i01 = Math.max(0, Math.min(1, im * 0.5 + 0.5));
        out[o++] = (r01 * 255) | 0; // R = re
        out[o++] = (i01 * 255) | 0; // G = im
        out[o++] = 0;               // B
        out[o++] = 255;             // A
      }
      this.psiTexture.subimage({ data: out, width: simW, height: simH });

      // potential (normalise 0..1 → uint8)
      const pout = this.potU8;
      const V = state.potential;
      o = 0;
      const invMax = potentialMax > 0 ? (1.0 / potentialMax) : 0.0;
      for (let i = 0; i < V.length; i++) {
        const v01 = Math.max(0, Math.min(1, V[i] * invMax));
        const b = (v01 * 255) | 0;
        pout[o++] = b;   // R
        pout[o++] = 0;   // G
        pout[o++] = 0;   // B
        pout[o++] = 255; // A
      }
      this.potentialTexture.subimage({ data: pout, width: simW, height: simH });
    } else {
      // float path: store ψ directly in RG (re, im), potential normalized in R
      const psi = state.psi;
      const out = this.psiF32;
      let o = 0;
      for (let i = 0; i < psi.length; i += 2) {
        out[o++] = psi[i];       // R = re
        out[o++] = psi[i + 1];   // G = im
        out[o++] = 0.0;          // B
        out[o++] = 1.0;          // A
      }
      this.psiTexture.subimage({ data: out, width: simW, height: simH });

      const V = state.potential;
      const pout = this.potF32;
      o = 0;
      const invMax = potentialMax > 0 ? (1.0 / potentialMax) : 0.0;
      for (let i = 0; i < V.length; i++) {
        pout[o++] = Math.max(0, Math.min(1, V[i] * invMax)); // R = normalised potential
        pout[o++] = 0.0;
        pout[o++] = 0.0;
        pout[o++] = 1.0;
      }
      this.potentialTexture.subimage({ data: pout, width: simW, height: simH });
    }

    // clear + draw
    this.regl.clear({ color: [0, 0, 0, 1], depth: 1 });
    this.drawCommand({
      psi: this.psiTexture,
      pot: this.potentialTexture,
      brightness: state.params.brightness,
      magCutoff: (Number.isFinite(state.visual?.magCutoff) && state.visual.magCutoff >= 0 ? state.visual.magCutoff : 0.0),
      uScale: this.uint8Mode ? this.currentScale : 1.0,
      uint8Mode: this.uint8Mode ? 1 : 0,
    });
  }
}
