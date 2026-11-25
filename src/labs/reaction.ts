/**
 * Reaktions-Diffusion — Gray-Scott on the GPU. Two chemicals diffuse through
 * each other and react; the feedback loop grows coral, worms and cells. Every
 * frame runs N full-grid passes, so the step count is a direct cost knob.
 */

import { el } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl } from '../ui/components';

const SEED_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uSeed;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float a = 1.0;
  float b = 0.0;

  vec2 d = uv - 0.5;
  if (dot(d, d) < 0.0045) { b = 1.0; }

  vec2 g = uv * 10.0;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(cell + uSeed);
  if (h > 0.55 && dot(f, f) < 0.10) { b = 1.0; }

  fragColor = vec4(a, b, 0.0, 1.0);
}`;

const UPDATE_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uFeed;
uniform float uKill;
uniform float uRate;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 c = texture(uState, uv).rg;

  vec2 lap = c * -1.0;
  lap += texture(uState, uv + vec2(-uTexel.x, 0.0)).rg * 0.2;
  lap += texture(uState, uv + vec2(uTexel.x, 0.0)).rg * 0.2;
  lap += texture(uState, uv + vec2(0.0, -uTexel.y)).rg * 0.2;
  lap += texture(uState, uv + vec2(0.0, uTexel.y)).rg * 0.2;
  lap += texture(uState, uv + vec2(-uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture(uState, uv + vec2(uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture(uState, uv + vec2(-uTexel.x, uTexel.y)).rg * 0.05;
  lap += texture(uState, uv + vec2(uTexel.x, uTexel.y)).rg * 0.05;

  float reaction = c.r * c.g * c.g;

  float a = c.r + (lap.r - reaction + uFeed * (1.0 - c.r)) * uRate;
  float b = c.g + (lap.g * 0.5 + reaction - (uKill + uFeed) * c.g) * uRate;

  fragColor = vec4(clamp(a, 0.0, 1.0), clamp(b, 0.0, 1.0), 0.0, 1.0);
}`;

const SPLAT_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uPoint;
uniform float uRadius;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uState, 0));
  vec2 d = uv - uPoint;
  float falloff = exp(-dot(d, d) / uRadius);
  vec4 base = texture(uState, uv);
  fragColor = vec4(base.r - 0.6 * falloff, base.g + falloff, 0.0, 1.0);
}`;

const DISPLAY_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uRes;
uniform float uTexel;
uniform int uPalette;
out vec4 fragColor;

vec3 ramp(float v, int id) {
  vec3 bg = vec3(0.035, 0.04, 0.048);
  if (id == 1) {
    vec3 c1 = vec3(0.97, 0.40, 0.34);
    vec3 c2 = vec3(0.99, 0.84, 0.58);
    vec3 c3 = vec3(0.55, 0.70, 0.98);
    vec3 col = mix(bg, c3, smoothstep(0.0, 0.34, v));
    col = mix(col, c1, smoothstep(0.34, 0.75, v));
    return mix(col, c2, smoothstep(0.75, 1.25, v));
  }
  if (id == 2) {
    vec3 c1 = vec3(0.5, 0.56, 0.68);
    vec3 c2 = vec3(0.97, 0.98, 1.0);
    vec3 col = mix(bg, c1, smoothstep(0.0, 0.55, v));
    return mix(col, c2, smoothstep(0.55, 1.3, v));
  }
  vec3 c1 = vec3(0.13, 0.62, 0.63);
  vec3 c2 = vec3(0.99, 0.62, 0.20);
  vec3 c3 = vec3(0.99, 0.95, 0.86);
  vec3 col = mix(bg, c1, smoothstep(0.0, 0.30, v));
  col = mix(col, c2, smoothstep(0.30, 0.72, v));
  return mix(col, c3, smoothstep(0.72, 1.3, v));
}

/* RGBA32F is not filterable in WebGL2, so the sim grid is sampled nearest and
   interpolated by hand when it is blown up to the screen. */
float sampleB(vec2 uv) {
  vec2 size = vec2(textureSize(uState, 0));
  vec2 pos = uv * size - 0.5;
  vec2 base = floor(pos);
  vec2 f = clamp(pos - base, 0.0, 1.0);
  vec2 texel = 1.0 / size;
  float b00 = texture(uState, (base + vec2(0.5, 0.5)) * texel).g;
  float b10 = texture(uState, (base + vec2(1.5, 0.5)) * texel).g;
  float b01 = texture(uState, (base + vec2(0.5, 1.5)) * texel).g;
  float b11 = texture(uState, (base + vec2(1.5, 1.5)) * texel).g;
  return mix(mix(b00, b10, f.x), mix(b01, b11, f.x), f.y);
}

void main() {
  vec2 res = uRes;
  vec2 uv = (gl_FragCoord.xy - 0.5 * res) / min(res.x, res.y) + 0.5;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    fragColor = vec4(0.02, 0.022, 0.03, 1.0);
    return;
  }

  float b = sampleB(uv);
  float grad = length(vec2(
    sampleB(uv + vec2(uTexel, 0.0)) - sampleB(uv - vec2(uTexel, 0.0)),
    sampleB(uv + vec2(0.0, uTexel)) - sampleB(uv - vec2(0.0, uTexel))
  ));

  float v = clamp(b * 3.1, 0.0, 1.4);
  vec3 col = ramp(v, uPalette);
  col *= 0.86 + 1.5 * clamp(grad, 0.0, 0.35);

  vec2 p = uv - 0.5;
  col *= 1.0 - 0.45 * dot(p, p);
  col += vec3(0.004);
  fragColor = vec4(col, 1.0);
}`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

