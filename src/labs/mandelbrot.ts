/**
 * Mandelbrot Explorer — fully computed per pixel in a fragment shader.
 * Zoom, pan, iteration count, palette and render resolution are adjustable;
 * the HUD shows real frame times and the resulting pixel throughput.
 */

import { el, fmtNum, fmtInt, clamp } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl } from '../ui/components';

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform vec2 uCenter;
uniform float uScale;
uniform int uMaxIter;
uniform int uPalette;
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

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec2 c = uCenter + uv * uScale;
  vec2 z = vec2(0.0);
  vec2 dz = vec2(0.0);
  int iter = 0;
  float m = 0.0;
  for (int i = 0; i < 2048; i++) {
    if (i >= uMaxIter) { iter = uMaxIter; break; }
    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
    m = dot(z, z);
    iter = i;
    if (m > 256.0) break;
  }
  if (m <= 256.0) {
    fragColor = vec4(0.015, 0.015, 0.02, 1.0);
    return;
  }
  float smoothIter = float(iter) - log2(log2(m)) + 6.0;
  float t = fract(smoothIter / 42.0);
  vec3 col = palette(t, uPalette);
  float glow = 1.0 - smoothstep(0.0, 0.35, t);
  fragColor = vec4(col * (0.85 + 0.15 * glow), 1.0);
}`;

const PALETTES = [
  { value: '0', label: 'Spektrum' },
  { value: '1', label: 'Eis' },
  { value: '2', label: 'Monochrom' },
  { value: '3', label: 'Moor' },
];

export function mountMandelbrot(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const program = compileProgram(gl, FS_TRIANGLE, FRAG, 'Mandelbrot');
  const uniforms = uniformMap(gl, program, ['uRes', 'uCenter', 'uScale', 'uMaxIter', 'uPalette']);

  const view = { cx: -0.65, cy: 0, scale: 2.7, iter: 256, palette: 0 };

  const complexAt = (clientX: number, clientY: number, scale = view.scale) => {
    const rect = surface.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const ux = (px - rect.width / 2) / rect.height;
    const uy = -(py - rect.height / 2) / rect.height;
    return { x: view.cx + ux * scale, y: view.cy + uy * scale };
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
      view.cx -= ((event.clientX - previous.x) / rect.height) * view.scale;
      view.cy += ((event.clientY - previous.y) / rect.height) * view.scale;
      return;
    }

    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (lastPinchDistance > 0) {
        const before = complexAt(midpoint.x, midpoint.y);
        view.scale = clamp(view.scale * (lastPinchDistance / Math.max(1, distance)), 1e-9, 8);
        const after = complexAt(midpoint.x, midpoint.y);
        view.cx += before.x - after.x;
        view.cy += before.y - after.y;
      }
      const rect = surface.canvas.getBoundingClientRect();
      view.cx -= ((midpoint.x - lastMidpoint.x) / rect.height) * view.scale;
      view.cy += ((midpoint.y - lastMidpoint.y) / rect.height) * view.scale;
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
    const before = complexAt(event.clientX, event.clientY);
    const factor = Math.exp(clamp(event.deltaY, -120, 120) * 0.0022);
    view.scale = clamp(view.scale * factor, 1e-9, 8);
    const after = complexAt(event.clientX, event.clientY);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
  };

  const onDoubleClick = (event: MouseEvent) => {
    const before = complexAt(event.clientX, event.clientY);
    view.scale = clamp(view.scale * 0.35, 1e-9, 8);
    const after = complexAt(event.clientX, event.clientY);
    view.cx += before.x - after.x;
    view.cy += before.y - after.y;
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });
  surface.canvas.addEventListener('dblclick', onDoubleClick);

  // ------------------------------------------------------------- controls
  const iterationControl = rangeControl({
    label: 'Iterationen',
    min: 32,
    max: 1024,
    step: 8,
    value: view.iter,
    format: (value) => String(value),
    onInput: (value) => {
      view.iter = value;
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

  const resolutionControl = rangeControl({
    label: 'Renderauflösung',
    min: 0.4,
    max: 1.6,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const reset = () => {
    view.cx = -0.65;
    view.cy = 0;
    view.scale = 2.7;
    view.iter = 256;
    view.palette = 0;
    iterationControl.set(view.iter);
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
      el('div', { class: 'stack', style: 'gap:14px' }, iterationControl.node, paletteControl, resolutionControl.node, resetButton),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Jedes Pixel durchläuft die Mandelbrot-Iteration im Fragment-Shader. Die HUD-Werte zeigen die reale Frame-Zeit und den daraus resultierenden Pixeldurchsatz. '
          + 'Höhere Iterationszahlen oder eine größere Renderauflösung erhöhen die Rechenlast direkt.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Ziehen: verschieben · Mausrad / Pinch: zoomen · Doppelklick: hineinzoomen'),
    ),
  );

  surface.start((_time, metrics) => {
    const { width, height } = surface;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, width, height);
    gl.uniform2f(uniforms.uCenter, view.cx, view.cy);
    gl.uniform1f(uniforms.uScale, view.scale);
    gl.uniform1i(uniforms.uMaxIter, view.iter);
    gl.uniform1i(uniforms.uPalette, view.palette);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    surface.hudSet('iter', String(view.iter));
    surface.hudSet('zoom', `${fmtNum(2.7 / view.scale, 1)}×`);
    surface.hudSet('px/s', `${fmtNum((width * height * metrics.fps) / 1e6, 1)} Mpx/s`);
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('wheel', onWheel);
      gl.deleteProgram(program);
      surface.destroy();
    },
  };
}

void fmtInt;
