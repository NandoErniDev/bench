/**
 * Ereignishorizont — ein Schwarzes Loch als echte Strahlkrümmung. Jeder Bildpunkt
 * wird als Photonenbahn in der Schwarzschild-Metrik integriert (u'' = -u +
 * 1.5·rs·u²), bis er den Horizont kreuzt oder entkommt. Unterwegs schneidet der
 * Strahl die Akkretionsscheibe — und weil das Licht mehrfach um das Loch läuft,
 * erscheint die Scheibe hinter dem Loch als Bogen über und unter der Leere.
 */

import { el } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, toggleControl, selectControl } from '../ui/components';

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
uniform int uSteps;
uniform int uAA;
uniform float uDiskInner;
uniform float uDiskOuter;
uniform float uDiskThick;
uniform float uDiskGain;
uniform float uTime;
uniform int uDoppler;
uniform int uStars;
uniform int uDisk;
out vec4 fragColor;

const float RS = 1.0;
const float TAU = 6.2831853;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float noise2(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2(vec2 p) {
  float sum = 0.0;
  float amp = 0.55;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise2(p);
    p = p * 2.05 + vec2(3.7, 1.9);
    amp *= 0.5;
  }
  return sum;
}

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float starLayer(vec3 dir, float scale, float threshold, float size) {
  vec3 p = dir * scale;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  float h = hash31(cell);
  float on = step(threshold, h);
  float r = length(f);
  return on * smoothstep(size, 0.0, r) * (0.35 + 0.65 * fract(h * 137.13));
}

vec3 skyColor(vec3 dir) {
  vec3 base = mix(vec3(0.0035, 0.0050, 0.0110), vec3(0.016, 0.026, 0.058), smoothstep(-0.7, 1.0, dir.y));
  if (uStars == 0) return base;

  vec3 axis = normalize(vec3(0.24, 1.0, -0.36));
  float band = exp(-pow(dot(dir, axis) * 2.7, 2.0));
  float cloud = fbm2(dir.xz * 2.6 + dir.y * 1.7);
  base += band * vec3(0.26, 0.20, 0.44) * smoothstep(0.34, 0.92, cloud) * 0.55;
  base += band * vec3(0.06, 0.10, 0.22) * 0.55;

  float s = 0.0;
  s += starLayer(dir, 70.0, 0.9986, 0.40);
  s += starLayer(dir, 160.0, 0.9978, 0.34) * 0.9;
  s += starLayer(dir, 360.0, 0.9968, 0.30) * 0.65;
  base += vec3(0.86, 0.92, 1.0) * s;
  return base;
}

/* One crossing of the equatorial plane: the disk is thin, so the analytic
   plane hit is used instead of a volume sample. */
vec3 diskSample(vec3 p, vec3 dir, out float opacity) {
  float rr = length(p.xz);
  opacity = 0.0;
  if (rr < uDiskInner || rr > uDiskOuter) return vec3(0.0);

  float radial = smoothstep(uDiskInner, uDiskInner * 1.18, rr)
               * (1.0 - smoothstep(uDiskOuter * 0.55, uDiskOuter, rr));
  if (radial <= 0.001) return vec3(0.0);

  float t = clamp((rr - uDiskInner) / max(uDiskOuter - uDiskInner, 0.001), 0.0, 1.0);
  float heat = pow(1.0 - t, 2.2);

  float ang = atan(p.z, p.x);
  float spin = ang * 2.4 - uTime * 0.55;
  float turb = fbm2(vec2(spin, rr * 0.85));
  turb *= 0.5 + 0.5 * fbm2(vec2(ang * 6.5 + 4.0, rr * 2.1 - uTime * 1.2));
  float lanes = 0.35 + 1.05 * turb;

  vec3 cool = vec3(0.55, 0.12, 0.03);
  vec3 warm = vec3(1.0, 0.52, 0.14);
  vec3 hot = vec3(1.0, 0.95, 0.86);
  vec3 col = mix(cool, warm, smoothstep(0.0, 0.5, heat));
  col = mix(col, hot, smoothstep(0.5, 1.0, heat));

  float doppler = 1.0;
  if (uDoppler == 1) {
    // Orbital velocity of the disk material at this point (prograde, ccw seen from +y).
    vec3 vel = normalize(cross(vec3(0.0, 1.0, 0.0), vec3(p.x, 0.0, p.z)));
    doppler = clamp(1.0 + 1.25 * dot(vel, dir), 0.18, 2.8);
  }

  col *= (0.18 + 1.3 * heat) * lanes * doppler * uDiskGain;
  opacity = clamp((1.0 - exp(-uDiskThick * 22.0)) * radial * 1.35, 0.04, 0.97);
  return col;
}

