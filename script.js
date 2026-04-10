const STORAGE_KEY = 'cyber-zen-writer-state-v2';
const AUTOSAVE_DELAY = 1200;
const TIMER_CIRCUMFERENCE = 326.73;

const state = {
  mode: 'rain',
  content: '',
  fontFamily: "'STKaiti', 'KaiTi', 'LXGW WenKai', serif",
  intensity: 68,
  speed: 36,
  blur: 18,
  noiseVolume: 0,
  musicBlend: 0,
  statsVisible: true,
  saveStatusVisible: true,
  timerVisible: true,
  autosaveEnabled: true,
  lastSavedAt: null,
};

const timerState = {
  selectedMinutes: 25,
  totalSeconds: 1500,
  remainingSeconds: 1500,
  intervalId: null,
};

const elements = {
  body: document.body,
  rainCanvas: document.getElementById('rain-canvas'),
  canvas: document.getElementById('visual-canvas'),
  modeSwitcher: document.getElementById('mode-switcher'),
  vibeHandle: document.getElementById('vibe-handle'),
  vibeMixer: document.getElementById('vibe-mixer'),
  mixerClose: document.getElementById('mixer-close'),
  fontFamily: document.getElementById('font-family'),
  intensityRange: document.getElementById('intensity-range'),
  intensityValue: document.getElementById('intensity-value'),
  speedRange: document.getElementById('speed-range'),
  speedValue: document.getElementById('speed-value'),
  blurRange: document.getElementById('blur-range'),
  blurValue: document.getElementById('blur-value'),
  noiseRange: document.getElementById('noise-range'),
  noiseValue: document.getElementById('noise-value'),
  musicRange: document.getElementById('music-range'),
  musicValue: document.getElementById('music-value'),
  statsToggle: document.getElementById('stats-toggle'),
  saveStatusToggle: document.getElementById('save-status-toggle'),
  timerVisibilityToggle: document.getElementById('timer-visibility-toggle'),
  autosaveToggle: document.getElementById('autosave-toggle'),
  saveButton: document.getElementById('save-button'),
  exportButton: document.getElementById('export-button'),
  editor: document.getElementById('editor'),
  saveStatus: document.getElementById('save-status'),
  wordCount: document.getElementById('word-count'),
  bottomMeta: document.getElementById('bottom-meta'),
  zenTimer: document.getElementById('zen-timer'),
  timerToggle: document.getElementById('timer-toggle'),
  timerPanel: document.getElementById('timer-panel'),
  timerReadout: document.getElementById('timer-readout'),
  timerProgress: document.getElementById('timer-progress'),
  timerStart: document.getElementById('timer-start'),
  timerReset: document.getElementById('timer-reset'),
  timerMinutesButtons: document.querySelectorAll('[data-minutes]'),
};

let autosaveTimer = null;
let weatherScene = null;
let rainRenderer = null;
let audioEngine = null;
let uiFadeTimer = null;

class AmbientEngine {
  constructor() {
    this.context = null;
    this.masterGain = null;
    this.noiseGain = null;
    this.musicGain = null;
    this.noiseFilter = null;
    this.noiseSource = null;
    this.musicOscillatorA = null;
    this.musicOscillatorB = null;
  }

  ensureContext() {
    if (this.context) {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    this.context = new AudioContextClass();
    this.masterGain = this.context.createGain();
    this.masterGain.gain.value = 0.28;
    this.masterGain.connect(this.context.destination);

    this.noiseGain = this.context.createGain();
    this.musicGain = this.context.createGain();
    this.noiseGain.gain.value = 0;
    this.musicGain.gain.value = 0;

    const noiseBuffer = this.context.createBuffer(1, this.context.sampleRate * 2, this.context.sampleRate);
    const channel = noiseBuffer.getChannelData(0);
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = Math.random() * 2 - 1;
    }

    this.noiseSource = this.context.createBufferSource();
    this.noiseSource.buffer = noiseBuffer;
    this.noiseSource.loop = true;

    this.noiseFilter = this.context.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseSource.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.masterGain);

