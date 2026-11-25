/**
 * Fraktur-Schlucht — eine komplette 3D-Landschaft, die es als Geometrie gar
 * nicht gibt: Der Shader sucht die Oberfläche einer prozeduralen Höhenfunktion
 * Strahl für Strahl, wirft Schatten in dieselbe Funktion und spiegelt die
 * Schluchtwände in einem Wasserspiegel. Jeder Schritt, jede Oktave und jedes
 * Sample kostet echte Rauschebene — die Regler skalieren die Last direkt.
 */

import { el, fmtNum } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl, toggleControl } from '../ui/components';

const FRAG = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
uniform vec3 uSun;
uniform int uSteps;
uniform int uOct;
uniform int uAA;
uniform int uWater;
uniform float uWaterLevel;
uniform float uTime;
out vec4 fragColor;

const float FAR = 26.0;

mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, s, -s, c);
}

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float vnoise(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  mat2 r = rot(0.63);
  for (int i = 0; i < 8; i++) {
    if (i >= uOct) break;
    sum += amp * vnoise(p);
    p = r * p * 2.03 + vec2(2.7, 1.3);
    amp *= 0.5;
  }
  return sum;
}

/* Ridged noise builds crests instead of hills: 1 - |2n-1| squared. */
float ridged(vec2 p) {
  float sum = 0.0;
  float amp = 0.55;
  mat2 r = rot(-0.71);
  for (int i = 0; i < 8; i++) {
    if (i >= uOct) break;
    float n = 1.0 - abs(vnoise(p) * 2.0 - 1.0);
    sum += amp * n * n;
    p = r * p * 2.07 + vec2(5.1, 3.9);
    amp *= 0.52;
  }
  return sum;
}

/* A wide plateau with a meandering canyon cut into it: the distance to a wavy
   line decides how much of the plateau survives, so the walls are vertical
   steps rather than a smooth dip. */
float heightAt(vec2 p) {
  vec2 q = p * 0.22;
  float w = fbm(q * 0.9);
  vec2 warp = vec2(fbm(q * 0.8 + vec2(3.1, 7.7) + w), fbm(q * 0.8 + vec2(-5.4, 2.2) - w));

  /* Plateau: smooth noise, then compressed so the tops stay flat instead of
     forming pointed crests. */
  float base = fbm(q + warp * 0.45);
  base = pow(clamp(base * 1.25, 0.0, 1.5), 1.4) * 2.45;

  /* Meandering canyon: distance to a wavy line decides how much plateau is
     left. Quantising the transition gives the stepped strata walls. */
  float line = p.x * 0.45 + 1.6 * sin(p.y * 0.26) + 0.6 * sin(p.y * 0.70 + 2.1);
  float rim = smoothstep(0.35, 1.9, abs(line));
  float wall = floor(rim * 6.0 + 0.5) / 6.0;
  wall = mix(wall, rim, 0.6);
  wall = pow(clamp(wall, 0.0, 1.0), 0.62);

  // The floor is not a plane: boulders and gravel fill the canyon bed.
  float bed = -1.45 + (fbm(p * 2.3 + warp * 0.6) - 0.5) * 0.62 + ridged(p * 1.1) * 0.16;

  float h = base * (0.12 + 0.88 * wall);
  h += (fbm(p * 1.7 + warp) - 0.5) * 0.52 * (0.3 + 0.7 * wall);
  return mix(bed, h, wall);
}