vec3 trace(vec3 ro, vec3 rd) {
  float r0 = length(ro);
  vec3 e1 = ro / r0;
  float cosRadial = dot(rd, e1);
  vec3 tangential = rd - e1 * cosRadial;
  float sinRadial = length(tangential);
  vec3 e2;
  if (sinRadial < 1e-4) {
    vec3 helper = abs(e1.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
    e2 = normalize(cross(e1, helper));
  } else {
    e2 = tangential / sinRadial;
  }
  float sinSafe = max(sinRadial, 1e-4);

  /* u = 1/r, w = du/dφ. Straight-line optics are u'' = -u; the extra
     1.5·rs·u² is the relativistic term that bends every ray inward. */
  float u = 1.0 / r0;
  float w = -u * cosRadial / sinSafe;
  float phi = 0.0;

  vec3 accum = vec3(0.0);
  float trans = 1.0;
  bool captured = false;
  vec3 previous = ro;

  for (int i = 0; i < 4096; i++) {
    if (i >= uSteps) break;

    float dphi = clamp(0.42 / (u * 26.0 + 1.0), 0.0035, 0.24);

    float k1u = w;
    float k1w = -u + 1.5 * RS * u * u;
    float u2 = u + 0.5 * dphi * k1u;
    float w2 = w + 0.5 * dphi * k1w;
    float k2u = w2;
    float k2w = -u2 + 1.5 * RS * u2 * u2;
    float u3 = u + 0.5 * dphi * k2u;
    float w3 = w + 0.5 * dphi * k2w;
    float k3u = w3;
    float k3w = -u3 + 1.5 * RS * u3 * u3;
    float u4 = u + dphi * k3u;
    float w4 = w + dphi * k3w;
    float k4u = w4;
    float k4w = -u4 + 1.5 * RS * u4 * u4;

    float nextU = u + dphi / 6.0 * (k1u + 2.0 * k2u + 2.0 * k3u + k4u);
    float nextW = w + dphi / 6.0 * (k1w + 2.0 * k2w + 2.0 * k3w + k4w);
    float nextPhi = phi + dphi;

    if (nextU <= 0.0) {
      captured = true;
      break;
    }

    float nextR = 1.0 / nextU;
    vec3 radialDir = cos(nextPhi) * e1 + sin(nextPhi) * e2;
    vec3 pos = radialDir * nextR;

    if (uDisk == 1 && previous.y * pos.y <= 0.0 && previous.y != pos.y) {
      float f = previous.y / (previous.y - pos.y);
      vec3 hit = mix(previous, pos, clamp(f, 0.0, 1.0));
      float opacity;
      vec3 emit = diskSample(hit, rd, opacity);
      if (opacity > 0.0) {
        accum += emit * trans;
        trans *= 1.0 - opacity;
      }
    }

    u = nextU;
    w = nextW;
    phi = nextPhi;
    previous = pos;

    if (nextR <= RS * 1.0002) {
      captured = true;
      break;
    }
    if (nextU < 1.0 / 900.0 && nextW < 0.0) break;
    if (phi > 48.0) break;
  }

  if (!captured) {
    float r = 1.0 / max(u, 1e-7);
    vec3 radialDir = cos(phi) * e1 + sin(phi) * e2;
    vec3 tangentDir = -sin(phi) * e1 + cos(phi) * e2;
    vec3 velocity = (-w / max(u * u, 1e-9)) * radialDir + r * tangentDir;
    vec3 dir = normalize(velocity + vec3(1e-7));
    accum += skyColor(dir) * trans;
  }

  return accum;
}

void main() {
  vec3 total = vec3(0.0);
  float taken = 0.0;
  for (int s = 0; s < 16; s++) {
    if (s >= uAA) break;
    vec2 jitter = vec2(0.0);
    if (uAA > 1) {
      float fs = float(s);
      jitter = (vec2(mod(fs, 4.0), floor(fs * 0.25)) + 0.5) / 4.0 - 0.5;
    }
    vec2 fragCoord = gl_FragCoord.xy + jitter;
    vec2 uv = (fragCoord - 0.5 * uRes) / uRes.y;
    vec3 ro = uCamPos;
    vec3 fw = normalize(uCamTarget - ro);
    vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
    vec3 up = cross(fw, rt);
    vec3 rd = normalize(uv.x * rt + uv.y * up + 1.6 * fw);
    total += trace(ro, rd);
    taken += 1.0;
  }

  vec3 col = total / max(taken, 1.0);
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export function mountBlackhole(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const program = compileProgram(gl, FS_TRIANGLE, FRAG, 'Ereignishorizont');
  const uniforms = uniformMap(gl, program, [
    'uRes',
    'uCamPos',
    'uCamTarget',
    'uSteps',
    'uAA',
    'uDiskInner',
    'uDiskOuter',
    'uDiskThick',
    'uDiskGain',
    'uTime',
    'uDoppler',
    'uStars',
    'uDisk',
  ]);

  const view = {
    yaw: 0.6,
    pitch: 0.16,
    distance: 19,
    steps: 320,
    aa: 2,
    diskInner: 3,
    diskOuter: 13,
    diskThick: 0.14,
    diskGain: 0.6,
    doppler: 1,
    stars: 1,
    disk: 1,
    timeSpeed: 1,
    spin: true,
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
      view.yaw += (event.clientX - previous.x) * 0.007;
      view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + (event.clientY - previous.y) * 0.005));
      return;
    }
    const [a, b] = Array.from(pointers.values());
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) view.distance = Math.max(3.4, Math.min(60, view.distance * (pinch / Math.max(1, distance))));
    pinch = distance;
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    view.distance = Math.max(3.4, Math.min(60, view.distance * Math.exp(event.deltaY * 0.0012)));
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });

  const stepsControl = rangeControl({
    label: 'Bahnschritte',
    min: 64,
    max: 4096,
    step: 16,
    value: view.steps,
    format: (value) => String(value),
    onInput: (value) => {
      view.steps = value;
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

  const innerControl = rangeControl({
    label: 'Scheiben-Innenkante',
    min: 1.5,
    max: 12,
    step: 0.1,
    value: view.diskInner,
    format: (value) => `${value.toFixed(1).replace('.', ',')} rs`,
    onInput: (value) => {
      view.diskInner = value;
    },
  });

  const outerControl = rangeControl({
    label: 'Scheiben-Außenkante',
    min: 4,
    max: 40,
    step: 0.5,
    value: view.diskOuter,
    format: (value) => `${value.toFixed(1).replace('.', ',')} rs`,
    onInput: (value) => {
      view.diskOuter = value;
    },
  });

  const thicknessControl = rangeControl({
    label: 'Scheibendicke',
    min: 0.01,
    max: 0.9,
    step: 0.01,
    value: view.diskThick,
    format: (value) => `${value.toFixed(2).replace('.', ',')} rs`,
    onInput: (value) => {
      view.diskThick = value;
    },
  });

  const gainControl = rangeControl({
    label: 'Scheibenhelligkeit',
    min: 0.05,
    max: 6,
    step: 0.05,
    value: view.diskGain,
    format: (value) => `${value.toFixed(2).replace('.', ',')} ×`,
    onInput: (value) => {
      view.diskGain = value;
    },
  });

  const resolutionControl = rangeControl({
    label: 'Renderauflösung',
    min: 0.25,
    max: 2.5,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const diskToggle = toggleControl({
    label: 'Akkretionsscheibe',
    checked: true,
    onChange: (checked) => {
      view.disk = checked ? 1 : 0;
    },
  });

  const dopplerToggle = toggleControl({
    label: 'Doppler-Aufhellung',
    checked: true,
    onChange: (checked) => {
      view.doppler = checked ? 1 : 0;
    },
  });

  const starToggle = toggleControl({
    label: 'Sternenfeld und Milchstraße',
    checked: true,
    onChange: (checked) => {
      view.stars = checked ? 1 : 0;
    },
  });

  const spinToggle = toggleControl({
    label: 'Scheibe rotiert',
    checked: true,
    onChange: (checked) => {
      view.spin = checked;
    },
  });

  const presetControl = selectControl({
    label: 'Ansicht',
    values: [
      { value: 'edge', label: 'Kante (Interstellar)' },
      { value: 'high', label: 'Von oben' },
      { value: 'pole', label: 'Polachse' },
    ],
    value: 'edge',
    onChange: (value) => {
      if (value === 'high') {
        view.pitch = 0.62;
        view.distance = 21;
      } else if (value === 'pole') {
        view.pitch = 1.15;
        view.distance = 26;
      } else {
        view.pitch = 0.12;
        view.distance = 19;
      }
    },
  });

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Raumzeit')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        presetControl,
        stepsControl.node,
        aaControl.node,
        resolutionControl.node,
        innerControl.node,
        outerControl.node,
        thicknessControl.node,
        gainControl.node,
        el('div', null, diskToggle),
        el('div', null, dopplerToggle),
        el('div', null, starToggle),
        el('div', null, spinToggle),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Kein Trick, keine Textur: Jeder Strahl löst die Bahngleichung u″ = −u + 1,5·rs·u² mit Runge-Kutta vierter Ordnung, '
          + 'in Polarkoordinaten um das Loch. Nah am Horizont wird der Schritt klein, weit draußen groß. '
          + 'Strahlen, die den Horizont kreuzen, enden schwarz — Strahlen daneben laufen ein- oder mehrfach um das Loch und '
          + 'sehen die Scheibe deshalb als Bogen über und unter der Leere.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Ziehen: umkreisen · Mausrad / Pinch: Abstand'),
    ),
  );

  let clock = 0;
  let last = performance.now();

  surface.start((_time, metrics) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (view.spin) clock += dt * view.timeSpeed;
    if (pointers.size === 0 && view.spin) view.yaw += dt * 0.02;

    const cp = Math.cos(view.pitch);
    const eye: [number, number, number] = [
      Math.sin(view.yaw) * cp * view.distance,
      Math.sin(view.pitch) * view.distance,
      Math.cos(view.yaw) * cp * view.distance,
    ];

    const { width, height } = surface;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, width, height);
    gl.uniform3f(uniforms.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(uniforms.uCamTarget, 0, 0, 0);
    gl.uniform1i(uniforms.uSteps, view.steps);
    gl.uniform1i(uniforms.uAA, view.aa);
    gl.uniform1f(uniforms.uDiskInner, view.diskInner);
    gl.uniform1f(uniforms.uDiskOuter, Math.max(view.diskInner + 0.5, view.diskOuter));
    gl.uniform1f(uniforms.uDiskThick, view.diskThick);
    gl.uniform1f(uniforms.uDiskGain, view.diskGain);
    gl.uniform1f(uniforms.uTime, clock);
    gl.uniform1i(uniforms.uDoppler, view.doppler);
    gl.uniform1i(uniforms.uStars, view.stars);
    gl.uniform1i(uniforms.uDisk, view.disk);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    surface.hudSet('schritte', String(view.steps));
    surface.hudSet('abstand', `${view.distance.toFixed(1).replace('.', ',')} rs`);
    surface.hudSet('rs', '1,00');
    void metrics;
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