    this.musicOscillatorA = this.context.createOscillator();
    this.musicOscillatorB = this.context.createOscillator();
    this.musicOscillatorA.type = 'sine';
    this.musicOscillatorB.type = 'triangle';

    const musicMix = this.context.createGain();
    musicMix.gain.value = 0.5;
    this.musicOscillatorA.connect(musicMix);
    this.musicOscillatorB.connect(musicMix);
    musicMix.connect(this.musicGain);
    this.musicGain.connect(this.masterGain);

    this.noiseSource.start();
    this.musicOscillatorA.start();
    this.musicOscillatorB.start();
  }

  async update() {
    this.ensureContext();
    if (!this.context) {
      return;
    }

    if (this.context.state === 'suspended') {
      await this.context.resume();
    }

    const now = this.context.currentTime;
    this.noiseFilter.frequency.value = state.mode === 'snow' ? 850 : 2100;
    this.noiseFilter.Q.value = state.mode === 'snow' ? 0.7 : 1.15;
    this.musicOscillatorA.frequency.value = state.mode === 'snow' ? 130.81 : 164.81;
    this.musicOscillatorB.frequency.value = state.mode === 'snow' ? 196 : 246.94;

    this.noiseGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.cancelScheduledValues(now);
    this.noiseGain.gain.linearRampToValueAtTime((state.noiseVolume / 100) * 0.22, now + 0.25);
    this.musicGain.gain.linearRampToValueAtTime((state.musicBlend / 100) * 0.12, now + 0.25);
  }
}

class RainShaderRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, antialias: true });
    this.program = null;
    this.uniforms = null;
    this.startTime = performance.now();
    this.frameHandle = null;

    if (!this.gl) {
      return;
    }

    this.init();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.render = this.render.bind(this);
    this.frameHandle = requestAnimationFrame(this.render);
  }

  init() {
    const gl = this.gl;
    const vertexSource = `
      attribute vec2 a_position;
      varying vec2 v_uv;
      void main() {
        v_uv = a_position * 0.5 + 0.5;
        gl_Position = vec4(a_position, 0.0, 1.0);
      }
    `;

    const fragmentSource = `
      precision highp float;

      varying vec2 v_uv;
      uniform vec2 u_resolution;
      uniform float u_time;
      uniform float u_rainAmount;
      uniform float u_speed;

      #define S(a, b, t) smoothstep(a, b, t)

      vec3 N13(float p) {
        vec3 p3 = fract(vec3(p) * vec3(.1031,.11369,.13787));
        p3 += dot(p3, p3.yzx + 19.19);
        return fract(vec3((p3.x + p3.y) * p3.z, (p3.x + p3.z) * p3.y, (p3.y + p3.z) * p3.x));
      }

      float N(float t) {
        return fract(sin(t * 12345.564) * 7658.76);
      }

      float Saw(float b, float t) {
        return S(0., b, t) * S(1., b, t);
      }

      vec2 DropLayer2(vec2 uv, float t) {
        vec2 UV = uv;
        uv.y += t * 0.75;
        vec2 a = vec2(6., 1.);
        vec2 grid = a * 2.;
        vec2 id = floor(uv * grid);

        float colShift = N(id.x);
        uv.y += colShift;
        id = floor(uv * grid);

        vec3 n = N13(id.x * 35.2 + id.y * 2376.1);
        vec2 st = fract(uv * grid) - vec2(.5, 0.);

        float x = n.x - .5;
        float y = UV.y * 20.;
        float wiggle = sin(y + sin(y));
        x += wiggle * (.5 - abs(x)) * (n.z - .5);
        x *= .7;

        float ti = fract(t + n.z);
        y = (Saw(.85, ti) - .5) * .9 + .5;
        vec2 p = vec2(x, y);

        float d = length((st - p) * a.yx);
        float mainDrop = S(.4, .0, d);

        float r = sqrt(S(1., y, st.y));
        float cd = abs(st.x - x);
        float trail = S(.23 * r, .15 * r * r, cd);
        float trailFront = S(-.02, .02, st.y - y);
        trail *= trailFront * r * r;

        y = UV.y;
        float trail2 = S(.2 * r, .0, cd);
        float droplets = max(0., (sin(y * (1. - y) * 120.) - st.y)) * trail2 * trailFront * n.z;
        y = fract(y * 10.) + (st.y - .5);
        float dd = length(st - vec2(x, y));
        droplets = S(.3, 0., dd);
        float m = mainDrop + droplets * r * trailFront;

        return vec2(m, trail);
      }

      float StaticDrops(vec2 uv, float t) {
        uv *= 40.;
        vec2 id = floor(uv);
        uv = fract(uv) - .5;
        vec3 n = N13(id.x * 107.45 + id.y * 3543.654);
        vec2 p = (n.xy - .5) * .7;
        float d = length(uv - p);
        float fade = Saw(.025, fract(t + n.z));
        return S(.3, 0., d) * fract(n.z * 10.) * fade;
      }

      vec2 Drops(vec2 uv, float t, float l0, float l1, float l2) {
        float s = StaticDrops(uv, t) * l0;
        vec2 m1 = DropLayer2(uv, t) * l1;
        vec2 m2 = DropLayer2(uv * 1.85, t) * l2;
        float c = s + m1.x + m2.x;
        c = S(.3, 1., c);
        return vec2(c, max(m1.y * l0, m2.y * l1));
      }

      vec3 background(vec2 uv, vec2 n, float fog, float sparkle) {
        vec2 p = uv - 0.5;
        p.x *= u_resolution.x / max(u_resolution.y, 1.0);
        float vignette = 1.0 - dot(p, p) * 1.2;
        vec3 top = vec3(0.07, 0.11, 0.18);
        vec3 bottom = vec3(0.015, 0.025, 0.05);
        vec3 mist = vec3(0.24, 0.33, 0.44);
        vec3 warm = vec3(0.18, 0.14, 0.11);
        vec3 col = mix(bottom, top, 1.0 - uv.y);
        col += mist * fog * 0.45;
        col += warm * sparkle * 0.12;
        col += vec3(0.08, 0.11, 0.15) * (n.x * 0.6 + n.y * 0.4);
        return col * vignette;
      }

      void main() {
        vec2 fragCoord = v_uv * u_resolution;
        vec2 uv = (fragCoord - 0.5 * u_resolution) / u_resolution.y;
        vec2 UV = fragCoord / u_resolution;

        float T = u_time * (0.55 + u_speed * 0.9);
        float t = T * 0.2;
        float rainAmount = clamp(u_rainAmount, 0.0, 1.0);

        float staticDrops = S(-.5, 1., rainAmount) * 2.0;
        float layer1 = S(.25, .75, rainAmount);
        float layer2 = S(.0, .5, rainAmount);

        vec2 c = Drops(uv, t, staticDrops, layer1, layer2);
        vec2 e = vec2(.0015, 0.);
        float cx = Drops(uv + e, t, staticDrops, layer1, layer2).x;
        float cy = Drops(uv + e.yx, t, staticDrops, layer1, layer2).x;
        vec2 n = vec2(cx - c.x, cy - c.x);

        float fog = mix(0.18, 0.42, rainAmount) - c.y * 0.2;
        float sparkle = sin(T * 0.35 + UV.y * 6.0) * 0.5 + 0.5;
        vec3 col = background(UV + n * 0.8, n, fog, sparkle);

        float focus = mix(0.9 - c.y * 0.35, 0.2, S(.1, .2, c.x));
        col = mix(col, col + vec3(0.12, 0.16, 0.2), c.x * 0.18);
        col += vec3(0.55, 0.63, 0.72) * c.y * 0.08;
        col *= mix(0.78, 1.08, focus);

        gl_FragColor = vec4(col, 1.0);
      }
    `;

    const vertexShader = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    this.program = this.createProgram(vertexShader, fragmentShader);
    this.uniforms = {
      resolution: gl.getUniformLocation(this.program, 'u_resolution'),
      time: gl.getUniformLocation(this.program, 'u_time'),
      rainAmount: gl.getUniformLocation(this.program, 'u_rainAmount'),
      speed: gl.getUniformLocation(this.program, 'u_speed'),
    };

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    return shader;
  }

  createProgram(vertexShader, fragmentShader) {
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    return program;
  }

  resize() {
    if (!this.gl) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  render(now) {
    if (!this.gl) {
      return;
    }

    const gl = this.gl;
    const isRain = state.mode === 'rain';
    this.canvas.style.opacity = isRain ? '1' : '0';

    if (isRain) {
      gl.useProgram(this.program);
      gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height);
      gl.uniform1f(this.uniforms.time, (now - this.startTime) * 0.001);
      gl.uniform1f(this.uniforms.rainAmount, Math.min(1, state.intensity / 100));
      gl.uniform1f(this.uniforms.speed, Math.max(0.18, state.speed / 100));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }

    this.frameHandle = requestAnimationFrame(this.render);
  }
}