float marchTerrain(vec3 ro, vec3 rd, int maxSteps, float far, out float tHit) {
  tHit = 0.0;
  if (rd.y > 0.0 && ro.y > 3.4) return 0.0;
  float t = 0.04;
  float tPrev = 0.0;
  for (int i = 0; i < 2048; i++) {
    if (i >= maxSteps) break;
    vec3 p = ro + rd * t;
    float h = p.y - heightAt(p.xz);
    if (h < 0.0012 * t) {
      float a = tPrev;
      float b = t;
      for (int k = 0; k < 10; k++) {
        float m = 0.5 * (a + b);
        vec3 pm = ro + rd * m;
        if (pm.y - heightAt(pm.xz) < 0.0) b = m;
        else a = m;
      }
      tHit = b;
      return 1.0;
    }
    tPrev = t;
    if (p.y > 3.4 && rd.y > 0.0) break;
    t += clamp(h * 0.42, 0.0018 + 0.0005 * t, 0.10 + 0.012 * t);
    if (t > far) break;
  }
  tHit = min(t, far);
  return 0.0;
}

vec3 normalAt(vec2 p, float t) {
  float e = 0.0016 + 0.0016 * t;
  float dx = heightAt(p + vec2(e, 0.0)) - heightAt(p - vec2(e, 0.0));
  float dz = heightAt(p + vec2(0.0, e)) - heightAt(p - vec2(0.0, e));
  return normalize(vec3(-dx, 2.0 * e, -dz));
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0;
  float t = 0.06;
  for (int i = 0; i < 96; i++) {
    vec3 p = ro + rd * t;
    float h = p.y - heightAt(p.xz);
    res = min(res, 22.0 * h / t);
    if (res < 0.015) break;
    t += clamp(h * 0.7, 0.03, 0.5);
    if (t > 18.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p) {
  float occ = 0.0;
  const float D = 0.16;
  occ += clamp((heightAt(p.xz + vec2(D, 0.0)) - p.y) * 2.4, 0.0, 1.0);
  occ += clamp((heightAt(p.xz - vec2(D, 0.0)) - p.y) * 2.4, 0.0, 1.0);
  occ += clamp((heightAt(p.xz + vec2(0.0, D)) - p.y) * 2.4, 0.0, 1.0);
  occ += clamp((heightAt(p.xz - vec2(0.0, D)) - p.y) * 2.4, 0.0, 1.0);
  occ += clamp((heightAt(p.xz + vec2(D, D) * 0.7) - p.y) * 1.6, 0.0, 1.0);
  occ += clamp((heightAt(p.xz - vec2(D, D) * 0.7) - p.y) * 1.6, 0.0, 1.0);
  return clamp(1.0 - occ * 0.19, 0.12, 1.0);
}

vec3 skyColor(vec3 rd) {
  float y = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.78, 0.32, 0.15), vec3(0.30, 0.13, 0.29), smoothstep(0.46, 0.64, y));
  col = mix(col, vec3(0.02, 0.03, 0.11), smoothstep(0.62, 0.96, y));

  float sd = max(dot(rd, uSun), 0.0);
  col += vec3(1.0, 0.62, 0.30) * pow(sd, 6.0) * 0.35;
  col += vec3(1.0, 0.92, 0.80) * smoothstep(0.9974, 0.9993, sd) * 30.0;

  if (rd.y > 0.0) {
    vec2 cp = rd.xz / max(rd.y, 0.16) * 0.62 + vec2(uTime * 0.02, uTime * 0.008);
    float base = fbm(cp * 1.6);
    float detail = fbm(cp * 4.2 + 11.0);
    float cover = smoothstep(0.42, 0.70, base + 0.16 * detail);
    vec3 cloud = mix(vec3(0.10, 0.075, 0.10), vec3(0.68, 0.44, 0.32), smoothstep(0.30, 0.95, base));
    cloud += vec3(0.65, 0.30, 0.12) * pow(sd, 3.0) * 0.55;
    cloud *= 0.55 + 0.75 * smoothstep(0.30, 0.95, base);
    col = mix(col, cloud, cover * 0.92 * smoothstep(0.02, 0.20, rd.y));
  }
  return col;
}

vec3 fogTint(vec3 rd) {
  float sd = max(dot(rd, uSun), 0.0);
  vec3 haze = mix(vec3(0.34, 0.20, 0.14), vec3(0.08, 0.10, 0.16), clamp(rd.y * 1.4 + 0.25, 0.0, 1.0));
  haze += vec3(0.9, 0.45, 0.18) * pow(sd, 6.0) * 0.16;
  return haze;
}