const PALETTES = [
  { value: '0', label: 'Bernstein' },
  { value: '1', label: 'Koralle' },
  { value: '2', label: 'Mond' },
];

export function mountReaction(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const floatRender = gl.getExtension('EXT_color_buffer_float');
  if (!floatRender) {
    surface.destroy();
    throw new Error('Die Reaktions-Diffusion braucht Float-Renderziele (EXT_color_buffer_float).');
  }

  const programs = {
    seed: compileProgram(gl, FS_TRIANGLE, SEED_FS, 'RD-Start'),
    update: compileProgram(gl, FS_TRIANGLE, UPDATE_FS, 'RD-Schritt'),
    splat: compileProgram(gl, FS_TRIANGLE, SPLAT_FS, 'RD-Impuls'),
    display: compileProgram(gl, FS_TRIANGLE, DISPLAY_FS, 'RD-Anzeige'),
  };
  const uniforms = {
    seed: uniformMap(gl, programs.seed, ['uRes', 'uSeed']),
    update: uniformMap(gl, programs.update, ['uState', 'uTexel', 'uFeed', 'uKill', 'uRate']),
    splat: uniformMap(gl, programs.splat, ['uState', 'uPoint', 'uRadius']),
    display: uniformMap(gl, programs.display, ['uState', 'uRes', 'uTexel', 'uPalette']),
  };

  const state = { grid: 512, steps: 22, feed: 0.055, kill: 0.062, palette: 0, seed: 1 };
  let allocated: Target[] = [];
  let ping: Target;
  let pong: Target;

  const createTarget = (size: number): Target => {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Reaktions-Ziel konnte nicht erstellt werden');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, size, size, 0, gl.RGBA, gl.FLOAT, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Float-Framebuffer für die Reaktions-Diffusion ist unvollständig.');
    }
    const target: Target = { texture, framebuffer };
    allocated.push(target);
    return target;
  };

  const seed = () => {
    state.seed = Math.random() * 100;
    gl.disable(gl.BLEND);
    gl.useProgram(programs.seed);
    gl.uniform2f(uniforms.seed.uRes, state.grid, state.grid);
    gl.uniform1f(uniforms.seed.uSeed, state.seed);
    gl.bindFramebuffer(gl.FRAMEBUFFER, ping.framebuffer);
    gl.viewport(0, 0, state.grid, state.grid);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pong.framebuffer);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  const allocate = () => {
    for (const target of allocated) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    allocated = [];
    ping = createTarget(state.grid);
    pong = createTarget(state.grid);
    seed();
  };

  allocate();

  const splat = (x: number, y: number, radius = 0.0006) => {
    gl.useProgram(programs.splat);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ping.texture);
    gl.uniform1i(uniforms.splat.uState, 0);
    gl.uniform2f(uniforms.splat.uPoint, x, y);
    gl.uniform1f(uniforms.splat.uRadius, radius);
    gl.bindFramebuffer(gl.FRAMEBUFFER, pong.framebuffer);
    gl.viewport(0, 0, state.grid, state.grid);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const swap = ping;
    ping = pong;
    pong = swap;
  };

  const pointers = new Map<number, { x: number; y: number }>();

  const toSim = (clientX: number, clientY: number) => {
    const rect = surface.canvas.getBoundingClientRect();
    const uv = {
      x: (clientX - rect.left) / Math.max(1, rect.width),
      y: 1 - (clientY - rect.top) / Math.max(1, rect.height),
    };
    const side = Math.min(rect.width, rect.height);
    return {
      x: 0.5 + (uv.x * rect.width - rect.width / 2) / side,
      y: 0.5 + (uv.y * rect.height - rect.height / 2) / side,
    };
  };

  const onPointerDown = (event: PointerEvent) => {
    surface.canvas.setPointerCapture(event.pointerId);
    const point = toSim(event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    splat(point.x, point.y, 0.0016);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    const point = toSim(event.clientX, event.clientY);
    pointers.set(event.pointerId, point);
    splat(point.x, point.y, 0.0004);
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);

  const gridControl = selectControl({
    label: 'Simulationsgitter',
    values: [
      { value: '256', label: '256 × 256' },
      { value: '512', label: '512 × 512' },
      { value: '768', label: '768 × 768' },
      { value: '1024', label: '1024 × 1024' },
      { value: '1536', label: '1536 × 1536' },
      { value: '2048', label: '2048 × 2048' },
      { value: '3072', label: '3072 × 3072' },
    ],
    value: String(state.grid),
    onChange: (value) => {
      state.grid = Math.min(Number(value), gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
      allocate();
    },
  });

  const stepsControl = rangeControl({
    label: 'Schritte pro Bild',
    min: 1,
    max: 256,
    step: 1,
    value: state.steps,
    format: (value) => `${value} ×`,
    onInput: (value) => {
      state.steps = value;
    },
  });

  const feedControl = rangeControl({
    label: 'Zufuhr (Feed)',
    min: 0.01,
    max: 0.09,
    step: 0.0005,
    value: state.feed,
    format: (value) => value.toFixed(4).replace('.', ','),
    onInput: (value) => {
      state.feed = value;
    },
  });

  const killControl = rangeControl({
    label: 'Abbau (Kill)',
    min: 0.03,
    max: 0.075,
    step: 0.0005,
    value: state.kill,
    format: (value) => value.toFixed(4).replace('.', ','),
    onInput: (value) => {
      state.kill = value;
    },
  });

  const paletteControl = selectControl({
    label: 'Farbskala',
    values: PALETTES,
    value: '0',
    onChange: (value) => {
      state.palette = Number(value);
    },
  });

  const reseed = el(
    'button',
    {
      class: 'btn secondary small',
      type: 'button',
      on: {
        click: () => {
          seed();
        },
      },
    },
    'Neu impfen',
  );

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Reaktion')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        gridControl,
        stepsControl.node,
        feedControl.node,
        killControl.node,
        paletteControl,
        reseed,
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Jeder Schritt löst die Gray-Scott-Gleichungen auf dem kompletten Raster: neun Texturlesungen für den Laplace-Operator, '
          + 'Reaktion, Diffusion und zwei Schreibvorgänge pro Texel. Bei 1024² und 14 Schritten sind das rund 14,7 Millionen '
          + 'Texel-Aktualisierungen pro Bild — und das Muster wächst nur so schnell, wie die GPU diese Schritte schafft.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Klicken oder ziehen: neue Chemikalie einimpfen'),
    ),
  );

  surface.start((_time, metrics) => {
    const texel = 1 / state.grid;

    for (let i = 0; i < state.steps; i++) {
      gl.useProgram(programs.update);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, ping.texture);
      gl.uniform1i(uniforms.update.uState, 0);
      gl.uniform2f(uniforms.update.uTexel, texel, texel);
      gl.uniform1f(uniforms.update.uFeed, state.feed);
      gl.uniform1f(uniforms.update.uKill, state.kill);
      gl.uniform1f(uniforms.update.uRate, 1.0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, pong.framebuffer);
      gl.viewport(0, 0, state.grid, state.grid);
      gl.bindVertexArray(surface.vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      const swap = ping;
      ping = pong;
      pong = swap;
    }

    gl.useProgram(programs.display);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ping.texture);
    gl.uniform1i(uniforms.display.uState, 0);
    gl.uniform2f(uniforms.display.uRes, surface.width, surface.height);
    gl.uniform1f(uniforms.display.uTexel, texel);
    gl.uniform1i(uniforms.display.uPalette, state.palette);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    surface.hudSet('raster', `${state.grid}²`);
    surface.hudSet('schritte', `${state.steps}/Bild`);
    surface.hudSet(
      'MZ/s',
      `${((state.grid * state.grid * state.steps * 2 * metrics.fps) / 1e6).toFixed(1)} MZ/s`,
    );
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('pointercancel', onPointerUp);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const target of allocated) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
      for (const program of Object.values(programs)) gl.deleteProgram(program);
      surface.destroy();
    },
  };
}
