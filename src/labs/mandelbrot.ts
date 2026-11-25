/**
 * Mandelbrot Explorer — deep zoom with double-float precision in the fragment
 * shader. Every pixel runs the iteration in a 48-bit mantissa pair, so the view
 * keeps resolving detail thousands of times deeper than plain float, and the
 * iteration count scales automatically with the zoom level.
 */

import { el, fmtNum } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl, toggleControl } from '../ui/components';

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uCenterHi;
uniform vec2 uCenterLo;
uniform float uScale;
uniform int uMaxIter;
uniform int uPalette;
uniform int uAA;
out vec4 fragColor;

vec3 palette(float t, int id) {
  if (id == 1) {
    return vec3(0.06 + 0.9 * t, 0.3 + 0.55 * t * t, 0.6 + 0.4 * t);
  }
  if (id == 2) {
    return vec3(0.9 * t, 0.9 * t, 0.92 * t);
  }
  if (id == 3) {
    return vec3(0.12 + 0.65 * t, 0.5 + 0.38 * (1.0 - t), 0.32 + 0.35 * t * t);
  }
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.18, 0.36)));
}

/* --- double-float (two float32 per number, ~48 bit mantissa) --------------- */

vec2 twoSum(float a, float b) {
  float s = a + b;
  float bb = s - a;
  return vec2(s, (a - (s - bb)) + (b - bb));
}

vec2 quickTwoSum(float a, float b) {
  float s = a + b;
  return vec2(s, b - (s - a));
}

vec2 twoProd(float a, float b) {
  float p = a * b;
  float ca = 4097.0 * a;
  float ah = ca - (ca - a);
  float al = a - ah;
  float cb = 4097.0 * b;
  float bh = cb - (cb - b);
  float bl = b - bh;
  return vec2(p, ((ah * bh - p) + ah * bl + al * bh) + al * bl);
}

vec2 dadd(vec2 a, vec2 b) {
  vec2 s = twoSum(a.x, b.x);
  float e = s.y + a.y + b.y;
  return quickTwoSum(s.x, e);
}

vec2 dsub(vec2 a, vec2 b) {
  return dadd(a, vec2(-b.x, -b.y));
}

vec2 dmul(vec2 a, vec2 b) {
  vec2 p = twoProd(a.x, b.x);
  p.y += a.x * b.y + a.y * b.x;
  return quickTwoSum(p.x, p.y);
}

vec3 shade(vec2 uv) {
  vec2 cx = dadd(vec2(uCenterHi.x, uCenterLo.x), dmul(vec2(uv.x, 0.0), vec2(uScale, 0.0)));
  vec2 cy = dadd(vec2(uCenterHi.y, uCenterLo.y), dmul(vec2(uv.y, 0.0), vec2(uScale, 0.0)));

  vec2 zx = vec2(0.0);
  vec2 zy = vec2(0.0);
  float m = 0.0;
  int iter = 0;

  for (int i = 0; i < 4096; i++) {
    if (i >= uMaxIter) { iter = uMaxIter; break; }
    vec2 x2 = dmul(zx, zx);
    vec2 y2 = dmul(zy, zy);
    vec2 xy = dmul(zx, zy);
    zx = dadd(dsub(x2, y2), cx);
    zy = dadd(dmul(vec2(2.0, 0.0), xy), cy);
    m = zx.x * zx.x + zy.x * zy.x;
    iter = i;
    if (m > 256.0) break;
  }

  if (m <= 256.0) return vec3(0.0);

  float smoothIter = float(iter) - log2(log2(m)) + 6.0;
  float t = fract(smoothIter / 42.0);
  float glow = 1.0 - smoothstep(0.0, 0.35, t);
  return palette(t, uPalette) * (0.85 + 0.15 * glow);
}