vec3 rockColor(vec3 p, vec3 n) {
  float slope = 1.0 - clamp(n.y, 0.0, 1.0);
  float strata = sin(p.y * 32.0 + fbm(p.xz * 2.2) * 6.0) * 0.5 + 0.5;
  vec3 sediment = mix(vec3(0.16, 0.065, 0.05), vec3(0.88, 0.44, 0.19), strata);
  vec3 cliff = mix(vec3(0.07, 0.08, 0.12), vec3(0.40, 0.34, 0.30), strata);
  vec3 base = mix(sediment, cliff, smoothstep(0.10, 0.72, slope));
  base = mix(base, vec3(0.10, 0.18, 0.11), smoothstep(-0.60, -0.15, p.y) * (1.0 - slope) * 0.8);
  base *= 0.78 + 0.40 * vnoise(p.xz * 7.0);
  return base;
}

vec3 shadeTerrain(vec3 ro, vec3 rd, float t) {
  vec3 p = ro + rd * t;
  vec3 n = normalAt(p.xz, t);
  float occ = occlusion(p);
  float shadow = softShadow(p + vec3(0.0, 0.03, 0.0), uSun);
  vec3 base = rockColor(p, n);

  float diff = max(dot(n, uSun), 0.0);
  float sky = 0.5 + 0.5 * n.y;
  vec3 col = base * (vec3(0.07, 0.10, 0.16) * sky * occ + vec3(1.05, 0.80, 0.58) * diff * shadow * 1.25);
  col += base * vec3(0.10, 0.16, 0.26) * occ * sky * 0.5;

  float spec = pow(max(dot(reflect(rd, n), uSun), 0.0), 34.0);
  col += vec3(1.0, 0.86, 0.62) * spec * shadow * 0.22;
  col *= 0.62 + 0.38 * occ;
  return col;
}

vec3 shadeWater(vec3 ro, vec3 rd, float t) {
  vec3 p = ro + rd * t;
  float e = 0.35;
  float b0 = fbm(p.xz * 1.6 + uTime * 0.10);
  float bx = fbm(p.xz * 1.6 + vec2(e, 0.0) + uTime * 0.10);
  float bz = fbm(p.xz * 1.6 + vec2(0.0, e) + uTime * 0.10);
  vec3 n = normalize(vec3((b0 - bx) / e * 0.22, 1.0, (b0 - bz) / e * 0.22));

  vec3 refl = reflect(rd, n);
  if (refl.y < 0.04) refl.y = 0.04;
  refl = normalize(refl);

  /* The mirror is the sky plus a warm sun streak. Marching terrain into the
     reflection aliases badly at grazing angles, and the sky carries the look
     on its own. */
  vec3 reflection = skyColor(refl);

  float fres = pow(1.0 - clamp(dot(-rd, n), 0.0, 1.0), 4.0);
  vec3 deep = vec3(0.008, 0.032, 0.040) * (0.4 + 0.9 * max(dot(n, uSun), 0.0));
  vec3 col = mix(deep, reflection, clamp(0.22 + 0.78 * fres, 0.0, 1.0));

  float glare = pow(max(dot(refl, uSun), 0.0), 64.0);
  col += vec3(1.0, 0.80, 0.52) * glare * 3.2;
  return col;
}