class WeatherCanvas {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.particles = [];
    this.snowLayers = [];
    this.rainLayers = [];
    this.lastFrame = 0;
    this.animate = this.animate.bind(this);
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.seedParticles();
    requestAnimationFrame(this.animate);
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * ratio;
    this.canvas.height = this.height * ratio;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.seedParticles();
  }

  seedParticles() {
    if (state.mode === 'snow') {
      this.particles = [];
      this.rainLayers = [];
      this.seedSnowLayers();
      return;
    }

    this.snowLayers = [];
    this.particles = [];
    this.rainLayers = [];
  }

  createParticle(randomY = false) {
    const speedFactor = Math.max(state.speed / 42, 0.2);
    const driftFactor = 0.45 + state.speed / 100;

    if (state.mode === 'snow') {
      return {
        x: Math.random() * this.width,
        y: randomY ? Math.random() * this.height : -10,
        size: Math.random() * 2.8 + 0.8,
        speedY: (Math.random() * 0.9 + state.intensity / 180) * speedFactor,
        speedX: (Math.random() * 0.6 - 0.3) * driftFactor,
        drift: Math.random() * Math.PI * 2,
        alpha: Math.random() * 0.65 + 0.2,
      };
    }

    return {
      x: Math.random() * this.width,
      y: randomY ? Math.random() * this.height : -40,
      length: Math.random() * 18 + 14,
      speedY: (Math.random() * 12 + state.intensity / 4) * speedFactor,
      speedX: (-Math.random() * 2.6 - 1) * driftFactor,
      alpha: Math.random() * 0.24 + 0.08,
      width: Math.random() * 1.2 + 0.5,
    };
  }

  seedSnowLayers() {
    const layerCount = 6;
    const intensityFactor = state.intensity / 100;
    const speedFactor = Math.max(state.speed / 42, 0.2);

    this.snowLayers = Array.from({ length: layerCount }, (_, layerIndex) => {
      const scale = layerIndex + 1;
      const count = Math.max(18, Math.round((18 + intensityFactor * 48) / (0.55 + layerIndex * 0.22)));

      return {
        cellSize: 26 + scale * 18,
        speed: (0.08 + scale * 0.028) * speedFactor,
        sway: 10 + scale * 4.5,
        swirl: 0.35 + scale * 0.08,
        alpha: 0.2 + scale * 0.08,
        flakes: Array.from({ length: count }, () => ({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius: 0.7 + Math.random() * (0.8 + scale * 0.28),
          wobble: Math.random() * Math.PI * 2,
          drift: Math.random() * Math.PI * 2,
          seed: Math.random() * 1000,
        })),
      };
    });
  }

  seedRainLayers() {
    const intensityFactor = state.intensity / 100;
    const speedFactor = Math.max(state.speed / 42, 0.22);
    const layerConfigs = [
      { count: Math.round(18 + intensityFactor * 18), speed: 0.85, size: 1.1, alpha: 0.32, trail: 90 },
      { count: Math.round(14 + intensityFactor * 16), speed: 1.15, size: 1.4, alpha: 0.42, trail: 130 },
      { count: Math.round(10 + intensityFactor * 14), speed: 1.45, size: 1.8, alpha: 0.54, trail: 180 },
    ];

    this.rainLayers = layerConfigs.map((config, layerIndex) => ({
      ...config,
      speed: config.speed * speedFactor,
      drops: Array.from({ length: config.count }, () => this.createRainDrop(layerIndex, true)),
    }));
  }

  createRainDrop(layerIndex, randomY = false) {
    const layerDepth = layerIndex + 1;
    const columnWidth = this.width / (8 + layerIndex * 2);
    return {
      x: Math.random() * this.width,
      y: randomY ? Math.random() * this.height : -40 - Math.random() * 120,
      width: 1.4 + Math.random() * (1.2 + layerDepth * 0.6),
      height: 10 + Math.random() * (14 + layerDepth * 6),
      speedY: 1.4 + Math.random() * (1.2 + layerDepth * 0.8),
      sway: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * (0.45 + layerDepth * 0.14),
      trail: 55 + Math.random() * (35 + layerDepth * 28),
      branch: Math.random() * 0.8 + 0.2,
      column: Math.floor(Math.random() * Math.max(1, this.width / columnWidth)),
    };
  }

  animate(timestamp) {
    const delta = Math.min((timestamp - this.lastFrame) / 16.666, 2);
    this.lastFrame = timestamp;
    this.drawBackdrop();
    this.drawParticles(delta || 1);
    requestAnimationFrame(this.animate);
  }

  drawBackdrop() {
    this.context.clearRect(0, 0, this.width, this.height);
    const mist = this.context.createRadialGradient(
      this.width * 0.5,
      this.height * 0.7,
      0,
      this.width * 0.5,
      this.height * 0.7,
      this.width * 0.55,
    );

    if (state.mode === 'snow') {
      mist.addColorStop(0, 'rgba(255, 248, 239, 0.05)');
      mist.addColorStop(1, 'rgba(255, 255, 255, 0)');
    } else {
      mist.addColorStop(0, 'rgba(129, 178, 255, 0.05)');
      mist.addColorStop(1, 'rgba(255, 255, 255, 0)');
    }

    this.context.fillStyle = mist;
    this.context.fillRect(0, 0, this.width, this.height);
  }

  drawParticles(delta) {
    if (state.mode === 'snow') {
      this.drawSnowLayers(delta);
      return;
    }
    this.context.clearRect(0, 0, this.width, this.height);
  }

  drawSnowLayers(delta) {
    const time = performance.now() * 0.001;
    const gradient = this.context.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, 'rgba(216, 232, 255, 0.05)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
    this.context.fillStyle = gradient;
    this.context.fillRect(0, 0, this.width, this.height);

    for (const layer of this.snowLayers) {
      for (const flake of layer.flakes) {
        flake.wobble += 0.0035 * delta * layer.swirl;
        flake.drift += 0.0022 * delta * (0.8 + layer.swirl);

        const swayOffset = Math.sin(time * (0.55 + layer.swirl * 0.08) + flake.wobble + flake.seed) * layer.sway;
        const microDrift = Math.cos(time * 1.2 + flake.drift) * (0.18 + layer.swirl * 0.12);

        flake.x += microDrift * delta + Math.sin(flake.wobble) * 0.08 * delta;
        flake.y += layer.speed * (1.6 + flake.radius * 0.12) * delta;

        if (flake.y > this.height + 16) {
          flake.y = -12 - Math.random() * 24;
          flake.x = Math.random() * this.width;
        }

        if (flake.x < -24) {
          flake.x = this.width + 12;
        } else if (flake.x > this.width + 24) {
          flake.x = -12;
        }

        const drawX = flake.x + swayOffset;
        const drawY = flake.y;
        const glow = 0.18 + flake.radius * 0.02;

        this.context.globalAlpha = Math.min(layer.alpha, 0.78);
        this.context.fillStyle = 'rgba(242, 244, 248, 0.95)';
        this.context.beginPath();
        this.context.arc(drawX, drawY, flake.radius, 0, Math.PI * 2);
        this.context.fill();

        this.context.globalAlpha = layer.alpha * 0.14;
        this.context.fillStyle = 'rgba(228, 237, 255, 0.9)';
        this.context.beginPath();
        this.context.arc(drawX, drawY, flake.radius + glow, 0, Math.PI * 2);
        this.context.fill();
      }
    }

    this.context.globalAlpha = 1;
  }

  drawRainGlass(delta) {
    const time = performance.now() * 0.001;
    const fog = this.context.createLinearGradient(0, 0, 0, this.height);
    fog.addColorStop(0, 'rgba(116, 150, 194, 0.11)');
    fog.addColorStop(0.45, 'rgba(86, 114, 150, 0.08)');
    fog.addColorStop(1, 'rgba(18, 26, 40, 0.03)');
    this.context.fillStyle = fog;
    this.context.fillRect(0, 0, this.width, this.height);

    for (const layer of this.rainLayers) {
      for (const drop of layer.drops) {
        drop.sway += 0.012 * delta;
        const swayOffset = Math.sin(time * 0.9 + drop.sway) * (1.5 + layer.size);
        const diagonal = drop.drift * state.speed * 0.045;
        const speed = drop.speedY * layer.speed * (0.9 + state.intensity / 180);

        drop.x += diagonal * delta;
        drop.y += speed * delta;

        if (drop.y - drop.trail > this.height + 40) {
          Object.assign(drop, this.createRainDrop(Math.max(0, this.rainLayers.indexOf(layer)), false));
        }

        if (drop.x < -50) {
          drop.x = this.width + 30;
        } else if (drop.x > this.width + 50) {
          drop.x = -30;
        }

        const x = drop.x + swayOffset;
        const y = drop.y;
        const trailLength = drop.trail * (0.75 + state.intensity / 160);

        const trailGradient = this.context.createLinearGradient(x, y - trailLength, x, y + 10);
        trailGradient.addColorStop(0, 'rgba(255,255,255,0)');
        trailGradient.addColorStop(0.5, `rgba(180, 207, 232, ${layer.alpha * 0.15})`);
        trailGradient.addColorStop(1, `rgba(216, 232, 246, ${layer.alpha * 0.42})`);
        this.context.strokeStyle = trailGradient;
        this.context.lineWidth = drop.width;
        this.context.lineCap = 'round';
        this.context.beginPath();
        this.context.moveTo(x - diagonal * 0.14, y - trailLength);
        this.context.lineTo(x, y);
        this.context.stroke();

        this.context.globalAlpha = Math.min(0.9, layer.alpha);
        this.context.fillStyle = 'rgba(228, 238, 246, 0.95)';
        this.context.beginPath();
        this.context.ellipse(x, y, drop.width * 1.8, drop.height * 0.5, diagonal * 0.02, 0, Math.PI * 2);
        this.context.fill();

        this.context.globalAlpha = layer.alpha * 0.14;
        this.context.fillStyle = 'rgba(235, 242, 255, 1)';
        this.context.beginPath();
        this.context.ellipse(x, y + 1, drop.width * 3.2, drop.height * 0.9, diagonal * 0.02, 0, Math.PI * 2);
        this.context.fill();

        if (drop.branch > 0.55) {
          this.context.globalAlpha = layer.alpha * 0.11;
          this.context.strokeStyle = 'rgba(194, 216, 236, 0.85)';
          this.context.lineWidth = Math.max(0.8, drop.width * 0.38);
          this.context.beginPath();
          this.context.moveTo(x, y - drop.height * 0.2);
          this.context.lineTo(x + diagonal * 0.45, y + trailLength * 0.2);
          this.context.stroke();
        }
      }
    }

    this.context.globalAlpha = 1;
  }
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      Object.assign(state, saved);
      if (typeof saved.title === 'string' && !saved.content) {
        state.content = saved.title;
      }
      delete state.title;
    }
  } catch (error) {
    console.warn('Failed to restore state.', error);
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function setUiPresence() {
  elements.body.classList.add('show-ui');
  window.clearTimeout(uiFadeTimer);
  uiFadeTimer = window.setTimeout(() => {
    elements.body.classList.remove('show-ui');
  }, 1600);
}

function updateWordCount() {
  const total = state.content.trim() ? state.content.replace(/\s+/g, '').length : 0;
  elements.wordCount.textContent = `${total} 字`;
}

function updateSaveStatus(text) {
  if (text) {
    elements.saveStatus.textContent = text;
    return;
  }

  if (!state.lastSavedAt) {
    elements.saveStatus.textContent = '本地暂存未开始';
    return;
  }

  const time = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(state.lastSavedAt));

  elements.saveStatus.textContent = `本地已暂存 ${time}`;
}

