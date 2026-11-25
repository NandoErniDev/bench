/**
 * Path Tracer — progressive Monte-Carlo path tracing. Every frame adds samples
 * to a float accumulation buffer; the image converges while the camera stands
 * still and restarts the moment it moves.
 */

import { el, fmtInt } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, toggleControl } from '../ui/components';

const TRACE = `#version 300 es
precision highp float;

uniform vec2 uRes;
uniform sampler2D uAccum;
uniform float uFrame;
uniform float uReset;
uniform int uBounces;
uniform int uSamples;
uniform vec3 uCamPos;
uniform vec3 uCamTarget;
out vec4 fragColor;

const vec3 EMIT = vec3(9.5, 8.0, 6.4);
const vec4 LIGHT = vec4(0.9, 2.9, -0.9, 0.34);

const vec4 SPH[3] = vec4[3](
  vec4(0.0, 1.0, 0.0, 1.0),
  vec4(1.95, 0.62, -0.75, 0.62),
  vec4(-1.9, 0.72, 0.55, 0.72)
);

const vec3 ALB[3] = vec3[3](
  vec3(0.9, 0.45, 0.22),
  vec3(0.26, 0.5, 0.92),
  vec3(0.24, 0.78, 0.5)
);

uint hashState;

float rand() {
  hashState = hashState * 747796405u + 2891336453u;
  uint word = ((hashState >> ((hashState >> 28u) + 4u)) ^ hashState) * 277803737u;
  return float((word >> 22u) ^ word) * 2.3283064365386963e-10;
}

float hitSphere(vec3 ro, vec3 rd, vec4 sphere) {
  vec3 oc = ro - sphere.xyz;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - sphere.w * sphere.w;
  float h = b * b - c;
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t = -b - h;
  return t > 1e-3 ? t : -1.0;
}

vec3 sky(vec3 rd) {
  float t = clamp(rd.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 color = mix(vec3(0.92, 0.94, 1.0), vec3(0.2, 0.4, 0.85), pow(t, 1.3)) * 0.8;
  float sun = pow(max(dot(rd, normalize(vec3(0.45, 0.7, 0.35))), 0.0), 600.0);
  return color + vec3(1.0, 0.92, 0.8) * sun * 9.0;
}

vec3 cosineDirection(vec3 normal) {
  float u1 = rand();
  float u2 = rand();
  float radius = sqrt(u1);
  float angle = 6.2831853 * u2;
  vec3 tangent = normalize(abs(normal.y) < 0.999
    ? cross(vec3(0.0, 1.0, 0.0), normal)
    : cross(vec3(1.0, 0.0, 0.0), normal));
  vec3 bitangent = cross(normal, tangent);
  return normalize(tangent * (radius * cos(angle)) + bitangent * (radius * sin(angle)) + normal * sqrt(max(0.0, 1.0 - u1)));
}

vec3 trace(vec3 origin, vec3 direction) {
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  vec3 ro = origin;
  vec3 rd = direction;

  for (int depth = 0; depth < 64; depth++) {
    if (depth >= uBounces) break;

    float closest = 1e30;
    int hit = -1;
    if (rd.y < -1e-4) {
      float tPlane = -ro.y / rd.y;
      if (tPlane > 1e-3 && tPlane < closest) {
        closest = tPlane;
        hit = -2;
      }
    }
    for (int i = 0; i < 3; i++) {
      float t = hitSphere(ro, rd, SPH[i]);
      if (t > 0.0 && t < closest) {
        closest = t;
        hit = i;
      }
    }
    float lightT = hitSphere(ro, rd, LIGHT);
    bool lightHit = false;
    if (lightT > 0.0 && lightT < closest) {
      closest = lightT;
      lightHit = true;
    }

    if (!lightHit && hit < 0 && closest > 1e29) {
      radiance += throughput * sky(rd);
      break;
    }
    vec3 position = ro + rd * closest;
    if (lightHit) {
      radiance += throughput * EMIT;
      break;
    }

    vec3 normal;
    vec3 albedo;
    if (hit >= 0) {
      normal = normalize(position - SPH[hit].xyz);
      albedo = ALB[hit];
    } else {
      float checker = mod(floor(position.x * 0.6) + floor(position.z * 0.6), 2.0);
      albedo = mix(vec3(0.86, 0.87, 0.92), vec3(0.07, 0.075, 0.09), checker);
      normal = vec3(0.0, 1.0, 0.0);
    }

    throughput *= albedo;
    ro = position + normal * 2e-3;
    rd = cosineDirection(normal);

    if (depth > 1) {
      float survival = clamp(max(throughput.r, max(throughput.g, throughput.b)), 0.05, 0.95);
      if (rand() > survival) break;
      throughput /= survival;
    }
  }
  return radiance;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 previous = texture(uAccum, uv) * (1.0 - uReset);
  vec3 sum = previous.rgb;
  float count = previous.a;

  vec3 forward = normalize(uCamTarget - uCamPos);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
  vec3 up = cross(forward, right);

  for (int s = 0; s < 64; s++) {
    if (s >= uSamples) break;
    hashState = uint(gl_FragCoord.x) * 1973u + uint(gl_FragCoord.y) * 9277u + uint(uFrame) * 26699u + uint(s) * 7919u + 1u;
    vec2 jitter = vec2(rand(), rand());
    vec2 pixel = gl_FragCoord.xy + jitter - 0.5;
    vec2 p = (pixel - 0.5 * uRes) / uRes.y;
    vec3 direction = normalize(p.x * right + p.y * up + 1.65 * forward);
    sum += clamp(trace(uCamPos, direction), 0.0, 64.0);
    count += 1.0;
  }

  fragColor = vec4(sum, count);
}`;

