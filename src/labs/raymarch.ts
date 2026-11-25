/**
 * Fractal Raymarcher — Mandelbulb distance estimator, evaluated many times per
 * sample. Steps, fractal iterations, power, supersampling and render resolution
 * are adjustable; every extra step costs a full distance estimate.
 */

import { el, fmtNum } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, toggleControl } from '../ui/components';

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform int uSteps;
uniform int uIter;
uniform int uAA;
uniform float uPower;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
out vec4 fragColor;

const float BAILOUT = 4.0;

float mandelbulb(vec3 p) {
  vec3 z = p;
  float dr = 1.0;
  float r = 0.0;
  for (int i = 0; i < 48; i++) {
    if (i >= uIter) break;
    r = length(z);
    if (r > BAILOUT) break;
    float theta = acos(clamp(z.z / max(r, 1e-8), -1.0, 1.0));
    float phi = atan(z.y, z.x);
    dr = pow(r, uPower - 1.0) * uPower * dr + 1.0;
    float zr = pow(r, uPower);
    theta *= uPower;
    phi *= uPower;
    z = zr * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + p;
  }
  return 0.5 * log(max(r, 1e-8)) * r / max(dr, 1e-8);
}

vec3 normalAt(vec3 p) {
  const float e = 0.0009;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * mandelbulb(p + k.xyy * e) +
    k.yyx * mandelbulb(p + k.yyx * e) +
    k.yxy * mandelbulb(p + k.yxy * e) +
    k.xxx * mandelbulb(p + k.xxx * e)
  );
}

float occlusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float w = 1.0;
  for (int i = 1; i <= 9; i++) {
    float h = 0.008 + 0.09 * float(i);
    occ += (h - mandelbulb(p + n * h)) * w;
    w *= 0.72;
  }
  return clamp(1.0 - 2.2 * occ, 0.0, 1.0);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.012;
  for (int i = 0; i < 96; i++) {
    float h = mandelbulb(ro + rd * t);
    res = min(res, 14.0 * h / t);
    t += clamp(h, 0.004, 0.16);
    if (res < 0.02 || t > 3.2) break;
  }
  return clamp(res, 0.0, 1.0);
}

vec3 shade(vec3 ro, vec3 rd, vec3 p, vec3 n) {
  vec3 keyDir = normalize(vec3(0.65, 0.85, 0.45));
  vec3 fillDir = normalize(vec3(-0.7, 0.25, -0.55));
  float key = max(dot(n, keyDir), 0.0);
  float fill = max(dot(n, fillDir), 0.0);
  float bounce = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
  float spec = pow(max(dot(reflect(rd, n), keyDir), 0.0), 42.0);
  float fres = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 4.0);
  float ao = occlusion(p, n);
  float shadow = softShadow(p + n * 0.004, keyDir);

  vec3 albedo = mix(vec3(0.72, 0.28, 0.12), vec3(0.2, 0.55, 0.95), clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  albedo = mix(albedo, vec3(0.95, 0.62, 0.25), 0.35 + 0.35 * sin(p.x * 2.4 + p.y * 1.7));
  albedo *= 0.35 + 0.65 * ao;

  vec3 col = vec3(0.0);
  col += albedo * key * shadow * vec3(1.0, 0.94, 0.85) * 1.25;
  col += albedo * fill * vec3(0.35, 0.5, 0.95) * 0.55;
  col += albedo * bounce * vec3(0.18, 0.22, 0.3) * 0.6;
  col += vec3(1.0, 0.95, 0.88) * spec * shadow * 0.9;
  col += vec3(0.28, 0.5, 1.0) * fres * 0.35;
  return col;
}

vec3 render(vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * uRes) / uRes.y;
  vec3 ro = uCamPos;
  vec3 fw = normalize(uCamTarget - ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(uv.x * rt + uv.y * up + 1.65 * fw);

  float t = 0.75;
  float glow = 0.0;
  bool hit = false;
  for (int i = 0; i < 1024; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * t;
    float d = mandelbulb(p);
    if (d < 0.0007 * t) {
      hit = true;
      break;
    }
    glow += exp(-d * 26.0) * 0.008;
    t += max(d * 0.85, 0.0007);
    if (t > 6.5) break;
  }

  vec3 bg = mix(vec3(0.015, 0.018, 0.025), vec3(0.055, 0.068, 0.095), clamp(uv.y + 0.5, 0.0, 1.0));
  if (!hit) {
    return bg + vec3(0.22, 0.42, 0.95) * min(glow, 0.55);
  }
  vec3 p = ro + rd * t;
  vec3 n = normalAt(p);
  return shade(ro, rd, p, n);
}