vec3 render(vec2 fragCoord) {
  vec2 uv = (fragCoord - 0.5 * uRes) / uRes.y;
  vec3 ro = uCamPos;
  vec3 fw = normalize(uCamTarget - ro);
  vec3 rt = normalize(cross(vec3(0.0, 1.0, 0.0), fw));
  vec3 up = cross(fw, rt);
  vec3 rd = normalize(uv.x * rt + uv.y * up + 1.45 * fw);

  float tTerrain;
  float hit = marchTerrain(ro, rd, uSteps, FAR, tTerrain);

  float tWater = 1e9;
  if (uWater == 1 && rd.y < -0.0001 && ro.y > uWaterLevel) {
    tWater = (uWaterLevel - ro.y) / rd.y;
  }

  bool waterHit = uWater == 1 && tWater > 0.0 && tWater < tTerrain && tWater < FAR;

  vec3 col;
  float dist;
  if (waterHit) {
    col = shadeWater(ro, rd, tWater);
    dist = tWater;
  } else if (hit > 0.5) {
    col = shadeTerrain(ro, rd, tTerrain);
    dist = tTerrain;
  } else {
    return skyColor(rd);
  }

  float fog = 1.0 - exp(-dist * 0.013);
  col = mix(col, fogTint(rd), clamp(fog, 0.0, 0.82));
  return col;
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
    total += render(gl_FragCoord.xy + jitter);
    taken += 1.0;
  }
  vec3 col = total / max(taken, 1.0);
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  fragColor = vec4(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2)), 1.0);
}`;

export function mountCanyon(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const program = compileProgram(gl, FS_TRIANGLE, FRAG, 'Fraktur-Schlucht');
  const uniforms = uniformMap(gl, program, [
    'uRes',
    'uCamPos',
    'uCamTarget',
    'uSun',
    'uSteps',
    'uOct',
    'uAA',
    'uWater',
    'uWaterLevel',
    'uTime',
  ]);

  const view = {
    z: 0,
    height: 0.15,
    lateral: 0,
    yawOffset: 0,
    pitchOffset: 0,
    speed: 1.7,
    steps: 200,
    octaves: 4,
    aa: 1,
    water: 1,
    sunElevation: 0.20,
    sunAzimuth: 38,
    fly: true,
    quality: 1,
  };

  /* Mirrors the canyon line from the shader so the camera can follow the valley
     without ever leaving it. */
  const canyonX = (z: number) => -(1.6 * Math.sin(z * 0.26) + 0.6 * Math.sin(z * 0.7 + 2.1)) / 0.45;

  const sunVector = (): [number, number, number] => {
    const elevation = view.sunElevation;
    const azimuth = (view.sunAzimuth * Math.PI) / 180;
    const c = Math.cos(elevation);
    return [c * Math.cos(azimuth), Math.sin(elevation), c * Math.sin(azimuth)];
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
      view.yawOffset = Math.max(-1.1, Math.min(1.1, view.yawOffset - (event.clientX - previous.x) * 0.005));
      view.pitchOffset = Math.max(-0.55, Math.min(0.55, view.pitchOffset + (previous.y - event.clientY) * 0.004));
      return;
    }
    const [a, b] = Array.from(pointers.values());
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) view.height = Math.max(-0.35, Math.min(2.2, view.height * (distance / Math.max(1, pinch))));
    pinch = distance;
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = 0;
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    view.height = Math.max(-0.35, Math.min(2.2, view.height + event.deltaY * 0.0012));
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });

  const stepsControl = rangeControl({
    label: 'Raymarching-Schritte',
    min: 64,
    max: 2048,
    step: 16,
    value: view.steps,
    format: (value) => String(value),
    onInput: (value) => {
      view.steps = value;
    },
  });

  const octaveControl = rangeControl({
    label: 'Rausch-Oktaven',
    min: 2,
    max: 8,
    step: 1,
    value: view.octaves,
    format: (value) => `${value} Ebenen`,
    onInput: (value) => {
      view.octaves = value;
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
    max: 2.5,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const sunElevationControl = rangeControl({
    label: 'Sonnenhöhe',
    min: -0.02,
    max: 1.35,
    step: 0.01,
    value: view.sunElevation,
    format: (value) => `${Math.round((value * 180) / Math.PI)}°`,
    onInput: (value) => {
      view.sunElevation = value;
    },
  });

  const sunAzimuthControl = rangeControl({
    label: 'Sonnenrichtung',
    min: 0,
    max: 360,
    step: 1,
    value: view.sunAzimuth,
    format: (value) => `${value}°`,
    onInput: (value) => {
      view.sunAzimuth = value;
    },
  });

  const waterToggle = toggleControl({
    label: 'Wasserspiegel mit Reflexion',
    checked: true,
    onChange: (checked) => {
      view.water = checked ? 1 : 0;
    },
  });

  const flyToggle = toggleControl({
    label: 'Kamera fliegt durch die Schlucht',
    checked: true,
    onChange: (checked) => {
      view.fly = checked;
    },
  });

  const qualityControl = selectControl({
    label: 'Qualitätsstufe',
    values: [
      { value: '1', label: 'Volle Auflösung' },
      { value: '0.75', label: '75 % — schneller' },
      { value: '1.5', label: '150 % — schärfer' },
      { value: '2', label: '200 % — Supersampling' },
    ],
    value: '1',
    onChange: (value) => {
      view.quality = Number(value);
      surface.setScale(view.quality);
    },
  });

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Landschaft')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        stepsControl.node,
        octaveControl.node,
        aaControl.node,
        qualityControl,
        resolutionControl.node,
        sunElevationControl.node,
        sunAzimuthControl.node,
        el('div', null, waterToggle),
        el('div', null, flyToggle),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Es gibt kein Netz und keine Textur: Jeder Bildpunkt sucht die Oberfläche einer Höhenfunktion aus '
          + 'bereichsverschachteltem Rauschen, verfeinert den Treffer mit zehn Bisektionsschritten, berechnet die Normale aus vier '
          + 'weiteren Abfragen, tastet den Schattenstrahl mit bis zu 96 Schritten ab und spiegelt bei Bedarf die ganze Schlucht im Wasser. '
          + 'Jede zusätzliche Oktave vervierfacht fast die Rauschkosten pro Abfrage.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Ziehen: umsehen · Mausrad / Pinch: Abstand'),
    ),
  );

  let clock = 0;
  let last = performance.now();

  surface.start((_time, metrics) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;

    if (view.fly && pointers.size === 0) view.z -= dt * view.speed;

    const here = canyonX(view.z);
    const aheadZ = view.z - 6.0;
    const ahead = canyonX(aheadZ);
    const heading = Math.atan2(ahead - here, aheadZ - view.z);
    const yaw = heading + view.yawOffset;
    const eye: [number, number, number] = [
      here + view.lateral,
      view.height + Math.sin(clock * 0.6) * 0.04,
      view.z,
    ];
    const target: [number, number, number] = [
      eye[0] + Math.sin(yaw) * 6.0,
      eye[1] - 0.14 + view.pitchOffset * 3.2,
      eye[2] + Math.cos(yaw) * 6.0,
    ];
    const sun = sunVector();

    const { width, height } = surface;
    gl.viewport(0, 0, width, height);
    gl.useProgram(program);
    gl.uniform2f(uniforms.uRes, width, height);
    gl.uniform3f(uniforms.uCamPos, eye[0], eye[1], eye[2]);
    gl.uniform3f(uniforms.uCamTarget, target[0], target[1], target[2]);
    gl.uniform3f(uniforms.uSun, sun[0], sun[1], sun[2]);
    gl.uniform1i(uniforms.uSteps, view.steps);
    gl.uniform1i(uniforms.uOct, view.octaves);
    gl.uniform1i(uniforms.uAA, view.aa);
    gl.uniform1i(uniforms.uWater, view.water);
    gl.uniform1f(uniforms.uWaterLevel, -0.95);
    gl.uniform1f(uniforms.uTime, clock);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const rays = (width * height * view.aa * metrics.fps) / 1e6;
    surface.hudSet('strahlen', `${fmtNum(rays, 1)} Mpx/s`);
    surface.hudSet('schritte', String(view.steps));
    surface.hudSet('oktaven', String(view.octaves));
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