const DISPLAY = `#version 300 es
precision highp float;

uniform sampler2D uAccum;
uniform vec2 uRes;
uniform float uExposure;
out vec4 fragColor;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 accumulated = texture(uAccum, uv);
  float samples = max(accumulated.a, 1.0);
  vec3 color = accumulated.rgb / samples * uExposure;
  color = aces(color);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 2.2));
  vec2 p = uv - 0.5;
  color *= 1.0 - 0.28 * dot(p, p);
  fragColor = vec4(color, 1.0);
}`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export function mountPathtracer(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;

  const floatRender = gl.getExtension('EXT_color_buffer_float');
  const format = floatRender ? gl.RGBA32F : gl.RGBA16F;
  const type = floatRender ? gl.FLOAT : gl.HALF_FLOAT;
  if (!floatRender && !gl.getExtension('EXT_color_buffer_half_float')) {
    surface.destroy();
    throw new Error(
      'Der Path Tracer braucht Float-Renderziele für den Akkumulationspuffer. Dieser Browser bietet weder EXT_color_buffer_float noch EXT_color_buffer_half_float.',
    );
  }

  const target = (): Target => {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Puffer konnte nicht erstellt werden');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, surface.width, surface.height, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Akkumulationspuffer unvollständig (Status ${status})`);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer };
  };

  let accumulation = [target(), target()];
  let readIndex = 0;
  let accumulatedSize = `${surface.width}x${surface.height}`;

  const reallocate = () => {
    const size = `${surface.width}x${surface.height}`;
    if (size === accumulatedSize) return;
    const ext = gl.getExtension('WEBGL_lose_context');
    void ext;
    for (const item of accumulation) {
      gl.deleteTexture(item.texture);
      gl.deleteFramebuffer(item.framebuffer);
    }
    accumulation = [target(), target()];
    readIndex = 0;
    accumulatedSize = size;
    reset = true;
  };

  const traceProgram = compileProgram(gl, FS_TRIANGLE, TRACE, 'Path Tracer');
  const traceUniforms = uniformMap(gl, traceProgram, [
    'uRes',
    'uAccum',
    'uFrame',
    'uReset',
    'uBounces',
    'uSamples',
    'uCamPos',
    'uCamTarget',
  ]);
  const displayProgram = compileProgram(gl, FS_TRIANGLE, DISPLAY, 'Path Tracer Anzeige');
  const displayUniforms = uniformMap(gl, displayProgram, ['uAccum', 'uRes', 'uExposure']);

  const state = { yaw: 0.6, pitch: 0.22, distance: 6.2, bounces: 6, samples: 4, exposure: 1.15, rotating: true };
  let reset = true;
  let frame = 0;

  const camera = () => {
    const cp = Math.cos(state.pitch);
    return {
      pos: [
        Math.sin(state.yaw) * cp * state.distance,
        1 + Math.sin(state.pitch) * state.distance,
        Math.cos(state.yaw) * cp * state.distance,
      ] as [number, number, number],
      target: [0, 1, 0] as [number, number, number],
    };
  };

  let dragging = false;
  let lastPointer = { x: 0, y: 0 };

  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
    surface.canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    state.yaw -= (event.clientX - lastPointer.x) * 0.006;
    state.pitch = Math.max(-0.15, Math.min(1.2, state.pitch + (event.clientY - lastPointer.y) * 0.005));
    lastPointer = { x: event.clientX, y: event.clientY };
    reset = true;
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    state.distance = Math.max(2.6, Math.min(12, state.distance * Math.exp(event.deltaY * 0.0012)));
    reset = true;
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });

  const bounceControl = rangeControl({
    label: 'Bounces pro Strahl',
    min: 1,
    max: 64,
    step: 1,
    value: state.bounces,
    format: (value) => String(value),
    onInput: (value) => {
      state.bounces = value;
      reset = true;
    },
  });

  const sampleControl = rangeControl({
    label: 'Samples pro Bild',
    min: 1,
    max: 64,
    step: 1,
    value: state.samples,
    format: (value) => String(value),
    onInput: (value) => {
      state.samples = value;
      reset = true;
    },
  });

  const exposureControl = rangeControl({
    label: 'Belichtung',
    min: 0.1,
    max: 8,
    step: 0.05,
    value: state.exposure,
    format: (value) => `${value.toFixed(2)} ×`,
    onInput: (value) => {
      state.exposure = value;
    },
  });

  const resolutionControl = rangeControl({
    label: 'Renderauflösung',
    min: 0.25,
    max: 3,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => {
      surface.setScale(value);
      reallocate();
    },
  });

  const rotationToggle = toggleControl({
    label: 'Kamera drehen (verhindert Konvergenz)',
    checked: true,
    onChange: (checked) => {
      state.rotating = checked;
      reset = true;
    },
  });

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Pfadverfolgung')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        bounceControl.node,
        sampleControl.node,
        exposureControl.node,
        resolutionControl.node,
        el('div', null, rotationToggle),
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Jedes Sample verfolgt einen Strahl über mehrere diffuse Reflexionen, bis er die Lichtkugel, den Himmel oder die Abbruchbedingung trifft. '
          + 'Die Bilder werden aufaddiert: Bei stehender Kamera sinkt das Rauschen mit der Samplezahl, während die GPU weiterrechnet. '
          + 'Ein Smartphone schafft hier oft nur wenige Samples pro Sekunde.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Ziehen: Kamera drehen · Mausrad / Pinch: Abstand'),
    ),
  );

  surface.start((_time, metrics) => {
    if (state.rotating) {
      state.yaw += 0.0032;
      reset = true;
    }
    if (reset) frame = 0;

    const canvasSize = `${surface.width}x${surface.height}`;
    if (canvasSize !== accumulatedSize) reallocate();

    const cam = camera();
    const source = accumulation[readIndex];
    const destination = accumulation[1 - readIndex];

    gl.useProgram(traceProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.texture);
    gl.uniform1i(traceUniforms.uAccum, 0);
    gl.uniform2f(traceUniforms.uRes, surface.width, surface.height);
    gl.uniform1f(traceUniforms.uFrame, frame);
    gl.uniform1f(traceUniforms.uReset, reset ? 1 : 0);
    gl.uniform1i(traceUniforms.uBounces, state.bounces);
    gl.uniform1i(traceUniforms.uSamples, state.samples);
    gl.uniform3f(traceUniforms.uCamPos, cam.pos[0], cam.pos[1], cam.pos[2]);
    gl.uniform3f(traceUniforms.uCamTarget, cam.target[0], cam.target[1], cam.target[2]);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    readIndex = 1 - readIndex;
    frame += state.samples;
    reset = false;

    gl.useProgram(displayProgram);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumulation[readIndex].texture);
    gl.uniform1i(displayUniforms.uAccum, 0);
    gl.uniform2f(displayUniforms.uRes, surface.width, surface.height);
    gl.uniform1f(displayUniforms.uExposure, state.exposure);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const rays = (surface.width * surface.height * state.samples * metrics.fps) / 1e6;
    surface.hudSet('samples', fmtInt(frame));
    surface.hudSet('Mrays/s', rays.toFixed(2));
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('wheel', onWheel);
      for (const item of accumulation) {
        gl.deleteTexture(item.texture);
        gl.deleteFramebuffer(item.framebuffer);
      }
      gl.deleteProgram(traceProgram);
      gl.deleteProgram(displayProgram);
      surface.destroy();
    },
  };
}