function applyVisualState() {
  document.documentElement.style.setProperty('--deck-font', state.fontFamily);
  document.documentElement.style.setProperty('--deck-blur', `${state.blur}px`);
  elements.body.classList.toggle('snow-mode', state.mode === 'snow');
  elements.canvas.style.opacity = state.mode === 'snow' ? '1' : '0';
  elements.rainCanvas.style.opacity = state.mode === 'rain' ? '1' : '0';

  elements.intensityValue.textContent = `${state.intensity}%`;
  elements.speedValue.textContent = `${state.speed}%`;
  elements.blurValue.textContent = `${state.blur}px`;
  elements.noiseValue.textContent = `${state.noiseVolume}%`;
  elements.musicValue.textContent = `${state.musicBlend}%`;
  elements.bottomMeta.style.display = state.statsVisible || state.saveStatusVisible ? 'flex' : 'none';
  elements.wordCount.style.display = state.statsVisible ? '' : 'none';
  elements.saveStatus.style.display = state.saveStatusVisible ? '' : 'none';
  elements.zenTimer.style.display = state.timerVisible ? 'grid' : 'none';

  for (const button of elements.modeSwitcher.querySelectorAll('.mode-button')) {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  }

  if (weatherScene) {
    weatherScene.seedParticles();
  }

  if (audioEngine) {
    audioEngine.update();
  }
}

