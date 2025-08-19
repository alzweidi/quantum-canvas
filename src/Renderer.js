// renderer.js — physically faithful renderer for the quantum wave function
// - uses uint8 RGBA textures for wave function representation (lossless phase, correct amplitude).
// - textures are sized to the canvas backing store dimensions, accounting for device pixel ratio (DPR), for correct rendering on high-DPI displays.
// - no per-pixel normalization: preserves |ψ| and phase so interference looks right.

const DEBUG =
  new URLSearchParams(location.search).has('debug') ||
  (typeof localStorage !== 'undefined' &&
    localStorage.getItem('qc.debug') === '1')

// feature flags (from ?query or localStorage)
const qs = new URLSearchParams(location.search)
function flagBool (qKey, storageKey, defaultValue) {
  try {
    if (qs.has(qKey)) {
      const v = qs.get(qKey)
      return !(v === '0' || v === 'false')
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(storageKey)
      if (v != null) return v === '1' || v === 'true'
    }
  } catch (_) {}
  return defaultValue
}
function flagNum (qKey, storageKey, defaultValue) {
  try {
    if (qs.has(qKey)) {
      const n = Number(qs.get(qKey))
      if (Number.isFinite(n)) return n
    }
    if (typeof localStorage !== 'undefined') {
      const v = localStorage.getItem(storageKey)
      if (v != null) {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
    }
  } catch (_) {}
  return defaultValue
}

// a/b toggle to restore old two-texture path (psi + potential separate)
const RENDERER_TWO_TEXTURES = flagBool(
  'rendererTwoTextures',
  'qc.renderer.twoTextures',
  false
)
// enable half-float path when float32 unavailable
const ENABLE_HALF_FLOAT = flagBool('halfFloat', 'qc.renderer.halfFloat', true)
// enable perceptual colormap instead of HSV
const ENABLE_PERCEPTUAL_COLORMAP = flagBool('perceptualColormap', 'qc.renderer.perceptualColormap', false)
// uint8 scale scan cadence and smoothing
const UINT8_SCALE_EVERY_N = flagNum('u8n', 'qc.renderer.u8n', 4)
const UINT8_SCALE_SMOOTH_ALPHA = flagNum('u8alpha', 'qc.renderer.u8alpha', 0.5)

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvasElement
   */
  constructor (canvasElement) {
    this.canvas = canvasElement

    // ---- GL context (prefer WebGL2) ----
    const gl2 =
      canvasElement.getContext('webgl2', { alpha: false, antialias: false }) ||
      null
    const gl =
      gl2 ||
      canvasElement.getContext('webgl', { alpha: false, antialias: false }) ||
      canvasElement.getContext('experimental-webgl', {
        alpha: false,
        antialias: false
      })
    if (!gl) throw new Error('WebGL not available')

    this.gl = gl
    this.isWebGL2 = !!gl2

    // precision check for fragment shader
    const spf = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)
    this.hasHighp = !!spf && spf.precision > 0

    // float/half-float texture support
    this.supportsFloat32Tex =
      this.isWebGL2 || !!gl.getExtension('OES_texture_float')
    this.supportsFloatLinear =
      this.isWebGL2 || !!gl.getExtension('OES_texture_float_linear')
    this.supportsHalfFloatTex =
      this.isWebGL2 || !!gl.getExtension('OES_texture_half_float')
    this.supportsHalfFloatLinear =
      this.isWebGL2 || !!gl.getExtension('OES_texture_half_float_linear')

    // create regl on our context (ask for extensions explicitly in webgl1)
    const extList = this.isWebGL2
      ? []
      : [
          'OES_texture_float',
          'OES_texture_float_linear',
          'OES_texture_half_float',
          'OES_texture_half_float_linear',
          'OES_standard_derivatives'
        ]
    this.regl = window.createREGL({ gl, extensions: extList })

    // choose texture type: float32 > half-float > uint8
    this.textureType = this.supportsFloat32Tex
      ? 'float'
      : ENABLE_HALF_FLOAT && this.supportsHalfFloatTex
        ? 'half float'
        : 'uint8'
    // mode: true => uint8 fallback (with global scale); false => float/half-float textures
    this.uint8Mode = this.textureType === 'uint8'

    // Current sim texture allocation
    this.texW = 0
    this.texH = 0

    // gpu resources
    this.psiTexture = null
    this.potentialTexture = null // only used when two-texture path is enabled

    // cpu staging buffers (allocated on first draw)
    this.psiF32 = null // float/half-float path buffer (rgba)
    this.potF32 = null // only for two-texture path
    this.psiU8 = null // uint8 path buffer (rgba)
    this.potU8 = null // only for two-texture path

    // last computed global scale (uint8 mode only)
    this.currentScale = 1.0

    // perceptual colormap LUT texture
    // always create the LUT (its 256×1 RGBA8 = 1 KB) so the sampler is valid even if unused
    const lutSize = 256
    const lutData = new Uint8Array(lutSize * 4)
    // balanced cyclic map (approx perceptual): phase-shifted sines
    for (let i = 0; i < lutSize; i++) {
      const t = i / (lutSize - 1);
      const r = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + 0.00));
      const g = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + 0.33));
      const b = 0.5 + 0.5 * Math.sin(2 * Math.PI * (t + 0.6));
      lutData[i*4+0] = Math.round(r * 255);
      lutData[i*4+1] = Math.round(g * 255);
      lutData[i*4+2] = Math.round(b * 255);
      lutData[i*4+3] = 255;
    }
    this.perceptualColormapLUT = this.regl.texture({
      width: lutSize,
      height: 1,
      format: 'rgba',
      type: 'uint8',
      data: lutData
    })

    // path/flag configuration
    this.twoTextures = RENDERER_TWO_TEXTURES
    this.uint8ScaleEveryN = Math.max(1, UINT8_SCALE_EVERY_N | 0)
    this.scaleSmoothAlpha = Math.min(
      0.99,
      Math.max(0.0, UINT8_SCALE_SMOOTH_ALPHA)
    )
    this.frameCounter = 0
    this.lastPotentialVersion = -1
    this.lastBarrierEnergy = NaN
    this.needPotInit = true // force first-time pack of potential channel
    this.bytesPerPixel =
      this.textureType === 'float'
        ? 16
        : this.textureType === 'half float'
          ? 8
          : 4

    // instrumentation accumulators (debug only)
    this.debugStats = {
      lastSummaryTime:
        typeof performance !== 'undefined' ? performance.now() : 0,
      frames: 0,
      packMs: 0,
      uploadMs: 0,
      drawMs: 0,
      bytesUploaded: 0
    }

    // build draw command
    this.drawCommand = this._makeDrawCommand()

    if (DEBUG) {
      console.log(
        `[Renderer] WebGL${this.isWebGL2 ? '2' : '1'} | highp=${this.hasHighp} | type=${this.textureType} | float32=${this.supportsFloat32Tex} | half=${this.supportsHalfFloatTex} | linear(float=${this.supportsFloatLinear}, half=${this.supportsHalfFloatLinear}) | mode=${this.uint8Mode ? 'UINT8+scale' : this.textureType === 'half float' ? 'HALF' : 'FLOAT'} | twoTex=${this.twoTextures}`
      )
    }
  }

  // create / update textures and staging buffers for a given grid size
  _ensureTextures (simW, simH) {
    if (
      this.texW === simW &&
      this.texH === simH &&
      this.psiTexture &&
      (this.twoTextures ? this.potentialTexture : true)
    ) {
      return
    }

    this.texW = simW
    this.texH = simH

    // release old textures if any
    if (this.psiTexture) this.psiTexture.destroy()
    if (this.potentialTexture) this.potentialTexture.destroy()

    const filtering =
      this.textureType === 'float'
        ? this.supportsFloatLinear
          ? 'linear'
          : 'nearest'
        : this.textureType === 'half float'
          ? this.supportsHalfFloatLinear || this.isWebGL2
            ? 'linear'
            : 'nearest'
          : 'linear'

    if (this.uint8Mode) {
      // ----- uint8 texture (normalized upload) -----
      this.psiTexture = this.regl.texture({
        width: simW,
        height: simH,
        format: 'rgba',
        type: 'uint8',
        mag: 'linear',
        min: 'linear',
        wrapS: 'clamp',
        wrapT: 'clamp',
        data: null
      })
      if (this.twoTextures) {
        this.potentialTexture = this.regl.texture({
          width: simW,
          height: simH,
          format: 'rgba',
          type: 'uint8',
          mag: 'linear',
          min: 'linear',
          wrapS: 'clamp',
          wrapT: 'clamp',
          data: null
        })
      } else {
        this.potentialTexture = null
      }

      this.psiU8 = new Uint8Array(simW * simH * 4)
      this.potU8 = this.twoTextures ? new Uint8Array(simW * simH * 4) : null
      this.psiF32 = null
      this.potF32 = null
    } else {
      // ----- float or half-float texture -----
      this.psiTexture = this.regl.texture({
        width: simW,
        height: simH,
        format: 'rgba',
        type: this.textureType, // 'float' or 'half float'
        mag: filtering,
        min: filtering,
        wrapS: 'clamp',
        wrapT: 'clamp',
        data: null
      })
      if (this.twoTextures) {
        this.potentialTexture = this.regl.texture({
          width: simW,
          height: simH,
          format: 'rgba',
          type: this.textureType,
          mag: filtering,
          min: filtering,
          wrapS: 'clamp',
          wrapT: 'clamp',
          data: null
        })
      } else {
        this.potentialTexture = null
      }

      this.psiF32 = new Float32Array(simW * simH * 4)
      this.potF32 = this.twoTextures ? new Float32Array(simW * simH * 4) : null
      this.psiU8 = null
      this.potU8 = null
    }

    this.needPotInit = true // force packing B on first frame after realloc

    if (DEBUG) {
      console.log(
        `[Renderer] Allocated textures ${simW}×${simH} (type: ${this.textureType}${this.twoTextures ? ', two-textures' : ', single-texture'})`
      )
    }
  }

  _makeDrawCommand () {
    const precision = this.hasHighp ? 'highp' : 'mediump'

    const vert = `
      precision ${precision} float;
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        vUv = 0.5 * position + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `

    // domain-coloring: hue = phase, brightness ~ sqrt(|ψ|)
    // uint8 fallback reconstructs ψ via uniform u_scale (global).
    const frag = this.twoTextures
      ? `
      precision ${precision} float;
      precision mediump int;
      #ifdef GL_ES
      #ifdef GL_OES_standard_derivatives
      #extension GL_OES_standard_derivatives : enable
      #endif
      #endif
      varying vec2 vUv;

      uniform sampler2D psiTexture;
      uniform sampler2D potentialTexture;
      uniform sampler2D u_perceptualColormap; // perceptual colormap LUT
      uniform float u_usePerceptualColormap;  // 1.0 => use perceptual colormap, 0.0 => HSV

      uniform float u_brightness;
      uniform float u_magCutoff;
      uniform float u_scale;     // uint8 mode only (global amplitude scale)
      uniform float u_uint8Mode; // 1.0 => uint8+scale, 0.0 => float/half
      uniform float u_potentialOpacity; // potential overlay opacity (0.0 to 1.0)

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;
      
      // returns 0..15 mapped to 4x4 Bayer pattern, normalised to [0,1]
      float bayer4(vec2 p){
        vec2 a = mod(p, 2.0);
        vec2 b = mod(floor(p * 0.5), 2.0);
        // (a.x + a.y*2 + b.x*4 + b.y*8) / 16
        return (a.x + a.y * 2.0 + b.x * 4.0 + b.y * 8.0) / 16.0;
      }

      vec3 hsv2rgb(vec3 c) {
        vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return c.z * mix(vec3(1.0), rgb, c.y);
      }

      void main() {
        vec4 t = texture2D(psiTexture, vUv);
        vec2 psi = (u_uint8Mode > 0.5) ? (t.rg * 2.0 - 1.0) * max(u_scale, 1e-12) : t.rg;

        float mag = length(psi);
        if (mag < u_magCutoff) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }

        float phase = atan(psi.y, psi.x);
        float hue   = fract((phase + PI) / TAU);
        float amp   = sqrt(mag) * u_brightness;
        
        // use perceptual colormap if enabled, otherwise use HSV
        vec3 base;
        if (u_usePerceptualColormap > 0.5) {
          vec3 lutColor = texture2D(u_perceptualColormap, vec2(hue, 0.5)).rgb;
          base = lutColor * amp;
        } else {
          base = hsv2rgb(vec3(hue, 1.0, 1.0)) * amp;
        }

        // contour anti-aliasing with fwidth
        float stripes = ((phase + PI) / TAU) * 24.0;         // 24 lines per 2π (tune)
        float df = fwidth(stripes);                           // needs OES_standard_derivatives on WebGL1
        float band = abs(fract(stripes) - 0.5);
        float contour = smoothstep(0.48 - df, 0.48 + df, band); // thin, AA lines
        base = mix(base, base * 0.7, 0.25 * contour * clamp(amp, 0.0, 1.0));

        float pot = texture2D(potentialTexture, vUv).r;
        // convert normalised potential to signed value (-1 to 1)
        float signedPot = (pot - 0.5) * 2.0;
        // create blue↔red color map
        vec3 barrier = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), smoothstep(-1.0, 1.0, signedPot));
        // apply potential overlay with adjustable opacity
        float potAlpha = u_potentialOpacity * pot * pot;
        vec3 color = mix(base, barrier, potAlpha);
        
        // apply dithering in uint8 mode
        if (u_uint8Mode > 0.5) {
          float dither = bayer4(gl_FragCoord.xy);
          color = color + (dither - 0.5) / 256.0;
        }
        
        // apply gamma correction
        color = pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `
      : `
      precision ${precision} float;
      precision mediump int;
      #ifdef GL_ES
      #ifdef GL_OES_standard_derivatives
      #extension GL_OES_standard_derivatives : enable
      #endif
      #endif
      varying vec2 vUv;

      uniform sampler2D psiTexture;
      uniform sampler2D u_perceptualColormap; // perceptual colormap LUT
      uniform float u_usePerceptualColormap;  // 1.0 => use perceptual colormap, 0.0 => HSV

      uniform float u_brightness;
      uniform float u_magCutoff;
      uniform float u_scale;     // uint8 mode only (global amplitude scale)
      uniform float u_uint8Mode; // 1.0 => uint8+scale, 0.0 => float/half
      uniform float u_potentialOpacity; // potential overlay opacity (0.0 to 1.0)

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;
      
      // returns 0..15 mapped to 4x4 Bayer pattern, normalised to [0,1]
      float bayer4(vec2 p){
        vec2 a = mod(p, 2.0);
        vec2 b = mod(floor(p * 0.5), 2.0);
        // (a.x + a.y*2 + b.x*4 + b.y*8) / 16
        return (a.x + a.y * 2.0 + b.x * 4.0 + b.y * 8.0) / 16.0;
      }

      vec3 hsv2rgb(vec3 c) {
        vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return c.z * mix(vec3(1.0), rgb, c.y);
      }

      void main() {
        vec4 t = texture2D(psiTexture, vUv);
        vec2 psi = (u_uint8Mode > 0.5) ? (t.rg * 2.0 - 1.0) * max(u_scale, 1e-12) : t.rg;

        float mag = length(psi);
        if (mag < u_magCutoff) { gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }

        float phase = atan(psi.y, psi.x);
        float hue   = fract((phase + PI) / TAU);
        float amp   = sqrt(mag) * u_brightness;
        
        // use perceptual colormap if enabled, otherwise use HSV
        vec3 base;
        if (u_usePerceptualColormap > 0.5) {
          vec3 lutColor = texture2D(u_perceptualColormap, vec2(hue, 0.5)).rgb;
          base = lutColor * amp;
        } else {
          base = hsv2rgb(vec3(hue, 1.0, 1.0)) * amp;
        }

        // contour anti-aliasing with fwidth
        float stripes = ((phase + PI) / TAU) * 24.0;         // 24 lines per 2π (tune)
        float df = fwidth(stripes);                           // needs OES_standard_derivatives on WebGL1
        float band = abs(fract(stripes) - 0.5);
        float contour = smoothstep(0.48 - df, 0.48 + df, band); // thin, AA lines
        base = mix(base, base * 0.7, 0.25 * contour * clamp(amp, 0.0, 1.0));

        // potential overlay from B channel (normalised 0..1 in t.b)
        float pot = t.b;
        // convert normalised potential to signed value (-1 to 1)
        float signedPot = (pot - 0.5) * 2.0;
        // create blue↔red color map
        vec3 barrier = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), smoothstep(-1.0, 1.0, signedPot));
        // apply potential overlay with adjustable opacity
        float potAlpha = u_potentialOpacity * pot * pot;
        vec3 color = mix(base, barrier, potAlpha);
        
        // apply dithering in uint8 mode
        if (u_uint8Mode > 0.5) {
          float dither = bayer4(gl_FragCoord.xy);
          color = color + (dither - 0.5) / 256.0;
        }
        
        // apply gamma correction
        color = pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `

    const uniforms = {
      psiTexture: this.regl.prop('psi'),
      u_brightness: this.regl.prop('brightness'),
      u_magCutoff: this.regl.prop('magCutoff'),
      u_scale: this.regl.prop('uScale'),
      u_uint8Mode: this.regl.prop('uint8Mode'),
      u_perceptualColormap: this.perceptualColormapLUT,
      u_usePerceptualColormap: this.regl.prop('usePerceptual'),
      u_potentialOpacity: this.regl.prop('potentialOpacity')
    }
    if (this.twoTextures) {
      uniforms.potentialTexture = this.regl.prop('pot')
    }

    return this.regl({
      vert,
      frag,
      attributes: {
        position: [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [-1, 1],
          [1, -1],
          [1, 1]
        ]
      },
      uniforms,
      count: 6
    })
  }

  /**
   * normalise potential value to [0,1] range for GPU texture upload
   * @param {number} potentialValue - raw potential energy value
   * @param {number} invMax - inverse of maximum potential energy (1/barrierEnergy)
   * @returns {number} normalised value in [0,1] range
   * @private
   */
  _normalizePotential (potentialValue, invMax) {
    return Math.max(0, Math.min(1, potentialValue * invMax))
  }

  /**
   * convert HSV to RGB
   * @param {number} h - hue in degrees (0-360)
   * @param {number} s - saturation (0-1)
   * @param {number} v - value (0-1)
   * @returns {Array<number>} RGB values in range [0,1]
   * @private
   */
  _hsvToRgb (h, s, v) {
    h = h % 360
    if (h < 0) h += 360
    const c = v * s
    const x = c * (1 - Math.abs((h / 60) % 2 - 1))
    const m = v - c
    let r, g, b
    if (h < 60) {
      r = c; g = x; b = 0
    } else if (h < 120) {
      r = x; g = c; b = 0
    } else if (h < 180) {
      r = 0; g = c; b = x
    } else if (h < 240) {
      r = 0; g = x; b = c
    } else if (h < 300) {
      r = x; g = 0; b = c
    } else {
      r = c; g = 0; b = x
    }
    return [r + m, g + m, b + m]
  }

  /**
   * log rendering performance stats (debug mode only)
   * @param {number} t0 - pack start time
   * @param {number} t1 - pack end / upload start time
   * @param {number} t2 - upload end time
   * @param {number} t3 - draw start time
   * @param {number} t4 - draw end time
   * @param {number} pixelCount - total pixels processed
   * @param {number} uploads - number of texture uploads
   * @param {number} simW - simulation width
   * @param {number} simH - simulation height
   * @private
   */
  _logRenderingPerformance (t0, t1, t2, t3, t4, pixelCount, uploads, simW, simH) {
    if (!DEBUG) return

    const packMs = t1 - t0
    const uploadMs = t2 - t1
    const drawMs = t4 - t3
    const bytes = pixelCount * this.bytesPerPixel * uploads
    
    // per-frame debug
    // eslint-disable-next-line no-console
    console.debug(
      `[Renderer] pack=${packMs.toFixed(2)}ms upload=${uploadMs.toFixed(2)}ms draw=${drawMs.toFixed(2)}ms bytes=${(bytes / 1e6).toFixed(3)}MB uploads=${uploads}`
    )
    
    // accumulate stats
    this.debugStats.frames += 1
    this.debugStats.packMs += packMs
    this.debugStats.uploadMs += uploadMs
    this.debugStats.drawMs += drawMs
    this.debugStats.bytesUploaded += bytes
    
    const now = t4
    if (now - this.debugStats.lastSummaryTime >= 1000) {
      const f = this.debugStats.frames || 1
      const avgPack = this.debugStats.packMs / f
      const avgUpload = this.debugStats.uploadMs / f
      const avgDraw = this.debugStats.drawMs / f
      const avgBytes = this.debugStats.bytesUploaded / f
      
      // eslint-disable-next-line no-console
      console.log(
        `[Renderer Σ1s] N=${f} avg(pack=${avgPack.toFixed(2)}ms, upload=${avgUpload.toFixed(2)}ms, draw=${avgDraw.toFixed(2)}ms) avgBytes=${(avgBytes / 1e6).toFixed(3)}MB type=${this.textureType} twoTex=${this.twoTextures} grid=${simW}x${simH}`
      )
      
      this.debugStats.lastSummaryTime = now
      this.debugStats.frames =
        this.debugStats.packMs =
        this.debugStats.uploadMs =
        this.debugStats.drawMs =
        this.debugStats.bytesUploaded =
          0
    }
  }

  /**
   * render the current quantum state
   * @param {SimulationState} state
   */
  draw (state) {
    const simW = state.gridSize.width
    const simH = state.gridSize.height
    this._ensureTextures(simW, simH)

    // potential normalisation base (kept same as before)
    const barrierEnergy =
      state.params.barrierEnergy > 0 ? state.params.barrierEnergy : 300.0
    const invMax = barrierEnergy > 0 ? 1.0 / barrierEnergy : 0.0
    const pixelCount = simW * simH

    // determine if we must repack potential (b channel or separate texture)
    const potDirty =
      this.needPotInit ||
      state.potentialVersion !== this.lastPotentialVersion ||
      this.lastBarrierEnergy !== barrierEnergy

    // instrumentation timers
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0

    if (this.uint8Mode) {
      // uint8 path: pack ψ into rg using global scale; optionally repack potential
      const psi = state.psi
      const out = this.psiU8
      const V = state.potential

      // periodic scan of s
      let scannedThisFrame = false
      if (this.frameCounter % this.uint8ScaleEveryN === 0) {
        let S = 0.0
        for (let i = 0; i < psi.length; i += 2) {
          const ar = Math.abs(psi[i])
          const ai = Math.abs(psi[i + 1])
          if (ar > S) S = ar
          if (ai > S) S = ai
        }
        if (!Number.isFinite(S) || S < 1e-12) S = 1.0
        const smoothed =
          this.scaleSmoothAlpha * this.currentScale +
          (1.0 - this.scaleSmoothAlpha) * S
        this.currentScale = Math.max(smoothed, S) // never below S to avoid clipping
        scannedThisFrame = true
      }

      // pack pass with clip detection; optionally write B if potDirty
      let o = 0
      let t = 0
      let p = 0
      let clipped = false
      const Suse = this.currentScale
      for (let px = 0; px < pixelCount; px++, t += 2, o += 4, p += 1) {
        const r = psi[t] / Suse
        const im = psi[t + 1] / Suse
        if (r > 1.0 || r < -1.0 || im > 1.0 || im < -1.0) clipped = true
        const r01 = Math.max(0, Math.min(1, r * 0.5 + 0.5))
        const i01 = Math.max(0, Math.min(1, im * 0.5 + 0.5))
        out[o] = (r01 * 255) | 0 // R
        out[o + 1] = (i01 * 255) | 0 // G
        if (this.twoTextures) {
          // leave B unused; A=255
        } else if (potDirty) {
          const v01 = this._normalizePotential(V[p], invMax)
          out[o + 2] = (v01 * 255) | 0 // B = normalised potential
        }
        out[o + 3] = 255 // A
      }

      if (clipped && !scannedThisFrame) {
        // immediate rescan to avoid clipping this frame
        let S = 0.0
        for (let i = 0; i < psi.length; i += 2) {
          const ar = Math.abs(psi[i])
          const ai = Math.abs(psi[i + 1])
          if (ar > S) S = ar
          if (ai > S) S = ai
        }
        if (!Number.isFinite(S) || S < 1e-12) S = 1.0
        const smoothed =
          this.scaleSmoothAlpha * this.currentScale +
          (1.0 - this.scaleSmoothAlpha) * S
        this.currentScale = Math.max(smoothed, S)

        // repack with new scale
        o = 0
        t = 0
        p = 0
        const Suse2 = this.currentScale
        for (let px = 0; px < pixelCount; px++, t += 2, o += 4, p += 1) {
          const r = psi[t] / Suse2
          const im = psi[t + 1] / Suse2
          const r01 = Math.max(0, Math.min(1, r * 0.5 + 0.5))
          const i01 = Math.max(0, Math.min(1, im * 0.5 + 0.5))
          out[o] = (r01 * 255) | 0
          out[o + 1] = (i01 * 255) | 0
          if (!this.twoTextures && potDirty) {
            const v01 = this._normalizePotential(V[p], invMax)
            out[o + 2] = (v01 * 255) | 0
          }
          out[o + 3] = 255
        }
      }

      const t1 = typeof performance !== 'undefined' ? performance.now() : 0
      this.psiTexture.subimage({ data: out, width: simW, height: simH })
      let uploads = 1

      if (this.twoTextures) {
        // old path: pack potential separately (always, to mirror old behavior)
        const pout = this.potU8
        let qo = 0
        for (let i = 0; i < state.potential.length; i++) {
          const v01 = this._normalizePotential(state.potential[i], invMax)
          const b = (v01 * 255) | 0
          pout[qo++] = b // R
          pout[qo++] = 0 // G
          pout[qo++] = 0 // B
          pout[qo++] = 255 // A
        }
        this.potentialTexture.subimage({
          data: pout,
          width: simW,
          height: simH
        })
        uploads = 2
      }

      const t2 = typeof performance !== 'undefined' ? performance.now() : 0

      // clear + draw
      this.regl.clear({ color: [0, 0, 0, 1], depth: 1 })
      const t3 = typeof performance !== 'undefined' ? performance.now() : 0
      this.drawCommand({
        psi: this.psiTexture,
        pot: this.twoTextures ? this.potentialTexture : undefined,
        brightness: state.params.brightness,
        magCutoff:
          Number.isFinite(state.visual?.magCutoff) &&
          state.visual.magCutoff >= 0
            ? state.visual.magCutoff
            : 0.0,
        uScale: this.currentScale,
        uint8Mode: 1,
        usePerceptual: ENABLE_PERCEPTUAL_COLORMAP ? 1 : 0,
        potentialOpacity:
          Number.isFinite(state.visual?.potentialOpacity) &&
          state.visual.potentialOpacity >= 0
            ? state.visual.potentialOpacity
            : 0.6
      })
      const t4 = typeof performance !== 'undefined' ? performance.now() : 0

      // update versions and stats
      if (!this.twoTextures && potDirty) {
        this.lastPotentialVersion = state.potentialVersion
        this.lastBarrierEnergy = barrierEnergy
        this.needPotInit = false
      }
      this.frameCounter++
      this._logRenderingPerformance(t0, t1, t2, t3, t4, pixelCount, uploads, simW, simH)
    } else {
      // float/half path: store ψ directly in rg; potential normalized in b (single texture) or separate texture
      const psi = state.psi
      const out = this.psiF32
      const V = state.potential

      let o = 0
      let t = 0
      let p = 0
      if (this.twoTextures) {
        // single pass for ψ only; potential packed separately below
        for (let px = 0; px < pixelCount; px++, t += 2, o += 4) {
          out[o] = psi[t] // R = re
          out[o + 1] = psi[t + 1] // G = im
          // leave B unchanged
          out[o + 3] = 1.0 // A
        }
      } else {
        // single pass: pack ψ and, if needed, potential into B
        for (let px = 0; px < pixelCount; px++, t += 2, p += 1, o += 4) {
          out[o] = psi[t]
          out[o + 1] = psi[t + 1]
          if (potDirty) {
            const v01 = this._normalizePotential(V[p], invMax)
            out[o + 2] = v01 // B = normalised potential
          }
          out[o + 3] = 1.0
        }
      }

      const t1 = typeof performance !== 'undefined' ? performance.now() : 0
      this.psiTexture.subimage({ data: out, width: simW, height: simH })
      let uploads = 1
      if (this.twoTextures) {
        const pout = this.potF32
        let qo = 0
        for (let i = 0; i < state.potential.length; i++) {
          pout[qo++] = this._normalizePotential(state.potential[i], invMax)
          pout[qo++] = 0.0
          pout[qo++] = 0.0
          pout[qo++] = 1.0
        }
        this.potentialTexture.subimage({
          data: pout,
          width: simW,
          height: simH
        })
        uploads = 2
      }
      const t2 = typeof performance !== 'undefined' ? performance.now() : 0

      // clear + draw
      this.regl.clear({ color: [0, 0, 0, 1], depth: 1 })
      const t3 = typeof performance !== 'undefined' ? performance.now() : 0
      this.drawCommand({
        psi: this.psiTexture,
        pot: this.twoTextures ? this.potentialTexture : undefined,
        brightness: state.params.brightness,
        magCutoff:
          Number.isFinite(state.visual?.magCutoff) &&
          state.visual.magCutoff >= 0
            ? state.visual.magCutoff
            : 0.0,
        uScale: 1.0,
        uint8Mode: 0,
        usePerceptual: ENABLE_PERCEPTUAL_COLORMAP ? 1 : 0,
        potentialOpacity:
          Number.isFinite(state.visual?.potentialOpacity) &&
          state.visual.potentialOpacity >= 0
            ? state.visual.potentialOpacity
            : 0.6
      })
      const t4 = typeof performance !== 'undefined' ? performance.now() : 0

      if (!this.twoTextures && potDirty) {
        this.lastPotentialVersion = state.potentialVersion
        this.lastBarrierEnergy = barrierEnergy
        this.needPotInit = false
      }
      this.frameCounter++
      this._logRenderingPerformance(t0, t1, t2, t3, t4, pixelCount, uploads, simW, simH)
    }
  }
}