void main() {
  vec3 total = vec3(0.0);
  float taken = 0.0;
  for (int s = 0; s < 4; s++) {
    if (s >= uAA) break;
    vec2 jitter = vec2(0.0);
    if (uAA > 1) {
      float fs = float(s);
      jitter = vec2(mod(fs, 2.0), floor(fs * 0.5)) * 0.5 - 0.25;
    }
    total += render(gl_FragCoord.xy + jitter);
    taken += 1.0;
  }
  vec3 col = total / max(taken, 1.0);
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  fragColor = vec4(col, 1.0);
}`;

export function mountRaymarch(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const program = compileProgram(gl, FS_TRIANGLE, FRAG, 'Fractal Raymarcher');
  const uniforms = uniformMap(gl, program, [
    'uRes',
    'uSteps',
    'uIter',
    'uAA',
    'uPower',
    'uCamPos',
    'uCamTarget',
  ]);

  const view = { yaw: 0.7, pitch: 0.32, distance: 3.0, steps: 480, iter: 14, power: 8, aa: 2 };

  const camera = () => {
    const cp = Math.cos(view.pitch);
    return {
      pos: [
        Math.sin(view.yaw) * cp * view.distance,
        Math.sin(view.pitch) * view.distance,
        Math.cos(view.yaw) * cp * view.distance,
      ] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
    };
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pinch = 0;

  const onPointerDown = (event: PointerEvent) => {
    surface.canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = Array.from(pointers.values());
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      view.yaw -= (event.clientX - previous.x) * 0.008;
      view.pitch = Math.max(-1.35, Math.min(1.35, view.pitch + (event.clientY - previous.y) * 0.006));
      return;
    }
    const [a, b] = Array.from(pointers.values());
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) {
      view.distance = Math.max(1.02, Math.min(7, view.distance * (pinch / Math.max(1, distance))));
    }
    pinch = distance;
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    view.distance = Math.max(1.02, Math.min(7, view.distance * Math.exp(event.deltaY * 0.0012)));
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });

  const stepsControl = rangeControl({
    label: 'Raymarching-Schritte',
    min: 64,
    max: 1024,
    step: 16,
    value: view.steps,
    format: (value) => String(value),
    onInput: (value) => {
      view.steps = value;
    },
  });

  const iterControl = rangeControl({
    label: 'Fraktal-Iterationen',
    min: 3,
    max: 32,
    step: 1,
    value: view.iter,
    format: (value) => String(value),
    onInput: (value) => {
      view.iter = value;
    },
  });

  const powerControl = rangeControl({
    label: 'Mandelbulb-Potenz',
    min: 2,
    max: 12,
    step: 0.5,
    value: view.power,
    format: (value) => fmtNum(value, 1),
    onInput: (value) => {
      view.power = value;
    },
  });

  const aaControl = rangeControl({
    label: 'Samples pro Pixel',
    min: 1,
    max: 4,
    step: 1,
    value: 2,
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

  const autoRotate = toggleControl({
    label: 'Kamera langsam drehen',
    checked: true,
    onChange: (checked) => {
      rotate = checked;
    },
  });

  let rotate = true;

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Qualität')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        stepsControl.node,
        iterControl.node,
        powerControl.node,
        aaControl.node,
        resolutionControl.node,
        el('div', null, autoRotate),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Ein Mandelbulb ist keine Fläche, sondern ein Distanzfeld: Jeder der bis zu 1024 Schritte ruft eine komplette Fraktal-Iteration auf, '
          + 'und Beleuchtung, Ambient Occlusion und Schatten lösen jeweils weitere Distanzabfragen aus. '
          + 'Auf einem Smartphone ist diese Last bewusst nicht mehr flüssig — genau das macht sie vergleichbar.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Ziehen: drehen · Mausrad / Pinch: zoomen'),
    ),
  );

  surface.start((_time, metrics) => {
    if (rotate) view.yaw += 0.0035;
    const cam = camera();
    const { width, height } = surface;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, width, height);
    gl.uniform1i(uniforms.uSteps, view.steps);
    gl.uniform1i(uniforms.uIter, view.iter);
    gl.uniform1i(uniforms.uAA, view.aa);
    gl.uniform1f(uniforms.uPower, view.power);
    gl.uniform3f(uniforms.uCamPos, cam.pos[0], cam.pos[1], cam.pos[2]);
    gl.uniform3f(uniforms.uCamTarget, cam.target[0], cam.target[1], cam.target[2]);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const rays = (width * height * view.aa * metrics.fps) / 1e6;
    const estimates = rays * view.steps;
    surface.hudSet('rays', `${fmtNum(rays, 1)} Mpx/s`);
    surface.hudSet('DE/s', `${fmtNum(estimates, 0)} Mdist/s`);
    surface.hudSet('steps', String(view.steps));
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
