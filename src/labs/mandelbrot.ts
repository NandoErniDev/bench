/**
 * Mandelbrot Explorer — deep zoom without a precision ceiling.
 *
 * Shallow views run in plain float, which is cheap and plenty sharp up to a few
 * thousand times magnification. Past that the shader switches to 64-bit fixed
 * point: c is built from a 60-bit fraction field and the whole iteration
 * (z² + c) runs on exact integer arithmetic (imulExtended). Integers cannot be
 * rearranged by fast-math, cannot be contracted into FMA and never lose the
 * error term, so the per-pixel offset survives regardless of the GPU. The
 * double-float trick that used to be here relied on error-free transformations
 * and silently degraded to single precision on Apple silicon.
 */

import { el, fmtNum } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl, toggleControl } from '../ui/components';

/** Shared palette + smooth-escape colouring for both precision paths. */
const COLOR_GLSL = `
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

vec3 escapeColor(int iter, float m, int id) {
  if (m <= 4.0) return vec3(0.0);
  float smoothIter = float(iter) - log2(max(log2(m), 1e-6)) + 1.0;
  float t = fract(smoothIter / 42.0);
  float glow = 1.0 - smoothstep(0.0, 0.35, t);
  return palette(t, id) * (0.85 + 0.15 * glow);
}`;

const FLOAT_FRAG = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform int uMaxIter;
uniform int uPalette;
uniform int uAA;
out vec4 fragColor;
${COLOR_GLSL}

void main() {
  vec3 total = vec3(0.0);
  for (int s = 0; s < 16; s++) {
    if (s >= uAA) break;
    vec2 jitter = vec2(0.0);
    if (uAA > 1) {
      float fs = float(s);
      jitter = (vec2(mod(fs, 4.0), floor(fs * 0.25)) + 0.5) / 4.0 - 0.5;
    }
    vec2 uv = (gl_FragCoord.xy + jitter - 0.5 * uRes) / uRes.y;
    vec2 c = uCenter + uv * uScale;
    vec2 z = vec2(0.0);
    float m = 0.0;
    int iter = 0;
    for (int i = 0; i < 8192; i++) {
      if (i >= uMaxIter) { iter = uMaxIter; break; }
      z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
      m = dot(z, z);
      iter = i + 1;
      if (m > 4.0) break;
    }
    total += escapeColor(iter, m, uPalette);
  }
  fragColor = vec4(total / float(max(uAA, 1)), 1.0);
}`;

/**
 * 64-bit fixed point, Q2.60: value = integer / 2^60, range ±8 with a resolution
 * of 2^-60 ≈ 8.7e-19. Every operation below is exact integer arithmetic.
 */
/** Palette + 64-bit integer helpers, shared with the precision test. */
export const FIXED_HELPERS = `${COLOR_GLSL}

/* --- 64-bit helpers, low word first ---------------------------------------- */

uvec2 add64(uvec2 a, uvec2 b) {
  uint lo = a.x + b.x;
  uint carry = (lo < a.x) ? 1u : 0u;
  return uvec2(lo, a.y + b.y + carry);
}

uvec2 neg64(uvec2 a) {
  return uvec2(~a.x + 1u, ~a.y + ((a.x == 0u) ? 1u : 0u));
}

uvec2 sub64(uvec2 a, uvec2 b) {
  return add64(a, neg64(b));
}

/** 32×32 → 64 bit. Built from 16-bit halves; needs no integer multiply-high. */
uvec2 mul32(uint a, uint b) {
  uint al = a & 0xFFFFu;
  uint ah = a >> 16;
  uint bl = b & 0xFFFFu;
  uint bh = b >> 16;

  uint t0 = al * bl;
  uint t1 = ah * bl;
  uint t2 = al * bh;
  uint t3 = ah * bh;

  uint midLow = (t1 & 0xFFFFu) + (t2 & 0xFFFFu);
  uint midHigh = (t1 >> 16) + (t2 >> 16);

  uint lo = t0 + ((midLow & 0xFFFFu) << 16);
  uint carry = (lo < t0) ? 1u : 0u;
  uint hi = t3 + midHigh + (midLow >> 16) + carry;
  return uvec2(lo, hi);
}

