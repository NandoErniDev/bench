/**
 * Strange Attractor — up to a million particles integrated through the Aizawa
 * vector field on the GPU, drawn additively into a decaying trail buffer. The
 * result is a glowing, slowly rotating organic shape; every particle costs a
 * state update plus a blended point, so the particle count is the cost knob.
 */

import { el, fmtInt } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl, toggleControl } from '../ui/components';

/* The Aizawa field has three stable fixed points that swallow anything started
   outside its basin, so the particles are seeded from a real orbit computed on
   the CPU instead of from a random box. */
const field = (x: number, y: number, z: number): [number, number, number] => {
  const A = 0.95;
  const B = 0.7;
  const C = 0.6;
  const D = 3.5;
  const E = 0.25;
  const F = 0.1;
  return [
    (z - B) * x - D * y,
    D * x + (z - B) * y,
    C + A * z - (z * z * z) / 3 - (x * x + y * y) * (1 + E * z) + F * z * x * x * x,
  ];
};

const orbitStep = (p: [number, number, number], dt: number): [number, number, number] => {
  const k1 = field(p[0], p[1], p[2]);
  const k2 = field(p[0] + k1[0] * dt * 0.5, p[1] + k1[1] * dt * 0.5, p[2] + k1[2] * dt * 0.5);
  return [p[0] + k2[0] * dt, p[1] + k2[1] * dt, p[2] + k2[2] * dt];
};

const UPDATE_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uRes;
uniform float uDt;
uniform float uTime;
out vec4 outState;

vec3 field(vec3 p) {
  const float A = 0.95;
  const float B = 0.7;
  const float C = 0.6;
  const float D = 3.5;
  const float E = 0.25;
  const float F = 0.1;
  float x = p.x;
  float y = p.y;
  float z = p.z;
  return vec3(
    (z - B) * x - D * y,
    D * x + (z - B) * y,
    C + A * z - z * z * z / 3.0 - (x * x + y * y) * (1.0 + E * z) + F * z * x * x * x
  );
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(41.7, 289.3)) + uTime) * 3187.31);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 state = texture(uState, uv);
  vec3 p = state.xyz;

  vec3 k1 = field(p);
  vec3 k2 = field(p + k1 * (uDt * 0.5));
  p += k2 * uDt;

  float speed = length(k2);

  if (dot(p, p) > 64.0) {
    p = vec3(hash(uv) * 3.2 - 1.6, hash(uv + 17.3) * 3.2 - 1.6, hash(uv + 31.7) * 3.0 + 0.1);
    speed = 0.0;
  }

  outState = vec4(p, speed);
}`;

const DECAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform float uDecay;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uTrail, 0));
  fragColor = vec4(texture(uTrail, uv).rgb * uDecay, 1.0);
}`;

const POINT_VS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform float uSize;
uniform float uAngle;
uniform float uZoom;
uniform float uBrightness;
out vec3 vColor;

vec3 ramp(float v) {
  vec3 cold = vec3(0.13, 0.28, 0.78);
  vec3 mid = vec3(0.86, 0.26, 0.72);
  vec3 hot = vec3(1.0, 0.76, 0.34);
  vec3 color = mix(cold, mid, smoothstep(0.0, 0.55, v));
  return mix(color, hot, smoothstep(0.55, 1.0, v));
}