void main() {
  vec3 total = vec3(0.0);
  for (int s = 0; s < 4; s++) {
    if (s >= uAA) break;
    vec2 jitter = vec2(0.0);
    if (uAA > 1) {
      float fs = float(s);
      jitter = vec2(mod(fs, 2.0), floor(fs * 0.5)) * 0.5 - 0.25;
    }
    vec2 uv = (gl_FragCoord.xy + jitter - 0.5 * uRes) / uRes.y;
    total += shade(uv);
  }
  fragColor = vec4(total / float(max(uAA, 1)), 1.0);
}`;

const PALETTES = [
  { value: '0', label: 'Spektrum' },
  { value: '1', label: 'Eis' },
  { value: '2', label: 'Monochrom' },
  { value: '3', label: 'Moor' },
];

/* --- double-double helpers for the view centre (two float64 per number) ---- */

interface Double {
  hi: number;
  lo: number;
}

const SPLITTER = 134217729;

const fromNumber = (value: number): Double => ({ hi: value, lo: 0 });

const quickTwoSumD = (a: number, b: number): [number, number] => {
  const sum = a + b;
  return [sum, b - (sum - a)];
};

const splitD = (a: number): [number, number] => {
  const c = SPLITTER * a;
  const hi = c - (c - a);
  return [hi, a - hi];
};

const twoProdD = (a: number, b: number): [number, number] => {
  const product = a * b;
  const [ah, al] = splitD(a);
  const [bh, bl] = splitD(b);
  return [product, (ah * bh - product + ah * bl + al * bh) + al * bl];
};

const add = (a: Double, b: Double): Double => {
  const sum = a.hi + b.hi;
  const tail = a.lo + b.lo;
  const total = sum + tail;
  return { hi: total, lo: tail - (total - sum) };
};

const sub = (a: Double, b: Double): Double => add(a, { hi: -b.hi, lo: -b.lo });

const mul = (a: Double, b: Double): Double => {
  const [product, error] = twoProdD(a.hi, b.hi);
  const correction = error + (a.hi * b.lo + a.lo * b.hi);
  const total = product + correction;
  return { hi: total, lo: correction - (total - product) };
};

const scale = (a: Double, factor: number): Double => mul(a, fromNumber(factor));

const zoomLabel = (factor: number) => (factor < 1e5 ? `${fmtNum(factor, 1)}×` : `${factor.toExponential(2)}×`);

export function mountMandelbrot(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const program = compileProgram(gl, FS_TRIANGLE, FRAG, 'Mandelbrot');
  const uniforms = uniformMap(gl, program, [
    'uRes',
    'uCenterHi',
    'uCenterLo',
    'uScale',
    'uMaxIter',
    'uPalette',
    'uAA',
  ]);

  const BASE_SCALE = 2.7;
  const view = {
    re: fromNumber(-0.65),
    im: fromNumber(0),
    scale: BASE_SCALE,
    iter: 512,
    palette: 0,
    aa: 2,
    autoIter: true,
  };

  const pointAt = (clientX: number, clientY: number) => {
    const rect = surface.canvas.getBoundingClientRect();
    const ux = (clientX - rect.left - rect.width / 2) / rect.height;
    const uy = -(clientY - rect.top - rect.height / 2) / rect.height;
    return {
      re: add(view.re, scale(fromNumber(ux), view.scale)),
      im: add(view.im, scale(fromNumber(uy), view.scale)),
    };
  };

  const zoomAround = (clientX: number, clientY: number, factor: number) => {
    const before = pointAt(clientX, clientY);
    // No lower clamp: the double-float pipeline keeps resolving detail far past
    // the point where a plain float view would stop moving.
    view.scale = Math.min(8, view.scale * factor);
    const after = pointAt(clientX, clientY);
    view.re = add(view.re, sub(before.re, after.re));
    view.im = add(view.im, sub(before.im, after.im));
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let lastPinchDistance = 0;
  let lastMidpoint = { x: 0, y: 0 };

  const onPointerDown = (event: PointerEvent) => {
    surface.canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      lastPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
      lastMidpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      const rect = surface.canvas.getBoundingClientRect();
      view.re = add(view.re, scale(fromNumber(-(event.clientX - previous.x) / rect.height), view.scale));
      view.im = add(view.im, scale(fromNumber((event.clientY - previous.y) / rect.height), view.scale));
      return;
    }

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastPinchDistance > 0) {
        zoomAround(midpoint.x, midpoint.y, lastPinchDistance / Math.max(1, distance));
      }
      const rect = surface.canvas.getBoundingClientRect();
      view.re = add(view.re, scale(fromNumber(-(midpoint.x - lastMidpoint.x) / rect.height), view.scale));
      view.im = add(view.im, scale(fromNumber((midpoint.y - lastMidpoint.y) / rect.height), view.scale));
      lastPinchDistance = distance;
      lastMidpoint = midpoint;
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) lastPinchDistance = 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const factor = Math.exp(Math.max(-120, Math.min(120, event.deltaY)) * 0.0022);
    zoomAround(event.clientX, event.clientY, factor);
  };

  const onDoubleClick = (event: MouseEvent) => {
    zoomAround(event.clientX, event.clientY, 0.35);
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });
  surface.canvas.addEventListener('dblclick', onDoubleClick);

  // ------------------------------------------------------------- controls
  const iterationControl = rangeControl({
    label: 'Basis-Iterationen',
    min: 64,
    max: 2048,
    step: 16,
    value: view.iter,
    format: (value) => String(value),
    onInput: (value) => {
      view.iter = value;
    },
  });

  const autoIterToggle = toggleControl({
    label: 'Iterationen mit dem Zoom erhöhen',
    checked: true,
    onChange: (checked) => {
      view.autoIter = checked;
    },
  });

  const paletteControl = selectControl({
    label: 'Farbpalette',
    values: PALETTES,
    value: '0',
    onChange: (value) => {
      view.palette = Number(value);
    },
  });

  const aaControl = rangeControl({
    label: 'Samples pro Pixel',
    min: 1,
    max: 4,
    step: 1,
    value: view.aa,
    format: (value) => String(value),
    onInput: (value) => {
      view.aa = value;
    },
  });

  const resolutionControl = rangeControl({
    label: 'Renderauflösung',
    min: 0.4,
    max: 2,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const reset = () => {
    view.re = fromNumber(-0.65);
    view.im = fromNumber(0);
    view.scale = BASE_SCALE;
    view.iter = 512;
    view.palette = 0;
    view.aa = 2;
    iterationControl.set(view.iter);
    aaControl.set(view.aa);
    surface.setScale(1);
    resolutionControl.set(1);
    const select = paletteControl.querySelector('select');
    if (select) select.value = '0';
  };

  const resetButton = el(
    'button',
    { class: 'btn secondary small', type: 'button', on: { click: reset } },
    'Ansicht zurücksetzen',
  );

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Darstellung')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        iterationControl.node,
        el('div', null, autoIterToggle),
        aaControl.node,
        paletteControl,
        resolutionControl.node,
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
        'Jedes Pixel rechnet die Iteration in doppelter Gleitkommapräzision im Fragment-Shader — rund vier Mal so viel Arbeit pro Iteration wie mit einfachem float. '
          + 'Beim Hineinzoomen steigt die Iterationszahl automatisch mit, weil die Struktur an der Grenze immer feiner wird. '
          + 'Kann dein Gerät die Last nicht mehr halten, sinkt die Bildrate sichtbar.',
      ),
      el(
        'p',
        { class: 'footnote', style: 'margin-top:8px' },
        'Ziehen: verschieben · Mausrad / Pinch: zoomen · Doppelklick: hineinzoomen',
      ),
    ),
  );

  const effectiveIter = () => {
    if (!view.autoIter) return Math.min(4096, Math.round(view.iter));
    const depth = Math.log2(Math.max(1, BASE_SCALE / view.scale));
    return Math.min(4096, Math.round(view.iter + 110 * depth));
  };

  surface.start((_time, metrics) => {
    const { width, height } = surface;
    const iterations = effectiveIter();
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, width, height);
    gl.uniform2f(uniforms.uCenterHi, view.re.hi, view.im.hi);
    gl.uniform2f(uniforms.uCenterLo, view.re.lo, view.im.lo);
    gl.uniform1f(uniforms.uScale, view.scale);
    gl.uniform1i(uniforms.uMaxIter, iterations);
    gl.uniform1i(uniforms.uPalette, view.palette);
    gl.uniform1i(uniforms.uAA, view.aa);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    surface.hudSet('iter', String(iterations));
    surface.hudSet('zoom', zoomLabel(BASE_SCALE / view.scale));
    surface.hudSet('px/s', `${fmtNum((width * height * view.aa * metrics.fps) / 1e6, 1)} Mpx/s`);
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('wheel', onWheel);
      surface.canvas.removeEventListener('dblclick', onDoubleClick);
      gl.deleteProgram(program);
      surface.destroy();
    },
  };
}
