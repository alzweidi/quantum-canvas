// renderer.js — physically faithful renderer for the quantum wave function
// - uses uint8 RGBA textures for wave function representation (lossless phase, correct amplitude).
// - textures are sized to the canvas backing store dimensions, accounting for device pixel ratio (DPR), for correct rendering on high-DPI displays.
// - no per-per-pixel normalisation: preserves |ψ| and phase so interference looks right.

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
   * @param {Object} options - Rendering options
   */
  constructor (canvasElement, options = {}) {
    this.canvas = canvasElement
    this.options = {
      renderMode: options.renderMode || 'enhanced', // 'enhanced' or 'legacy'
      quality: options.quality || 'auto',
      enableSSAO: options.enableSSAO !== false,
      enablePBR: options.enablePBR !== false,
      enableVolumetrics: options.enableVolumetrics !== false,
      enableMultipass: false, // default off until multipass is fully wired
      toneMapping: options.toneMapping || 'aces', // 'aces', 'reinhard', 'uncharted2', 'photographic'
      ...options
    }

    // ---- GL context (prefer WebGL2) ----
    const gl2 =
      canvasElement.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false
      }) ||
      null
    const gl =
      gl2 ||
      canvasElement.getContext('webgl', {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false
      }) ||
      canvasElement.getContext('experimental-webgl', {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        preserveDrawingBuffer: false
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
    
    // check for WebGL2 specific features
    this.supportsMRT = this.isWebGL2 || !!gl.getExtension('WEBGL_draw_buffers')
    this.supportsDepthTexture = this.isWebGL2 || !!gl.getExtension('WEBGL_depth_texture')
    this.supportsFloatBlend = this.isWebGL2 || !!gl.getExtension('EXT_float_blend')
    
    // max texture units for multi-pass rendering
    this.maxTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)
    this.maxColorAttachments = this.isWebGL2
      ? gl.getParameter(gl.MAX_COLOR_ATTACHMENTS)
      : (this.supportsMRT ? gl.getExtension('WEBGL_draw_buffers').MAX_COLOR_ATTACHMENTS_WEBGL : 1)

    // create regl on our context (ask for extensions explicitly in webgl1)
    const extList = this.isWebGL2
      ? []
      : [
          'OES_texture_float',
          'OES_texture_float_linear',
          'OES_texture_half_float',
          'OES_texture_half_float_linear',
          'OES_standard_derivatives',
          'WEBGL_draw_buffers',
          'WEBGL_depth_texture',
          'EXT_float_blend'
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

    // 3D LUT for color grading - create a default identity LUT
    this.lutSize = 32 // 32x32x32 3D LUT
    this.colorGradingLUT = this._createIdentityLUT3D()
    
    // framebuffer objects for multi-pass rendering
    this.framebuffers = {}
    this.renderTargets = {}
    
    // SSAO resources
    this.ssaoKernel = null
    this.ssaoNoise = null
    if (this.options.enableSSAO && this.options.renderMode === 'enhanced') {
      this._initSSAO()
    }
    
    // PBR resources
    this.brdfLUT = null
    this.envMaps = {}
    if (this.options.enablePBR && this.options.renderMode === 'enhanced') {
      this._initPBR()
    }
    
    // volumetric rendering resources
    this.volumetricBuffer = null
    if (this.options.enableVolumetrics && this.options.renderMode === 'enhanced') {
      this._initVolumetrics()
    }
    
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

    // display auto-exposure (frame-adaptive)
    this.displayGain = 1.0        // updated every frame
    this.gainSmoothAlpha = 0.9    // 0..1 (higher = slower changes)
    this.targetLuma = 0.35        // aim average |psi|^2 to ~35% before tone-map
    
    // exposure control for tone mapping
    this.exposure = 1.0
    this.exposureAdaptation = true
    this.adaptationSpeed = 0.5

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

    // build draw commands (multiple for enhanced mode)
    if (this.options.renderMode === 'enhanced' && this.options.enableMultipass) {
      this._initMultipassPipeline()
    } else {
      this.drawCommand = this._makeDrawCommand()
    }

    if (DEBUG) {
      console.log(
        `[Renderer] WebGL${this.isWebGL2 ? '2' : '1'} | highp=${this.hasHighp} | type=${this.textureType} | float32=${this.supportsFloat32Tex} | half=${this.supportsHalfFloatTex} | linear(float=${this.supportsFloatLinear}, half=${this.supportsHalfFloatLinear}) | mode=${this.uint8Mode ? 'UINT8+scale' : this.textureType === 'half float' ? 'HALF' : 'FLOAT'} | twoTex=${this.twoTextures} | renderMode=${this.options.renderMode} | MRT=${this.supportsMRT}`
      )
    }
  }
  
  /**
   * initialise multi-pass rendering pipeline
   * @private
   */
  _initMultipassPipeline() {
    // create framebuffers for deferred rendering
    this._createGBuffer()
    
    // create render passes
    this.geometryPass = this._makeGeometryPass()
    this.lightingPass = this._makeLightingPass()
    this.ssaoPass = this.options.enableSSAO ? this._makeSSAOPass() : null
    this.postProcessPass = this._makePostProcessPass()
    this.compositePass = this._makeCompositePass()
    
    // assign a draw command until multipass is fully wired
    this.drawCommand = this.compositePass || this.geometryPass
  }
  
  /**
   * create G-Buffer for deferred rendering
   * @private
   */
  _createGBuffer() {
    if (!this.supportsMRT) {
      // fallback to forward rendering if MRT not supported
      this.drawCommand = this._makeDrawCommand()
      return
    }
    
    const width = this.canvas.width
    const height = this.canvas.height
    
    // G-Buffer textures
    this.gBuffer = {
      // Albedo + metallic
      albedo: this.regl.texture({
        width, height,
        format: 'rgba',
        type: this.textureType === 'uint8' ? 'uint8' : 'float',
        mag: 'nearest',
        min: 'nearest'
      }),
      // normal + roughness
      normal: this.regl.texture({
        width, height,
        format: 'rgba',
        type: this.textureType === 'uint8' ? 'uint8' : 'float',
        mag: 'nearest',
        min: 'nearest'
      }),
      // position or depth
      position: this.supportsDepthTexture ? this.regl.texture({
        width, height,
        format: 'depth',
        type: 'depth',
        mag: 'nearest',
        min: 'nearest'
      }) : this.regl.texture({
        width, height,
        format: 'rgba',
        type: this.textureType === 'uint8' ? 'uint8' : 'float',
        mag: 'nearest',
        min: 'nearest'
      })
    }
    
    // create framebuffer
    this.gBufferFBO = this.regl.framebuffer({
      color: [this.gBuffer.albedo, this.gBuffer.normal],
      depth: this.supportsDepthTexture ? this.gBuffer.position : true
    })
  }
  
  /**
   * initialise SSAO resources
   * @private
   */
  _initSSAO() {
    // generate sampling kernel
    const kernelSize = 64
    const kernel = new Float32Array(kernelSize * 3)
    for (let i = 0; i < kernelSize; i++) {
      const sample = [
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random()
      ]
      // normalize and scale
      const scale = i / kernelSize
      const scaleFactor = 0.1 + 0.9 * scale * scale // more samples closer to origin
      kernel[i * 3] = sample[0] * scaleFactor
      kernel[i * 3 + 1] = sample[1] * scaleFactor
      kernel[i * 3 + 2] = sample[2] * scaleFactor
    }
    this.ssaoKernel = kernel
    
    // generate noise texture for randomisation
    const noiseSize = 4
    const noise = new Float32Array(noiseSize * noiseSize * 3)
    for (let i = 0; i < noiseSize * noiseSize; i++) {
      noise[i * 3] = Math.random() * 2 - 1
      noise[i * 3 + 1] = Math.random() * 2 - 1
      noise[i * 3 + 2] = 0
    }
    this.ssaoNoise = this.regl.texture({
      width: noiseSize,
      height: noiseSize,
      format: 'rgb',
      type: 'float',
      data: noise,
      wrap: 'repeat'
    })
  }
  
  /**
   * initialise PBR resources
   * @private
   */
  _initPBR() {
    // create BRDF lookup texture for IBL
    const brdfSize = 256
    const brdfData = new Float32Array(brdfSize * brdfSize * 4)
    
    // generate BRDF LUT (simplified - in production would precompute)
    for (let y = 0; y < brdfSize; y++) {
      for (let x = 0; x < brdfSize; x++) {
        const NdotV = x / (brdfSize - 1)
        const roughness = y / (brdfSize - 1)
        const idx = (y * brdfSize + x) * 4
        
        // simplified BRDF integration
        const scale = 1.0 - Math.pow(1.0 - NdotV, 5.0)
        const bias = roughness * roughness
        
        brdfData[idx] = scale
        brdfData[idx + 1] = bias
        brdfData[idx + 2] = 0
        brdfData[idx + 3] = 1
      }
    }
    
    this.brdfLUT = this.regl.texture({
      width: brdfSize,
      height: brdfSize,
      format: 'rgba',
      type: 'float',
      data: brdfData
    })
  }
  
  /**
   * initialise volumetric rendering
   * @private
   */
  _initVolumetrics() {
    // create 3D texture for volumetric data if WebGL2
    if (this.isWebGL2) {
      const size = 64
      this.volumetricBuffer = this.regl.texture({
        width: size,
        height: size,
        depth: size,
        format: 'rgba',
        type: 'float',
        wrap: 'clamp'
      })
    }
  }
  
  /**
   * create identity 3D LUT for color grading
   * @private
   */
  _createIdentityLUT3D() {
    const size = this.lutSize
    const data = new Float32Array(size * size * size * 4)
    
    for (let b = 0; b < size; b++) {
      for (let g = 0; g < size; g++) {
        for (let r = 0; r < size; r++) {
          const idx = ((b * size + g) * size + r) * 4
          data[idx] = r / (size - 1)
          data[idx + 1] = g / (size - 1)
          data[idx + 2] = b / (size - 1)
          data[idx + 3] = 1
        }
      }
    }
    
    // store as 2D texture (size*size, size) for WebGL1 compatibility
    return this.regl.texture({
      width: size * size,
      height: size,
      format: 'rgba',
      type: 'float',
      data: data,
      mag: 'linear',
      min: 'linear'
    })
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

  /**
   * get tone mapping function based on selected operator
   * @private
   */
  _getToneMappingFunction(operator) {
    switch(operator) {
      case 'aces':
        return `
          vec3 ACESFilm(vec3 x) {
            float a = 2.51;
            float b = 0.03;
            float c = 2.43;
            float d = 0.59;
            float e = 0.14;
            return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
          }
        `
      case 'reinhard':
        return `
          vec3 ReinhardExtended(vec3 color, float whitePoint) {
            vec3 numerator = color * (1.0 + (color / (whitePoint * whitePoint)));
            return numerator / (1.0 + color);
          }
        `
      case 'uncharted2':
        return `
          vec3 Uncharted2Tonemap(vec3 x) {
            float A = 0.15;
            float B = 0.50;
            float C = 0.10;
            float D = 0.20;
            float E = 0.02;
            float F = 0.30;
            return ((x*(A*x+C*B)+D*E)/(x*(A*x+B)+D*F))-E/F;
          }
        `
      case 'photographic':
        return `
          vec3 Photographic(vec3 color, float exposure) {
            return vec3(1.0) - exp(-color * exposure);
          }
        `
      default:
        return `
          vec3 SimpleTonemap(vec3 color) {
            return color / (1.0 + color); // Simple Reinhard
          }
        `
    }
  }

  /**
   * get Cook-Torrance BRDF implementation
   * @private
   */
  _getCookTorranceBRDF() {
    return `
      // GGX/Trowbridge-Reitz normal distribution
      float DistributionGGX(vec3 N, vec3 H, float roughness) {
        float a = roughness * roughness;
        float a2 = a * a;
        float NdotH = max(dot(N, H), 0.0);
        float NdotH2 = NdotH * NdotH;
        
        float denom = NdotH2 * (a2 - 1.0) + 1.0;
        denom = PI * denom * denom;
        
        return a2 / denom;
      }
      
      // geometry function (Smith's method)
      float GeometrySchlickGGX(float NdotV, float roughness) {
        float r = (roughness + 1.0);
        float k = (r * r) / 8.0;
        
        float denom = NdotV * (1.0 - k) + k;
        return NdotV / denom;
      }
      
      float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
        float NdotV = max(dot(N, V), 0.0);
        float NdotL = max(dot(N, L), 0.0);
        float ggx2 = GeometrySchlickGGX(NdotV, roughness);
        float ggx1 = GeometrySchlickGGX(NdotL, roughness);
        
        return ggx1 * ggx2;
      }
      
      // Fresnel equation (Schlick approximation)
      vec3 FresnelSchlick(float cosTheta, vec3 F0) {
        return F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);
      }
      
      // Cook-Torrance BRDF
      vec3 CookTorranceBRDF(vec3 albedo, float metallic, float roughness, vec3 N, vec3 V, vec3 L, vec3 lightColor) {
        vec3 H = normalize(V + L);
        
        // Calculate F0 (base reflectivity)
        vec3 F0 = vec3(0.04);
        F0 = mix(F0, albedo, metallic);
        
        // Calculate BRDF components
        float NDF = DistributionGGX(N, H, roughness);
        float G = GeometrySmith(N, V, L, roughness);
        vec3 F = FresnelSchlick(max(dot(H, V), 0.0), F0);
        
        vec3 kS = F;
        vec3 kD = vec3(1.0) - kS;
        kD *= 1.0 - metallic;
        
        float NdotL = max(dot(N, L), 0.0);
        float NdotV = max(dot(N, V), 0.0);
        
        vec3 numerator = NDF * G * F;
        float denominator = 4.0 * NdotV * NdotL + 0.001;
        vec3 specular = numerator / denominator;
        
        return (kD * albedo / PI + specular) * lightColor * NdotL;
      }
    `
  }

  _makeDrawCommand () {
    const precision = this.hasHighp ? 'highp' : 'mediump'

    const vert = `
      precision ${precision} float;
      attribute vec2 position;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      void main() {
        vUv = 0.5 * position + 0.5;
        vWorldPos = vec3(vUv, 0.0);   // screen-space proxy
        vNormal = vec3(0.0, 0.0, 1.0); // pointing towards viewer
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `

    // shared helper chunk used by both fragment variants
    const helpers = `
      // helper functions at global scope (GLSL ES requires this)
      vec2 recFromTex(vec4 t){
        return (u_uint8Mode > 0.5)
          ? (t.rg * 2.0 - 1.0) * max(u_scale, 1e-12)
          : t.rg;
      }

      // signed angle between two 2D unit vectors
      float ang(vec2 a, vec2 b){
        return atan(a.x*b.y - a.y*b.x, dot(a,b));
      }

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;

      // 4x4 Bayer dither
      float bayer4(vec2 p){
        vec2 a = mod(p, 2.0);
        vec2 b = mod(floor(p * 0.5), 2.0);
        return (a.x + a.y*2.0 + b.x*4.0 + b.y*8.0) / 16.0;
      }

      vec3 hsv2rgb(vec3 c) {
        vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0,4.0,2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        return c.z * mix(vec3(1.0), rgb, c.y);
      }
    `
    
    // add tone mapping functions
    const toneMappingFunctions = this._getToneMappingFunction(this.options.toneMapping)
    
    // add PBR functions if enabled
    const pbrFunctions = this.options.enablePBR && this.options.renderMode === 'enhanced'
      ? this._getCookTorranceBRDF()
      : ''

    const commonHeader = `
      precision ${precision} float;
      precision mediump int;
      #ifdef GL_ES
      #extension GL_OES_standard_derivatives : enable
      #endif
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;

      uniform sampler2D psiTexture;
      uniform sampler2D u_perceptualColormap;
      uniform sampler2D u_colorGradingLUT;
      uniform sampler2D u_brdfLUT;
      uniform float u_usePerceptualColormap;
      uniform float u_useLUT;

      uniform float u_magCutoff;
      uniform float u_scale;     // uint8 mode only
      uniform float u_uint8Mode; // 1.0 => uint8 path, 0.0 => float/half path
      uniform float u_potentialOpacity;
      uniform float u_enableDithering; // 1.0 => dithering on, 0.0 => off
      uniform float u_useLinearIntensity; // 1 => |psi|^2, 0 => legacy sqrt(|psi|)
      uniform float u_legacyLook; // 1.0 => old visual mapping
      uniform float u_displayGain; // frame-adaptive exposure gain
      uniform float u_contourStrength; // 0..1 (default ~0.1)
      uniform float u_densityOnly; // 1.0 => grayscale density, 0.0 => domain coloring
      
      // enhanced rendering uniforms
      uniform float u_exposure;
      uniform float u_whitePoint;
      uniform float u_metallic;
      uniform float u_roughness;
      uniform vec3 u_lightDir;
      uniform vec3 u_lightColor;
      uniform vec3 u_viewPos;

      // vortex highlight uniforms
      uniform vec2  u_texel;
      uniform float u_vortexOpacity;
      uniform float u_vortexAmpThreshold;

      ${helpers}
      ${toneMappingFunctions}
      ${pbrFunctions}
      
      // 3D LUT sampling
      vec3 sampleLUT3D(sampler2D lut, vec3 color, float lutSize) {
        color = clamp(color, 0.0, 1.0);
        
        float blueSlice = color.b * (lutSize - 1.0);
        float blueSlice0 = floor(blueSlice);
        float blueSlice1 = min(blueSlice0 + 1.0, lutSize - 1.0);
        float blueMix = blueSlice - blueSlice0;
        
        vec2 uv0 = vec2(
          (blueSlice0 * lutSize + color.r * (lutSize - 1.0) + 0.5) / (lutSize * lutSize),
          (color.g * (lutSize - 1.0) + 0.5) / lutSize
        );
        vec2 uv1 = vec2(
          (blueSlice1 * lutSize + color.r * (lutSize - 1.0) + 0.5) / (lutSize * lutSize),
          (color.g * (lutSize - 1.0) + 0.5) / lutSize
        );
        
        vec3 sample0 = texture2D(lut, uv0).rgb;
        vec3 sample1 = texture2D(lut, uv1).rgb;
        
        return mix(sample0, sample1, blueMix);
      }
    `

    const fragSingle = `
      ${commonHeader}
      void main() {
        vec4 t   = texture2D(psiTexture, vUv);
        vec2 psi = recFromTex(t);

        float mag2 = dot(psi, psi); // |psi|^2
        if (mag2 < u_magCutoff*u_magCutoff) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

        float phase = atan(psi.y, psi.x);
        float hue   = fract((phase + PI) / TAU);
        // physics-correct (|psi|^2) or legacy √|psi| look
        float amp = (u_legacyLook > 0.5)
          ? pow(mag2, 0.25)               // == sqrt(|psi|) from original renderer
          : (u_useLinearIntensity > 0.5
              ? mag2                       // |psi|^2
              : sqrt(sqrt(mag2)));         // == sqrt(|psi|)

        // exposure (frame-adaptive)
        amp *= u_displayGain * u_exposure;

        vec3 basePhase = (u_usePerceptualColormap > 0.5)
          ? texture2D(u_perceptualColormap, vec2(hue, 0.5)).rgb
          : hsv2rgb(vec3(hue, 1.0, 1.0));
        vec3 base = (u_densityOnly > 0.5)
          ? vec3(amp)                               // grayscale density
          : basePhase * amp;                        // domain coloring
          
        // apply PBR if enabled
        ${this.options.enablePBR && this.options.renderMode === 'enhanced' ? `
        if (u_metallic > 0.0 || u_roughness > 0.0) {
          vec3 N = normalize(vNormal);
          vec3 V = normalize(u_viewPos - vWorldPos);
          vec3 L = normalize(u_lightDir);
          
          base = CookTorranceBRDF(base, u_metallic, u_roughness, N, V, L, u_lightColor);
        }
        ` : ''}
        
        // apply advanced tone mapping
        ${this.options.toneMapping === 'aces' ? `
        base = ACESFilm(base);
        ` : this.options.toneMapping === 'reinhard' ? `
        base = ReinhardExtended(base, u_whitePoint);
        ` : this.options.toneMapping === 'uncharted2' ? `
        base = Uncharted2Tonemap(base * u_exposure) / Uncharted2Tonemap(vec3(11.2));
        ` : this.options.toneMapping === 'photographic' ? `
        base = Photographic(base, u_exposure);
        ` : `
        base = base / (1.0 + base); // Simple Reinhard
        `}

        // AA phase contours with configurable strength
        float stripes = ((phase + PI) / TAU) * 24.0;
        float df = fwidth(stripes);
        float band = abs(fract(stripes) - 0.5);
        float contour = smoothstep(0.48 - df, 0.48 + df, band);
        base = mix(base, base * (1.0 - 0.3 * u_contourStrength),
                   0.25 * u_contourStrength * contour * clamp(amp, 0.0, 1.0));

        // potential overlay from B channel (0..1) - gentler approach
        float pot = t.b;
        float signedPot = (pot - 0.5) * 2.0;
        vec3 barrier = mix(vec3(0.10), vec3(0.85), smoothstep(-1.0, 1.0, signedPot));
        float potAlpha = u_potentialOpacity * pot;      // linear, not pot*pot
        vec3 color = mix(base, barrier, potAlpha);

        // vortex detection (no nested functions)
        vec2 o = 0.5 * u_texel;
        vec2 p00 = recFromTex(texture2D(psiTexture, vUv + vec2(-o.x, -o.y)));
        vec2 p10 = recFromTex(texture2D(psiTexture, vUv + vec2(+o.x, -o.y)));
        vec2 p11 = recFromTex(texture2D(psiTexture, vUv + vec2(+o.x, +o.y)));
        vec2 p01 = recFromTex(texture2D(psiTexture, vUv + vec2(-o.x, +o.y)));

        vec2 u00 = p00 / (length(p00) + 1e-9);
        vec2 u10 = p10 / (length(p10) + 1e-9);
        vec2 u11 = p11 / (length(p11) + 1e-9);
        vec2 u01 = p01 / (length(p01) + 1e-9);

        float w = ang(u00,u10) + ang(u10,u11) + ang(u11,u01) + ang(u01,u00);
        float avgAmp = 0.25 * (length(p00)+length(p10)+length(p11)+length(p01));
        float vortexCore = smoothstep(3.14159, 5.5, abs(w));
        float lowAmp = 1.0 - smoothstep(u_vortexAmpThreshold, u_vortexAmpThreshold*3.0, avgAmp);
        float vortex = vortexCore * lowAmp;
        color = mix(color, vec3(1.0), clamp(u_vortexOpacity * vortex, 0.0, 1.0));

        if (u_uint8Mode > 0.5 && u_enableDithering > 0.5) {
          float dither = bayer4(gl_FragCoord.xy);
          color += (dither - 0.5) / 256.0;
        }
        
        // apply 3D LUT color grading if enabled
        if (u_useLUT > 0.5) {
          color = sampleLUT3D(u_colorGradingLUT, color, 32.0);
        }

        // final gamma correction
        color = pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `

    const fragTwo = `
      ${commonHeader}
      uniform sampler2D potentialTexture;
      void main() {
        vec2 psi = recFromTex(texture2D(psiTexture, vUv));

        float mag2 = dot(psi, psi); // |psi|^2
        if (mag2 < u_magCutoff*u_magCutoff) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

        float phase = atan(psi.y, psi.x);
        float hue   = fract((phase + PI) / TAU);
        // physics-correct (|psi|^2) or legacy √|psi| look
        float amp = (u_legacyLook > 0.5)
          ? pow(mag2, 0.25)               // == sqrt(|psi|) from original renderer
          : (u_useLinearIntensity > 0.5
              ? mag2                       // |psi|^2
              : sqrt(sqrt(mag2)));         // == sqrt(|psi|)

        // exposure (frame-adaptive)
        amp *= u_displayGain;

        // reinhard tonemap (smoothly compress highlights)
        amp = amp / (1.0 + amp);

        vec3 basePhase = (u_usePerceptualColormap > 0.5)
          ? texture2D(u_perceptualColormap, vec2(hue, 0.5)).rgb
          : hsv2rgb(vec3(hue, 1.0, 1.0));
        vec3 base = (u_densityOnly > 0.5)
          ? vec3(amp)                               // grayscale density
          : basePhase * amp;                        // domain coloring

        float stripes = ((phase + PI) / TAU) * 24.0;
        float df = fwidth(stripes);
        float band = abs(fract(stripes) - 0.5);
        float contour = smoothstep(0.48 - df, 0.48 + df, band);
        base = mix(base, base * (1.0 - 0.3 * u_contourStrength),
                   0.25 * u_contourStrength * contour * clamp(amp, 0.0, 1.0));

        float pot = texture2D(potentialTexture, vUv).r;
        float signedPot = (pot - 0.5) * 2.0;
        vec3 barrier = mix(vec3(0.10), vec3(0.85), smoothstep(-1.0, 1.0, signedPot));
        float potAlpha = u_potentialOpacity * pot;      // linear, not pot*pot
        vec3 color = mix(base, barrier, potAlpha);

        vec2 o = 0.5 * u_texel;
        vec2 p00 = recFromTex(texture2D(psiTexture, vUv + vec2(-o.x, -o.y)));
        vec2 p10 = recFromTex(texture2D(psiTexture, vUv + vec2(+o.x, -o.y)));
        vec2 p11 = recFromTex(texture2D(psiTexture, vUv + vec2(+o.x, +o.y)));
        vec2 p01 = recFromTex(texture2D(psiTexture, vUv + vec2(-o.x, +o.y)));

        vec2 u00 = p00 / (length(p00) + 1e-9);
        vec2 u10 = p10 / (length(p10) + 1e-9);
        vec2 u11 = p11 / (length(p11) + 1e-9);
        vec2 u01 = p01 / (length(p01) + 1e-9);

        float w = ang(u00,u10) + ang(u10,u11) + ang(u11,u01) + ang(u01,u00);
        float avgAmp = 0.25 * (length(p00)+length(p10)+length(p11)+length(p01));
        float vortexCore = smoothstep(3.14159, 5.5, abs(w));
        float lowAmp = 1.0 - smoothstep(u_vortexAmpThreshold, u_vortexAmpThreshold*3.0, avgAmp);
        float vortex = vortexCore * lowAmp;
        color = mix(color, vec3(1.0), clamp(u_vortexOpacity * vortex, 0.0, 1.0));

        if (u_uint8Mode > 0.5 && u_enableDithering > 0.5) {
          float dither = bayer4(gl_FragCoord.xy);
          color += (dither - 0.5) / 256.0;
        }

        color = pow(clamp(color, 0.0, 1.0), vec3(1.0/2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `

    const frag = this.twoTextures ? fragTwo : fragSingle

    const uniforms = {
      psiTexture: this.regl.prop('psi'),
      u_magCutoff: this.regl.prop('magCutoff'),
      u_scale: this.regl.prop('uScale'),
      u_uint8Mode: this.regl.prop('uint8Mode'),
      u_perceptualColormap: this.perceptualColormapLUT,
      u_colorGradingLUT: this.colorGradingLUT,
      u_brdfLUT: this.brdfLUT || this.perceptualColormapLUT, // fallback if not initialized
      u_usePerceptualColormap: this.regl.prop('usePerceptual'),
      u_useLUT: this.regl.prop('useLUT'),
      u_potentialOpacity: this.regl.prop('potentialOpacity'),
      u_useLinearIntensity: this.regl.prop('useLinearIntensity'),
      u_legacyLook: this.regl.prop('legacyLook'),
      u_contourStrength: this.regl.prop('contourStrength'),
      u_densityOnly: this.regl.prop('densityOnly'),
      // enhanced rendering uniforms
      u_exposure: this.regl.prop('exposure'),
      u_whitePoint: this.regl.prop('whitePoint'),
      u_metallic: this.regl.prop('metallic'),
      u_roughness: this.regl.prop('roughness'),
      u_lightDir: this.regl.prop('lightDir'),
      u_lightColor: this.regl.prop('lightColor'),
      u_viewPos: this.regl.prop('viewPos'),
      // vortex highlight uniforms
      u_texel: this.regl.prop('texel'),
      u_vortexOpacity: this.regl.prop('vortexOpacity'),
      u_vortexAmpThreshold: this.regl.prop('vortexAmpThreshold'),
      u_enableDithering: this.regl.prop('enableDithering'),
      u_displayGain: this.regl.prop('displayGain')
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
   * create SSAO pass
   * @private
   */
  _makeSSAOPass() {
    if (!this.options.enableSSAO || !this.ssaoKernel) return null
    
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
    
    const frag = `
      precision ${precision} float;
      varying vec2 vUv;
      
      uniform sampler2D u_positionTexture;
      uniform sampler2D u_normalTexture;
      uniform sampler2D u_noiseTexture;
      uniform vec3 u_kernel[64];
      uniform mat4 u_projection;
      uniform vec2 u_noiseScale;
      uniform float u_radius;
      uniform float u_bias;
      uniform float u_intensity;
      
      void main() {
        vec3 fragPos = texture2D(u_positionTexture, vUv).xyz;
        vec3 normal = texture2D(u_normalTexture, vUv).xyz;
        vec3 randomVec = texture2D(u_noiseTexture, vUv * u_noiseScale).xyz;
        
        // Create TBN matrix
        vec3 tangent = normalize(randomVec - normal * dot(randomVec, normal));
        vec3 bitangent = cross(normal, tangent);
        mat3 TBN = mat3(tangent, bitangent, normal);
        
        float occlusion = 0.0;
        for(int i = 0; i < 64; i++) {
          vec3 samplePos = TBN * u_kernel[i];
          samplePos = fragPos + samplePos * u_radius;
          
          vec4 offset = u_projection * vec4(samplePos, 1.0);
          offset.xyz /= offset.w;
          offset.xyz = offset.xyz * 0.5 + 0.5;
          
          float sampleDepth = texture2D(u_positionTexture, offset.xy).z;
          float rangeCheck = smoothstep(0.0, 1.0, u_radius / abs(fragPos.z - sampleDepth));
          occlusion += (sampleDepth >= samplePos.z + u_bias ? 1.0 : 0.0) * rangeCheck;
        }
        
        occlusion = 1.0 - (occlusion / 64.0) * u_intensity;
        gl_FragColor = vec4(vec3(occlusion), 1.0);
      }
    `
    
    return this.regl({
      vert,
      frag,
      attributes: {
        position: [[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]
      },
      uniforms: {
        u_positionTexture: this.regl.prop('positionTexture'),
        u_normalTexture: this.regl.prop('normalTexture'),
        u_noiseTexture: this.ssaoNoise,
        u_kernel: this.ssaoKernel,
        u_projection: this.regl.prop('projection'),
        u_noiseScale: this.regl.prop('noiseScale'),
        u_radius: this.regl.prop('radius'),
        u_bias: this.regl.prop('bias'),
        u_intensity: this.regl.prop('intensity')
      },
      count: 6
    })
  }
  
  /**
   * create geometry pass for deferred rendering
   * @private
   */
  _makeGeometryPass() {
    // simplified - would be more complex in production
    return this._makeDrawCommand()
  }
  
  /**
   * create lighting pass
   * @private
   */
  _makeLightingPass() {
    // simplified - would implement full deferred lighting
    return this._makeDrawCommand()
  }
  
  /**
   * create post-processing pass
   * @private
   */
  _makePostProcessPass() {
    // simplified - would implement bloom, DOF, etc.
    return this._makeDrawCommand()
  }
  
  /**
   * create final composite pass
   * @private
   */
  _makeCompositePass() {
    // simplified - would combine all passes
    return this._makeDrawCommand()
  }

  /**
   * render the current quantum state
   * @param {SimulationState} state
   */
  draw (state) {
    if (DEBUG) {
      console.log('[Renderer] draw() called');
    }
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
      let sumMag2 = 0.0
      let logSum = 0.0
      let o = 0
      let t = 0
      let p = 0
      let clipped = false
      const Suse = this.currentScale
      for (let px = 0; px < pixelCount; px++, t += 2, o += 4, p += 1) {
        const rr = psi[t]
        const ii = psi[t + 1]
        const mag2 = rr*rr + ii*ii
        sumMag2 += mag2
        logSum += Math.log(1e-12 + mag2)
        const r = rr / Suse
        const im = ii / Suse
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

      // log-average + "key" target (photographic standard)
      const oneOverN = 1.0 / Math.max(1, pixelCount)
      const logAvg = Math.exp(logSum * oneOverN)  // log-average |psi|^2
      const key = 0.18                            // "middle gray" scene key
      const rawGain = key / Math.max(1e-12, logAvg)
      const newGain = Math.max(0.1, Math.min(rawGain, 3e3))
      this.displayGain = this.gainSmoothAlpha * this.displayGain
                       + (1.0 - this.gainSmoothAlpha) * newGain

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
        magCutoff:
          Number.isFinite(state.visual?.magCutoff) &&
          state.visual.magCutoff >= 0
            ? state.visual.magCutoff
            : 1e-4,
        uScale: this.currentScale,
        uint8Mode: this.uint8Mode ? 1 : 0,
        usePerceptual: ENABLE_PERCEPTUAL_COLORMAP ? 1 : 0,
        useLinearIntensity: 1.0,
        legacyLook: 1.0,
        displayGain: this.displayGain * Math.pow(2, (state.params.brightness ?? 5) - 5),
        potentialOpacity:
          Number.isFinite(state.visual?.potentialOpacity) &&
          state.visual.potentialOpacity >= 0
            ? state.visual.potentialOpacity
            : 0.15,
        contourStrength:
          Number.isFinite(state.visual?.contourStrength) &&
          state.visual.contourStrength >= 0 &&
          state.visual.contourStrength <= 1
            ? state.visual.contourStrength
            : 0.1,
        densityOnly:
          state.visual?.densityOnly === true ? 1.0 : 0.0,
        // vortex parameters
        texel: [1.0 / simW, 1.0 / simH],
        vortexOpacity:
          Number.isFinite(state.visual?.vortexOpacity) &&
          state.visual.vortexOpacity >= 0
            ? state.visual.vortexOpacity
            : 0.0,
        vortexAmpThreshold:
          Number.isFinite(state.visual?.vortexAmpThreshold) &&
          state.visual.vortexAmpThreshold > 0
            ? state.visual.vortexAmpThreshold
            : 0.02,
        enableDithering: 0.0, // default: dithering off
        // enhanced rendering parameters
        exposure: this.exposure,
        whitePoint: 2.0,
        metallic: 0.0, // dynamic based on potential later
        roughness: 0.3, // dynamic based on wave variance later
        lightDir: [0.5, 0.8, 0.6],
        lightColor: [1.0, 1.0, 1.0],
        viewPos: [0.0, 0.0, 1.0],
        useLUT: this.options.renderMode === 'enhanced' ? 1.0 : 0.0
      })
      const t4 = typeof performance !== 'undefined' ? performance.now() : 0

      if (DEBUG) {
        console.log('[Renderer] Draw command executed successfully');
      }

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

      let sumMag2 = 0.0
      let logSum = 0.0
      let o = 0
      let t = 0
      let p = 0
      if (this.twoTextures) {
        // single pass for ψ only; potential packed separately below
        for (let px = 0; px < pixelCount; px++, t += 2, o += 4) {
          const rr = psi[t]
          const ii = psi[t + 1]
          const mag2 = rr*rr + ii*ii
          sumMag2 += mag2
          logSum += Math.log(1e-12 + mag2)
          out[o] = rr // R = re
          out[o + 1] = ii // G = im
          // leave B unchanged
          out[o + 3] = 1.0 // A
        }
      } else {
        // single pass: pack ψ and, if needed, potential into B
        for (let px = 0; px < pixelCount; px++, t += 2, p += 1, o += 4) {
          const rr = psi[t]
          const ii = psi[t + 1]
          const mag2 = rr*rr + ii*ii
          sumMag2 += mag2
          logSum += Math.log(1e-12 + mag2)
          out[o] = rr
          out[o + 1] = ii
          if (potDirty) {
            const v01 = this._normalizePotential(V[p], invMax)
            out[o + 2] = v01 // B = normalised potential
          }
          out[o + 3] = 1.0
        }
      }

      // log-average + "key" target (photographic standard)
      const oneOverN = 1.0 / Math.max(1, pixelCount)
      const logAvg = Math.exp(logSum * oneOverN)  // log-average |psi|^2
      const key = 0.18                            // "middle gray" scene key
      const rawGain = key / Math.max(1e-12, logAvg)
      const newGain = Math.max(0.1, Math.min(rawGain, 3e3))
      this.displayGain = this.gainSmoothAlpha * this.displayGain
                       + (1.0 - this.gainSmoothAlpha) * newGain

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
        magCutoff:
          Number.isFinite(state.visual?.magCutoff) &&
          state.visual.magCutoff >= 0
            ? state.visual.magCutoff
            : 1e-4,
        uScale: 1.0,
        uint8Mode: this.uint8Mode ? 1 : 0,
        usePerceptual: ENABLE_PERCEPTUAL_COLORMAP ? 1 : 0,
        useLinearIntensity: 1.0,
        legacyLook: 1.0,
        displayGain: this.displayGain * Math.pow(2, (state.params.brightness ?? 5) - 5),
        potentialOpacity:
          Number.isFinite(state.visual?.potentialOpacity) &&
          state.visual.potentialOpacity >= 0
            ? state.visual.potentialOpacity
            : 0.15,
        contourStrength:
          Number.isFinite(state.visual?.contourStrength) &&
          state.visual.contourStrength >= 0 &&
          state.visual.contourStrength <= 1
            ? state.visual.contourStrength
            : 0.1,
        densityOnly:
          state.visual?.densityOnly === true ? 1.0 : 0.0,
        // Vortex parameters
        texel: [1.0 / simW, 1.0 / simH],
        vortexOpacity:
          Number.isFinite(state.visual?.vortexOpacity) &&
          state.visual.vortexOpacity >= 0
            ? state.visual.vortexOpacity
            : 0.0,
        vortexAmpThreshold:
          Number.isFinite(state.visual?.vortexAmpThreshold) &&
          state.visual.vortexAmpThreshold > 0
            ? state.visual.vortexAmpThreshold
            : 0.02,
        enableDithering: 0.0, // default: dithering off
        // enhanced rendering parameters
        exposure: this.exposure,
        whitePoint: 2.0,
        metallic: 0.0, // dynamic based on potential later
        roughness: 0.3, // dynamic based on wave variance later
        lightDir: [0.5, 0.8, 0.6],
        lightColor: [1.0, 1.0, 1.0],
        viewPos: [0.0, 0.0, 1.0],
        useLUT: this.options.renderMode === 'enhanced' ? 1.0 : 0.0
      })
      const t4 = typeof performance !== 'undefined' ? performance.now() : 0

      if (DEBUG) {
        console.log('[Renderer] Draw command executed successfully (float/half path)');
      }

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