/** (a * b) >> 60 on magnitudes — the whole 128-bit product is built, then shifted. */
uvec2 mulU(uvec2 a, uvec2 b) {
  uvec2 p00 = mul32(a.x, b.x);
  uvec2 p01 = mul32(a.x, b.y);
  uvec2 p10 = mul32(a.y, b.x);
  uvec2 p11 = mul32(a.y, b.y);

  uint w1 = p00.y;
  uint w2 = 0u;
  uint w3 = 0u;

  /* + (a.lo * b.hi) << 32 */
  uint t = w1 + p01.x;
  uint carry = (t < w1) ? 1u : 0u;
  w1 = t;
  t = w2 + p01.y;
  uint c2 = (t < w2) ? 1u : 0u;
  w2 = t;
  t = w2 + carry;
  uint c3 = (t < w2) ? 1u : 0u;
  w2 = t;
  w3 += c2 + c3;

  /* + (a.hi * b.lo) << 32 */
  t = w1 + p10.x;
  carry = (t < w1) ? 1u : 0u;
  w1 = t;
  t = w2 + p10.y;
  c2 = (t < w2) ? 1u : 0u;
  w2 = t;
  t = w2 + carry;
  c3 = (t < w2) ? 1u : 0u;
  w2 = t;
  w3 += c2 + c3;

  /* + (a.hi * b.hi) << 64 */
  t = w2 + p11.x;
  carry = (t < w2) ? 1u : 0u;
  w2 = t;
  w3 += p11.y + carry;

  /* bits 60..123 of the 128-bit product */
  return uvec2((w1 >> 28) | (w2 << 4), (w2 >> 28) | (w3 << 4));
}

/**
 * (a * b) >> 60. Two's-complement words multiplied as unsigned would put the
 * wrong bits into the high word, so the signs are split off first; |z| never
 * exceeds 2 here, so the magnitude product stays inside 64 bits.
 */
uvec2 mulQ60(uvec2 a, uvec2 b) {
  bool negative = ((a.y ^ b.y) >> 31) != 0u;
  uvec2 aa = ((a.y >> 31) != 0u) ? neg64(a) : a;
  uvec2 bb = ((b.y >> 31) != 0u) ? neg64(b) : b;
  uvec2 result = mulU(aa, bb);
  return negative ? neg64(result) : result;
}

/** float -> Q2.60 by moving the 24 mantissa bits into place (no cancellation). */
uvec2 floatToFixed(float f) {
  uvec2 r = uvec2(0u, 0u);
  if (f == 0.0) return r;
  uint bits = floatBitsToUint(f);
  uint mant = (bits & 0x007FFFFFu) | 0x00800000u;
  int s = int((bits >> 23) & 0xFFu) - 127 - 23 + 60;
  if (s >= 32) {
    int t = s - 32;
    r.y = (t >= 32) ? 0u : (mant << t);
  } else if (s >= 0) {
    r.x = mant << s;
    r.y = (s == 0) ? 0u : (mant >> (32 - s));
  } else {
    int t = -s;
    r.x = (t >= 32) ? 0u : (mant >> t);
  }
  if ((bits >> 31) == 1u) r = neg64(r);
  return r;
}