void main() {
  int id = gl_VertexID;
  int side = int(uSize);
  vec2 uv = (vec2(float(id % side), float(id / side)) + 0.5) / uSize;
  vec4 state = textureLod(uState, uv, 0.0);

  float ca = cos(uAngle);
  float sa = sin(uAngle);
  vec3 p = state.xyz;
  vec2 planar = vec2(p.x * ca - p.y * sa, p.x * sa + p.y * ca);
  vec2 screen = vec2(planar.x, planar.y * 0.45 + (p.z - 0.72) * 0.55) * uZoom;

  gl_Position = vec4(screen, 0.0, 1.0);
  gl_PointSize = 1.5;
  vColor = ramp(clamp(state.w * 0.32, 0.0, 1.0)) * uBrightness;
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform vec2 uRes;
uniform float uExposure;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 color = texture(uTrail, uv).rgb * uExposure;
  color = vec3(1.0) - exp(-color);
  color = pow(color, vec3(0.88));
  vec2 p = uv - 0.5;
  color *= 1.0 - 0.6 * dot(p, p);
  color += vec3(0.008, 0.008, 0.014);
  fragColor = vec4(color, 1.0);
}`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

const COUNTS = [
  { value: '65536', label: '65 536' },
  { value: '262144', label: '262 144' },
  { value: '1048576', label: '1 048 576' },
];

export function mountAttractor(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  if (!gl.getExtension('EXT_color_buffer_float')) {
    surface.destroy();
    throw new Error('Der Attraktor braucht Float-Renderziele (EXT_color_buffer_float).');
  }

  const programs = {
    update: compileProgram(gl, FS_TRIANGLE, UPDATE_FS, 'Attraktor-Schritt'),
    decay: compileProgram(gl, FS_TRIANGLE, DECAY_FS, 'Attraktor-Spur'),
    points: compileProgram(gl, POINT_VS, POINT_FS, 'Attraktor-Punkte'),
    display: compileProgram(gl, FS_TRIANGLE, DISPLAY_FS, 'Attraktor-Anzeige'),
  };
  const uniforms = {
    update: uniformMap(gl, programs.update, ['uState', 'uRes', 'uDt', 'uTime']),
    decay: uniformMap(gl, programs.decay, ['uTrail', 'uDecay']),
    points: uniformMap(gl, programs.points, ['uState', 'uSize', 'uAngle', 'uZoom', 'uBrightness']),
    display: uniformMap(gl, programs.display, ['uTrail', 'uRes', 'uExposure']),
  };

  const state = {
    count: 262144,
    side: 512,
    speed: 1,
    decay: 0.95,
    exposure: 1.35,
    rotate: true,
    angle: 0,
    clock: 0,
  };

  let states: Target[] = [];
  let sourceIndex = 0;
  let trails: Target[] = [];
  let trailIndex = 0;

  const floatTarget = (width: number, height: number, internal: number, format: number): Target => {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Renderziel konnte nicht erstellt werden');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    /* RGBA32F is not filterable; the trail buffer is RGBA16F and stays smooth. */
    const filter = internal === gl.RGBA32F ? gl.NEAREST : gl.LINEAR;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, format, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Float-Framebuffer für den Attraktor ist unvollständig.');
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer, width, height };
  };

  const disposeStates = () => {
    for (const target of states) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    states = [];
  };

  const buildStates = () => {
    disposeStates();
    state.side = Math.round(Math.sqrt(state.count));
    states = [floatTarget(state.side, state.side, gl.RGBA32F, gl.FLOAT), floatTarget(state.side, state.side, gl.RGBA32F, gl.FLOAT)];
    sourceIndex = 0;

    const total = state.side * state.side;
    const data = new Float32Array(total * 4);
    const dt = 0.012;
    let point: [number, number, number] = [0.1, 0.1, 0.5];
    for (let i = 0; i < 4000; i++) point = orbitStep(point, dt);
    for (let i = 0; i < total; i++) {
      point = orbitStep(point, dt);
      if (point[0] * point[0] + point[1] * point[1] + point[2] * point[2] > 64) {
        point = [0.1, 0.1, 0.5];
      }
      const velocity = field(point[0], point[1], point[2]);
      data[i * 4] = point[0] + (Math.random() - 0.5) * 1e-3;
      data[i * 4 + 1] = point[1] + (Math.random() - 0.5) * 1e-3;
      data[i * 4 + 2] = point[2] + (Math.random() - 0.5) * 1e-3;
      data[i * 4 + 3] = Math.hypot(velocity[0], velocity[1], velocity[2]);
    }

    for (const target of states) {
      gl.bindTexture(gl.TEXTURE_2D, target.texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, state.side, state.side, gl.RGBA, gl.FLOAT, data);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const disposeTrails = () => {
    for (const target of trails) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    trails = [];
  };

  const buildTrails = (width: number, height: number) => {
    disposeTrails();
    trails = [floatTarget(width, height, gl.RGBA16F, gl.HALF_FLOAT), floatTarget(width, height, gl.RGBA16F, gl.HALF_FLOAT)];
    trailIndex = 0;
  };

  buildStates();
  buildTrails(Math.max(2, Math.round(surface.width * 0.75)), Math.max(2, Math.round(surface.height * 0.75)));

  const reset = () => {
    buildStates();
  };

  const countSwitch = selectControl({
    label: 'Partikel',
    values: COUNTS,
    value: String(state.count),
    onChange: (value) => {
      state.count = Number(value);
      buildStates();
    },
  });

  const speedControl = rangeControl({
    label: 'Tempo',
    min: 0.2,
    max: 4,
    step: 0.1,
    value: state.speed,
    format: (value) => `${value.toFixed(1)} ×`,
    onInput: (value) => {
      state.speed = value;
    },
  });

  const decayControl = rangeControl({
    label: 'Spurnachleuchten',
    min: 0.86,
    max: 0.995,
    step: 0.005,
    value: state.decay,
    format: (value) => value.toFixed(3).replace('.', ','),
    onInput: (value) => {
      state.decay = value;
    },
  });

  const exposureControl = rangeControl({
    label: 'Helligkeit',
    min: 0.4,
    max: 3,
    step: 0.05,
    value: state.exposure,
    format: (value) => value.toFixed(2).replace('.', ','),
    onInput: (value) => {
      state.exposure = value;
    },
  });

  const rotateToggle = toggleControl({
    label: 'Kamera drehen',
    checked: true,
    onChange: (checked) => {
      state.rotate = checked;
    },
  });

  const resetButton = el('button', { class: 'btn secondary small', type: 'button', on: { click: reset } }, 'Neu starten');

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Attraktor')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        countSwitch,
        speedControl.node,
        decayControl.node,
        exposureControl.node,
        el('div', null, rotateToggle),
        resetButton,
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Jedes Partikel integriert das Aizawa-Vektorfeld mit einem Runge-Kutta-Schritt zweiter Ordnung in einer Float-Textur. '
          + 'Danach wird es als additiv geblendeter Punkt in einen Spurenpuffer gezeichnet, der pro Bild um einen Faktor abklingt '
          + 'und anschließend tonemapped wird. Bei 262 144 Partikeln sind das 262 144 Zustandsaktualisierungen plus ein voller '
          + 'Bildschirm-Tonemapping-Pass — bei einer Million entsprechend mehr.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Regler für Tempo, Nachleuchten und Helligkeit verändern die Last direkt.'),
    ),
  );

  let last = performance.now();

  surface.start((_time, metrics) => {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
    last = now;
    state.clock += dt;
    if (state.rotate) state.angle += dt * 0.16;

    const width = Math.max(2, Math.round(surface.width * 0.75));
    const height = Math.max(2, Math.round(surface.height * 0.75));
    if (trails.length === 0 || trails[0].width !== width || trails[0].height !== height) {
      buildTrails(width, height);
    }

    // 1 — integrate the vector field
    const source = states[sourceIndex];
    const destination = states[1 - sourceIndex];
    gl.useProgram(programs.update);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(uniforms.update.uState, 0);
    gl.uniform2f(uniforms.update.uRes, state.side, state.side);
    gl.uniform1f(uniforms.update.uDt, Math.min(0.03, Math.max(0.002, dt * 1.1)) * state.speed);
    gl.uniform1f(uniforms.update.uTime, state.clock);
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
    gl.viewport(0, 0, state.side, state.side);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    sourceIndex = 1 - sourceIndex;

    // 2 — fade the trail
    const trailRead = trails[trailIndex];
    const trailWrite = trails[1 - trailIndex];
    gl.disable(gl.BLEND);
    gl.useProgram(programs.decay);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trailRead.texture);
    gl.uniform1i(uniforms.decay.uTrail, 0);
    gl.uniform1f(uniforms.decay.uDecay, state.decay);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailWrite.framebuffer);
    gl.viewport(0, 0, trailWrite.width, trailWrite.height);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3 — add the particles
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(programs.points);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, states[sourceIndex].texture);
    gl.uniform1i(uniforms.points.uState, 0);
    gl.uniform1f(uniforms.points.uSize, state.side);
    gl.uniform1f(uniforms.points.uAngle, state.angle);
    gl.uniform1f(uniforms.points.uZoom, 0.62);
    gl.uniform1f(uniforms.points.uBrightness, 0.012);
    gl.drawArrays(gl.POINTS, 0, state.side * state.side);
    gl.disable(gl.BLEND);
    trailIndex = 1 - trailIndex;

    // 4 — tonemap to the screen
    gl.useProgram(programs.display);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, trails[trailIndex].texture);
    gl.uniform1i(uniforms.display.uTrail, 0);
    gl.uniform2f(uniforms.display.uRes, surface.width, surface.height);
    gl.uniform1f(uniforms.display.uExposure, state.exposure);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    surface.hudSet('partikel', fmtInt(state.count));
    surface.hudSet('updates/s', `${((state.count * metrics.fps) / 1e6).toFixed(1)} M/s`);
    surface.hudSet('spur', `${trailWrite.width}×${trailWrite.height}`);
  });

  return {
    destroy() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      disposeStates();
      disposeTrails();
      for (const program of Object.values(programs)) gl.deleteProgram(program);
      surface.destroy();
    },
  };
}
