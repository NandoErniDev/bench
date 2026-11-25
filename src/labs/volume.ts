/**
 * Volume Shader — real-time raymarching of a procedural 3D volume with
 * gradient-based lighting. Quality (step count) and resolution are adjustable.
 */

import { el, fmtNum } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, toggleControl } from '../ui/components';

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform int uSteps;
uniform float uBass;
out vec4 fragColor;

vec3 rotateY(vec3 p, float a) {
  float c = cos(a);
  float s = sin(a);
  return vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amplitude * noise(p);
    p = p * 2.07 + vec3(1.7, 9.2, 3.1);
    amplitude *= 0.5;
  }
  return sum;
}

float density(vec3 p) {
  vec3 q = rotateY(p, uTime * 0.18);
  float r = length(q);
  float d = fbm(q * 1.7 + vec3(0.0, uTime * 0.22, 0.0)) * 1.7 - 0.62 - r * 0.18;
  return clamp(d, 0.0, 1.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 ro = vec3(0.0, 0.0, 2.85);
  vec3 rd = normalize(vec3(uv, -1.45));
  vec3 lightDir = normalize(vec3(0.55, 0.8, 0.45));

  float stepSize = 5.6 / float(uSteps);
  vec3 col = vec3(0.0);
  float t = 0.2;

  for (int i = 0; i < 1536; i++) {
    if (i >= uSteps) break;
    vec3 p = ro + rd * t;
    float d = density(p) * uBass;
    if (d > 0.02) {
      const float e = 0.04;
      vec3 n = normalize(vec3(
        density(p + vec3(e, 0.0, 0.0)) - d,
        density(p + vec3(0.0, e, 0.0)) - d,
        density(p + vec3(0.0, 0.0, e)) - d
      ));
      float diff = clamp(dot(n, lightDir) * 0.5 + 0.5, 0.0, 1.0);
      float rim = pow(1.0 - clamp(dot(n, -rd), 0.0, 1.0), 2.0);
      vec3 base = mix(vec3(0.09, 0.3, 0.62), vec3(0.95, 0.56, 0.26), smoothstep(0.3, 0.92, d));
      col += base * d * (0.22 + 0.78 * diff) * stepSize * 1.45;
      col += vec3(0.24, 0.44, 0.8) * rim * d * stepSize * 0.5;
    }
    t += stepSize;
  }

  vec3 bg = mix(vec3(0.015, 0.018, 0.024), vec3(0.055, 0.062, 0.08), clamp(length(uv) * 1.1, 0.0, 1.0));
  fragColor = vec4(bg + col, 1.0);
}`;

export function mountVolume(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const program = compileProgram(gl, FS_TRIANGLE, FRAG, 'Volume Shader');
  const uniforms = uniformMap(gl, program, ['uRes', 'uTime', 'uSteps', 'uBass']);

  const state = { steps: 128, density: 1, animate: true };
  let clock = 0;

  const quality = rangeControl({
    label: 'Raymarching-Schritte',
    min: 24,
    max: 1536,
    step: 16,
    value: state.steps,
    format: (value) => String(value),
    onInput: (value) => {
      state.steps = value;
    },
  });

  const resolution = rangeControl({
    label: 'Renderauflösung',
    min: 0.25,
    max: 3,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const density = rangeControl({
    label: 'Volumendichte',
    min: 0.5,
    max: 4,
    step: 0.05,
    value: state.density,
    format: (value) => `${fmtNum(value, 2)} ×`,
    onInput: (value) => {
      state.density = value;
    },
  });

  const animation = toggleControl({
    label: 'Volumen animieren',
    checked: true,
    onChange: (checked) => {
      state.animate = checked;
    },
  });

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Qualität')),
      el('div', { class: 'stack', style: 'gap:14px' }, quality.node, density.node, resolution.node, el('div', null, animation)),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Der Shader tastet pro Pixel ein prozedurales 3D-Volumen ab: Jeder Schritt kostet vier Dichtefunktionen (eine für die Dichte, drei für den Gradienten), und jede davon summiert vier Oktaven Rauschen aus je acht Gitterwerten. '
          + 'Die HUD-Anzeige „Schritte/s" ist das Produkt aus Schrittzahl und Bildrate — ein direktes Maß für die geleistete Shader-Arbeit.',
      ),
    ),
  );

  let lastTime = performance.now();
  surface.start((time) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    if (state.animate) clock += dt;

    const { width, height } = surface;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, width, height);
    gl.uniform1f(uniforms.uTime, clock);
    gl.uniform1i(uniforms.uSteps, state.steps);
    gl.uniform1f(uniforms.uBass, state.density);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    surface.hudSet('steps', String(state.steps));
    void time;
  });

  return {
    destroy() {
      gl.deleteProgram(program);
      surface.destroy();
    },
  };
}