function applyFormState() {
  elements.fontFamily.value = state.fontFamily;
  elements.intensityRange.value = String(state.intensity);
  elements.speedRange.value = String(state.speed);
  elements.blurRange.value = String(state.blur);
  elements.noiseRange.value = String(state.noiseVolume);
  elements.musicRange.value = String(state.musicBlend);
  elements.statsToggle.checked = state.statsVisible;
  elements.saveStatusToggle.checked = state.saveStatusVisible;
  elements.timerVisibilityToggle.checked = state.timerVisible;
  elements.autosaveToggle.checked = state.autosaveEnabled;
  elements.editor.value = state.content;
  updateWordCount();
  updateSaveStatus();
}

function snapshotDraft(statusText) {
  state.content = elements.editor.value;
  state.lastSavedAt = Date.now();
  persistState();
  updateWordCount();
  updateSaveStatus(statusText);
}

function scheduleAutosave() {
  if (!state.autosaveEnabled) {
    updateSaveStatus('自动保存已关闭');
    return;
  }

  updateSaveStatus('正在本地暂存...');
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    snapshotDraft();
  }, AUTOSAVE_DELAY);
}

function exportTxt() {
  snapshotDraft('已准备导出');
  const firstLine = (elements.editor.value.split('\n').find((line) => line.trim()) || '未命名文稿').trim();
  const fileName = firstLine.replace(/[\\/:*?"<>|]/g, '-');
  const content = elements.editor.value;
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${fileName}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function openMixer(open) {
  elements.vibeMixer.classList.toggle('is-open', open);
  elements.vibeHandle.setAttribute('aria-expanded', String(open));
  elements.vibeHandle.setAttribute('aria-label', open ? '关闭氛围控制台' : '打开氛围控制台');
  elements.vibeHandle.setAttribute('title', open ? '关闭氛围控制台' : '打开氛围控制台');
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${secs}`;
}

function updateTimerUi() {
  const progress = 1 - timerState.remainingSeconds / timerState.totalSeconds;
  elements.timerReadout.textContent = formatTime(timerState.remainingSeconds);
  elements.timerProgress.style.strokeDashoffset = `${TIMER_CIRCUMFERENCE * (1 - progress)}`;
}

function stopTimer() {
  if (timerState.intervalId) {
    window.clearInterval(timerState.intervalId);
    timerState.intervalId = null;
  }
  elements.timerStart.textContent = '开始';
}

function resetTimer(minutes = timerState.selectedMinutes) {
  timerState.selectedMinutes = minutes;
  timerState.totalSeconds = minutes * 60;
  timerState.remainingSeconds = minutes * 60;
  stopTimer();
  updateTimerUi();
}

function startTimer() {
  if (timerState.intervalId) {
    stopTimer();
    return;
  }

  elements.timerStart.textContent = '暂停';
  timerState.intervalId = window.setInterval(() => {
    if (timerState.remainingSeconds <= 1) {
      timerState.remainingSeconds = 0;
      updateTimerUi();
      stopTimer();
      updateSaveStatus('心流计时完成');
      return;
    }

    timerState.remainingSeconds -= 1;
    updateTimerUi();
  }, 1000);
}

function bindEvents() {
  document.addEventListener('mousemove', setUiPresence);
  document.addEventListener('keydown', setUiPresence);

  elements.modeSwitcher.addEventListener('click', (event) => {
    const button = event.target.closest('[data-mode]');
    if (!button) {
      return;
    }

    state.mode = button.dataset.mode;
    persistState();
    applyVisualState();
  });

  elements.vibeHandle.addEventListener('click', (event) => {
    event.stopPropagation();
    openMixer(!elements.vibeMixer.classList.contains('is-open'));
  });

  elements.mixerClose.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openMixer(false);
  });

  elements.vibeMixer.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  document.addEventListener('click', () => {
    openMixer(false);
  });

  elements.fontFamily.addEventListener('change', (event) => {
    state.fontFamily = event.target.value;
    persistState();
    applyVisualState();
  });

  elements.intensityRange.addEventListener('input', (event) => {
    state.intensity = Number(event.target.value);
    persistState();
    applyVisualState();
  });

  elements.speedRange.addEventListener('input', (event) => {
    state.speed = Number(event.target.value);
    persistState();
    applyVisualState();
  });

  elements.blurRange.addEventListener('input', (event) => {
    state.blur = Number(event.target.value);
    persistState();
    applyVisualState();
  });

  elements.noiseRange.addEventListener('input', (event) => {
    state.noiseVolume = Number(event.target.value);
    persistState();
    applyVisualState();
  });

  elements.musicRange.addEventListener('input', (event) => {
    state.musicBlend = Number(event.target.value);
    persistState();
    applyVisualState();
  });

  elements.statsToggle.addEventListener('change', (event) => {
    state.statsVisible = event.target.checked;
    persistState();
    applyVisualState();
  });

  elements.saveStatusToggle.addEventListener('change', (event) => {
    state.saveStatusVisible = event.target.checked;
    persistState();
    applyVisualState();
  });

  elements.timerVisibilityToggle.addEventListener('change', (event) => {
    state.timerVisible = event.target.checked;
    persistState();
    applyVisualState();
  });

  elements.autosaveToggle.addEventListener('change', (event) => {
    state.autosaveEnabled = event.target.checked;
    persistState();
    updateSaveStatus(event.target.checked ? '自动保存已开启' : '自动保存已关闭');
  });

  const onDraftInput = () => {
    state.content = elements.editor.value;
    updateWordCount();
    scheduleAutosave();
  };

  elements.editor.addEventListener('input', onDraftInput);

  elements.saveButton.addEventListener('click', () => {
    snapshotDraft('已手动保存到本地');
  });

  elements.exportButton.addEventListener('click', exportTxt);

  elements.timerToggle.addEventListener('click', () => {
    const open = !elements.timerPanel.classList.contains('is-open');
    elements.timerPanel.classList.toggle('is-open', open);
    elements.timerToggle.setAttribute('aria-expanded', String(open));
  });

  elements.timerStart.addEventListener('click', startTimer);
  elements.timerReset.addEventListener('click', () => resetTimer());

  for (const button of elements.timerMinutesButtons) {
    button.addEventListener('click', () => {
      resetTimer(Number(button.dataset.minutes));
    });
  }

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      snapshotDraft('已手动保存到本地');
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.autosaveEnabled) {
      snapshotDraft();
    }
  });
}

function init() {
  loadState();
  rainRenderer = new RainShaderRenderer(elements.rainCanvas);
  weatherScene = new WeatherCanvas(elements.canvas);
  audioEngine = new AmbientEngine();
  applyFormState();
  applyVisualState();
  bindEvents();
  resetTimer(timerState.selectedMinutes);
  setUiPresence();
}

init();