/** Top word only: plenty for the escape threshold and the smooth colouring. */
float topFloat(uvec2 v) {
  return float(int(v.y)) * 3.725290298461914e-9;
}
`;

export const FIXED_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform vec2 uRes;
uniform uvec2 uCenterRe;
uniform uvec2 uCenterIm;
uniform float uScale;
uniform int uMaxIter;
uniform int uPalette;
uniform int uAA;
out vec4 fragColor;
${FIXED_HELPERS}

void main() {
  vec3 total = vec3(0.0);
  for (int s = 0; s < 16; s++) {
    if (s >= uAA) break;
    vec2 jitter = vec2(0.0);
    if (uAA > 1) {
      float fs = float(s);
      jitter = (vec2(mod(fs, 4.0), floor(fs * 0.25)) + 0.5) / 4.0 - 0.5;
    }
    vec2 uv = (gl_FragCoord.xy + jitter - 0.5 * uRes) / uRes.y;

    uvec2 cr = add64(uCenterRe, floatToFixed(uv.x * uScale));
    uvec2 ci = add64(uCenterIm, floatToFixed(uv.y * uScale));

    uvec2 zr = uvec2(0u, 0u);
    uvec2 zi = uvec2(0u, 0u);
    int iter = 0;
    float m = 0.0;

    for (int i = 0; i < 8192; i++) {
      if (i >= uMaxIter) { iter = uMaxIter; break; }
      uvec2 zr2 = mulQ60(zr, zr);
      uvec2 zi2 = mulQ60(zi, zi);
      uvec2 zrzi = mulQ60(zr, zi);
      zr = add64(sub64(zr2, zi2), cr);
      zi = add64(add64(zrzi, zrzi), ci);
      iter = i + 1;
      float hr = topFloat(zr);
      float hi = topFloat(zi);
      m = hr * hr + hi * hi;
      if (m > 4.0) break;
    }

    total += escapeColor(iter, m, uPalette);
  }
  fragColor = vec4(total / float(max(uAA, 1)), 1.0);
}`;

const PALETTES = [
  { value: '0', label: 'Spektrum' },
  { value: '1', label: 'Eis' },
  { value: '2', label: 'Monochrom' },
  { value: '3', label: 'Moor' },
];

/* --- view centre as 120-bit fixed point (BigInt) --------------------------- */

const SCALE_BITS = 120;
const BASE_SCALE = 2.7;
/** Past this magnification the shader uses the exact 64-bit integer path. */
const FIXED_THRESHOLD = 800;

const toUnits = (value: number): bigint => BigInt(Math.round(value * 2 ** SCALE_BITS));
const unitsToNumber = (value: bigint): number => Number(value) / 2 ** SCALE_BITS;

const toFixed64 = (value: bigint): [number, number] => {
  const shifted = BigInt.asUintN(64, value >> 60n);
  return [Number(shifted & 0xffffffffn), Number(shifted >> 32n)];
};

const zoomLabel = (factor: number) =>
  factor < 1e5 ? `${fmtNum(factor, 1)}×` : `${factor.toExponential(2).replace('.', ',')}×`;

export function mountMandelbrot(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const floatProgram = compileProgram(gl, FS_TRIANGLE, FLOAT_FRAG, 'Mandelbrot (float)');
  const floatUniforms = uniformMap(gl, floatProgram, ['uRes', 'uCenter', 'uScale', 'uMaxIter', 'uPalette', 'uAA']);
  const fixedProgram = compileProgram(gl, FS_TRIANGLE, FIXED_FRAG, 'Mandelbrot (64-Bit)');
  const fixedUniforms = uniformMap(gl, fixedProgram, [
    'uRes',
    'uCenterRe',
    'uCenterIm',
    'uScale',
    'uMaxIter',
    'uPalette',
    'uAA',
  ]);

  const view = {
    re: toUnits(-0.65),
    im: 0n,
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
    return { ux, uy };
  };

  const panBy = (dxUv: number, dyUv: number) => {
    view.re -= toUnits(dxUv * view.scale);
    view.im -= toUnits(dyUv * view.scale);
  };

  const zoomAround = (clientX: number, clientY: number, factor: number) => {
    const { ux, uy } = pointAt(clientX, clientY);
    const before = view.scale;
    // No lower clamp: the integer path keeps resolving detail as far as the
    // 60-bit fraction field reaches.
    const after = Math.min(8, before * factor);
    const shrink = before - after;
    view.re += toUnits(ux * shrink);
    view.im += toUnits(uy * shrink);
    view.scale = after;
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
      panBy(-(event.clientX - previous.x) / rect.height, (event.clientY - previous.y) / rect.height);
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
      panBy(-(midpoint.x - lastMidpoint.x) / rect.height, (midpoint.y - lastMidpoint.y) / rect.height);
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
    max: 8192,
    step: 32,
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
    max: 16,
    step: 1,
    value: view.aa,
    format: (value) => String(value),
    onInput: (value) => {
      view.aa = value;
    },
  });

  const resolutionControl = rangeControl({
    label: 'Renderauflösung',
    min: 0.25,
    max: 3,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const reset = () => {
    view.re = toUnits(-0.65);
    view.im = 0n;
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
        'Bis rund 800-fach rechnet jedes Pixel mit einfachem float — schnell und ausreichend genau. '
          + 'Darüber schaltet der Shader auf 64-Bit-Festkomma mit 60 Nachkommabits um: die Iteration läuft dann komplett in exakter '
          + 'Ganzzahlarithmetik (drei 64×64-Bit-Multiplikationen pro Schritt). Ganzzahlen kann kein Compiler umsortieren oder in '
          + 'Fused-Multiply-Add zusammenziehen, deshalb bleibt das Pixelgitter auch dort scharf, wo Doppel-Float-Shader auf '
          + 'Apple-GPUs stillschweigend auf einfache Genauigkeit zurückfallen.',
      ),
      el(
        'p',
        { class: 'footnote', style: 'margin-top:8px' },
        'Die Genauigkeitsgrenze liegt bei rund 10¹⁵-facher Vergrößerung — danach ist ein Pixel kleiner als 2⁻⁶⁰, '
          + 'also feiner als die Festkomma-Auflösung selbst.',
      ),
      el(
        'p',
        { class: 'footnote', style: 'margin-top:8px' },
        'Ziehen: verschieben · Mausrad / Pinch: zoomen · Doppelklick: hineinzoomen',
      ),
    ),
  );

  const effectiveIter = () => {
    if (!view.autoIter) return Math.min(8192, Math.round(view.iter));
    const depth = Math.log2(Math.max(1, BASE_SCALE / view.scale));
    return Math.min(8192, Math.round(view.iter + 110 * depth));
  };

  surface.start((_time, metrics) => {
    const { width, height } = surface;
    const iterations = effectiveIter();
    const zoom = BASE_SCALE / view.scale;
    const exact = zoom > FIXED_THRESHOLD;

    gl.viewport(0, 0, width, height);
    if (exact) {
      gl.useProgram(fixedProgram);
      const [reLo, reHi] = toFixed64(view.re);
      const [imLo, imHi] = toFixed64(view.im);
      gl.uniform2f(fixedUniforms.uRes, width, height);
      gl.uniform2ui(fixedUniforms.uCenterRe, reLo, reHi);
      gl.uniform2ui(fixedUniforms.uCenterIm, imLo, imHi);
      gl.uniform1f(fixedUniforms.uScale, view.scale);
      gl.uniform1i(fixedUniforms.uMaxIter, iterations);
      gl.uniform1i(fixedUniforms.uPalette, view.palette);
      gl.uniform1i(fixedUniforms.uAA, view.aa);
    } else {
      gl.useProgram(floatProgram);
      gl.uniform2f(floatUniforms.uRes, width, height);
      gl.uniform2f(floatUniforms.uCenter, unitsToNumber(view.re), unitsToNumber(view.im));
      gl.uniform1f(floatUniforms.uScale, view.scale);
      gl.uniform1i(floatUniforms.uMaxIter, iterations);
      gl.uniform1i(floatUniforms.uPalette, view.palette);
      gl.uniform1i(floatUniforms.uAA, view.aa);
    }

    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    surface.hudSet('iter', String(iterations));
    surface.hudSet('zoom', zoomLabel(zoom));
    surface.hudSet('präzision', exact ? '64 Bit Festkomma' : 'float');
    surface.hudSet('px/s', `${fmtNum((width * height * view.aa * metrics.fps) / 1e6, 1)} Mpx/s`);
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('pointercancel', onPointerUp);
      surface.canvas.removeEventListener('wheel', onWheel);
      surface.canvas.removeEventListener('dblclick', onDoubleClick);
      gl.deleteProgram(floatProgram);
      gl.deleteProgram(fixedProgram);
      surface.destroy();
    },
  };
}
