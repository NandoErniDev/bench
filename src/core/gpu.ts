/**
 * WebGL2 GPU benchmark suite.
 *
 * Four independent workloads, all rendered into a 1280 × 720 framebuffer so
 * that results are comparable regardless of the display. Each batch is forced
 * to completion with a synchronous readPixels before the clock stops, so the
 * measured time is real GPU work and not just command submission.
 *
 * Where the browser exposes EXT_disjoint_timer_query_webgl2, GPU-only time is
 * measured as well; otherwise only wall-clock frame time is reported.
 *
 * Fairness: every workload uses the same sizes and the same texture formats on
 * all platforms. In particular the simulation state is plain RGBA8 instead of
 * an optional float render target, so no browser gets a different amount of
 * bandwidth per texel — the work a device executes is identical on iOS,
 * Android, macOS and Windows.
 */

import {
  GPU_REFERENCE,
  GPU_RESOLUTION,
  GPU_TEST_INFO,
  GPU_WEIGHTS,
  TIMING,
  normalize,
  weightedMean,
  type GpuResult,
  type GpuTestId,
  type GpuTestScore,
  type Mode,
} from './suite';
import { clamp, throwIfAborted, waitForVisible } from './util';

const FS_TRIANGLE = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const SHADER_TEST_FS = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform int uIters;
uniform float uPhase;
out vec4 fragColor;
void main() {
  vec2 p = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  p.x *= uRes.x / uRes.y;
  vec2 c = p * 0.72 + vec2(-0.55 + uPhase * 0.0007, 0.12 + uPhase * 0.0004);
  vec2 z = vec2(0.0);
  vec3 col = vec3(0.0);
  int last = 0;
  for (int i = 0; i < 256; i++) {
    if (i >= uIters) break;
    float zx = z.x * z.x - z.y * z.y + c.x;
    float zy = 2.0 * z.x * z.y + c.y;
    z = vec2(zx, zy);
    col += vec3(z.x, z.y, z.x * z.y) / (1.0 + dot(z, z));
    last = i;
  }
  float t = float(last) / float(uIters);
  fragColor = vec4(0.5 + 0.5 * sin(col * 0.32 + t * 2.0), 1.0);
}`;

/**
 * Vertex throughput: 262 144 points, each transformed with trigonometry in the
 * vertex shader. One-pixel points keep fill cost negligible, so the measurement
 * reflects vertex processing instead of rasterisation.
 */
const VERTEX_TEST_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aSeed;
uniform float uPhase;
out vec3 vColor;
void main() {
  float a = aSeed.x * 6.28318 + uPhase;
  float b = aSeed.y * 6.28318 - uPhase * 0.7;
  vec3 p = vec3(sin(a) * cos(b), cos(a * 0.7) * sin(b), sin(a + b) * 0.5);
  p = normalize(p) * (0.55 + 0.42 * sin(a * 3.0));
  gl_Position = vec4(p.xy, 0.0, 1.0);
  gl_PointSize = 1.0;
  vColor = vec3(0.4 + 0.6 * aSeed.x, 0.5, 0.4 + 0.6 * aSeed.y);
}`;

const VERTEX_TEST_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`;

const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(uTex, gl_FragCoord.xy / uRes).rgb, 1.0);
}`;

const TERRAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUv;
uniform mat4 uProj;
uniform mat4 uView;
out vec3 vNormal;
out vec3 vWorld;
out float vHeight;
void main() {
  vNormal = aNormal;
  vWorld = aPos;
  vHeight = aPos.y;
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in float vHeight;
uniform vec3 uEye;
out vec4 fragColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(0.55, 0.75, 0.35));
  vec3 v = normalize(uEye - vWorld);
  float diff = max(dot(n, l), 0.0);
  vec3 h = normalize(l + v);
  float spec = pow(max(dot(n, h), 0.0), 48.0) * 0.4;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.22;
  vec3 base = mix(vec3(0.11, 0.14, 0.18), vec3(0.58, 0.64, 0.68), smoothstep(-0.45, 0.45, vHeight));
  vec3 color = base * (0.25 + 0.85 * diff) + spec + rim;
  fragColor = vec4(color, 1.0);
}`;

const SIM_UPDATE_FS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uRes;
uniform float uTime;
uniform float uDt;
out vec4 outState;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec4 s = texture(uState, uv);
  vec2 pos = s.xy;
  vec2 vel = s.zw * 2.0 - 1.0;
  float n = sin(pos.x * 12.9 + uTime) * cos(pos.y * 9.7 - uTime * 0.7);
  float m = cos(pos.x * 6.3 - uTime * 0.6) * sin(pos.y * 14.1 + uTime);
  vel += vec2(n, m) * uDt * 0.35;
  vel *= 0.985;
  pos = fract(pos + vel * uDt * 0.02 + 1.0);
  outState = vec4(pos, vel * 0.5 + 0.5);
}`;

const SIM_RENDER_VS = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform float uSize;
out vec3 vColor;
void main() {
  int id = gl_VertexID;
  int w = int(uSize);
  float x = float(id % w);
  float y = float(id / w);
  vec2 uv = (vec2(x, y) + 0.5) / uSize;
  vec4 s = textureLod(uState, uv, 0.0);
  vec2 p = s.xy * 2.0 - 1.0;
  gl_Position = vec4(p, 0.0, 1.0);
  gl_PointSize = 1.5;
  vColor = vec3(0.35 + 0.6 * s.z, 0.45 + 0.3 * s.w, 0.75);
}`;

const SIM_RENDER_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  width: number;
  height: number;
  depth?: WebGLRenderbuffer;
}

interface Measured {
  draws: number;
  elapsed: number;
  samples: number[];
  value: number;
}

interface GpuProgress {
  test: GpuTestId | 'scaling' | 'prepare';
  label: string;
  fraction: number;
  detail?: string;
}

export interface GpuRunOptions {
  mode: Mode;
  signal: AbortSignal;
  host: HTMLElement;
  onProgress: (progress: GpuProgress) => void;
  pause: (ms: number, label: string) => Promise<void>;
}

function compile(gl: WebGL2RenderingContext, vsSource: string, fsSource: string, label: string): WebGLProgram {
  const make = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`Shader konnte nicht erstellt werden (${label})`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`${label}: ${log ?? 'Shader-Kompilierung fehlgeschlagen'}`);
    }
    return shader;
  };
  const vs = make(gl.VERTEX_SHADER, vsSource);
  const fs = make(gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error('Programm konnte nicht erstellt werden');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`${label}: ${log ?? 'Link-Fehler'}`);
  }
  return program;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
  const map: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) map[name] = gl.getUniformLocation(program, name);
  return map;
}

function makeTarget(gl: WebGL2RenderingContext, width: number, height: number, depth: boolean): Target {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) throw new Error('Render-Target konnte nicht erstellt werden');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb: WebGLRenderbuffer | undefined;
  if (depth) {
    rb = gl.createRenderbuffer() ?? undefined;
    if (rb) {
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
  }
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer unvollständig (Status ${status})`);
  }
  return { fb, tex, width, height, depth: rb };
}

function heightAt(x: number, z: number): number {
  return (
    Math.sin(x * 2.3 + 0.4) * Math.cos(z * 1.9 - 0.3) * 0.45 +
    Math.sin(x * 5.7 - 1.1) * Math.cos(z * 4.9 + 0.8) * 0.22 +
    Math.sin(x * 13.1 + 2.2) * Math.cos(z * 11.7 - 1.4) * 0.09
  );
}

function buildTerrain(grid: number) {
  const size = 3.2;
  const count = (grid + 1) * (grid + 1);
  const data = new Float32Array(count * 8);
  const step = size / grid;
  const eps = step * 0.5;
  let offset = 0;
  for (let iz = 0; iz <= grid; iz++) {
    for (let ix = 0; ix <= grid; ix++) {
      const x = -size / 2 + ix * step;
      const z = -size / 2 + iz * step;
      const y = heightAt(x, z);
      const dx = heightAt(x + eps, z) - heightAt(x - eps, z);
      const dz = heightAt(x, z + eps) - heightAt(x, z - eps);
      // normal of the height field (pointing up)
      let nx = -dx;
      let ny = 2 * eps;
      let nz = -dz;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      data[offset++] = x;
      data[offset++] = y;
      data[offset++] = z;
      data[offset++] = nx;
      data[offset++] = ny;
      data[offset++] = nz;
      data[offset++] = ix / grid;
      data[offset++] = iz / grid;
    }
  }
  const indices = new Uint32Array(grid * grid * 6);
  let i = 0;
  for (let iz = 0; iz < grid; iz++) {
    for (let ix = 0; ix < grid; ix++) {
      const a = iz * (grid + 1) + ix;
      const b = a + 1;
      const c = a + grid + 1;
      const d = c + 1;
      indices[i++] = a;
      indices[i++] = c;
      indices[i++] = b;
      indices[i++] = b;
      indices[i++] = c;
      indices[i++] = d;
    }
  }
  return { data, indices, vertices: count, triangles: grid * grid * 2 };
}

function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

function lookAt(eye: [number, number, number], centre: [number, number, number], up: [number, number, number]) {
  const zx = eye[0] - centre[0];
  const zy = eye[1] - centre[1];
  const zz = eye[2] - centre[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]];
  const xl = Math.hypot(x[0], x[1], x[2]) || 1;
  x[0] /= xl;
  x[1] /= xl;
  x[2] /= xl;
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  const out = new Float32Array(16);
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
}

/** Software rasterisers are not hardware GPUs — their scores must be flagged. */
function isSoftwareRenderer(renderer: string | null): boolean {
  if (!renderer) return false;
  return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|mesa offscreen/i.test(renderer);
}

function timerExtension(gl: WebGL2RenderingContext) {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    | (Record<string, unknown> & { TIME_ELAPSED_EXT: number })
    | null;
  return ext;
}

async function sleepTick(): Promise<void> {
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

export async function runGpuBenchmark(options: GpuRunOptions): Promise<GpuResult> {
  const started = performance.now();
  const timing = TIMING[options.mode];
  const width = GPU_RESOLUTION.w;
  const height = GPU_RESOLUTION.h;

  options.onProgress({ test: 'prepare', label: 'WebGL2 initialisieren', fraction: 0 });

  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  options.host.appendChild(canvas);

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  });

  if (!gl) {
    canvas.remove();
    throw new Error('WebGL2 ist in diesem Browser nicht verfügbar.');
  }

  let contextLost = false;
  const onLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
  };
  canvas.addEventListener('webglcontextlost', onLost);

  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = debugInfo ? (gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) as string | null) : null;
  const vendor = debugInfo ? (gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) as string | null) : null;
  const software = isSoftwareRenderer(renderer);
  const timerExt = timerExtension(gl);
  const pixels = new Uint8Array(4);
  const vao = gl.createVertexArray();

  const presentProgram = compile(gl, FS_TRIANGLE, PRESENT_FS, 'Present');
  const presentUniforms = uniforms(gl, presentProgram, ['uTex', 'uRes']);

  function present(target: Target) {
    if (!gl) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(presentProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, target.tex);
    gl.uniform1i(presentUniforms.uTex, 0);
    gl.uniform2f(presentUniforms.uRes, canvas.width, canvas.height);
    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function syncFrom(target: Target) {
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target.fb);
    gl!.readPixels(0, 0, 1, 1, gl!.RGBA, gl!.UNSIGNED_BYTE, pixels);
  }

  async function measure(
    target: Target,
    draw: () => void,
    perFrameValue: number,
    targetMs: number,
    testId: GpuTestId,
    label: string,
    progressBase: number,
    progressSpan: number,
  ): Promise<Measured> {
    const samples: number[] = [];
    let draws = 0;
    let elapsed = 0;
    let batch = 2;
    let wallStart = performance.now();
    /** Budget is measured work, not wall time: a throttled tab cannot skew the sample count. */
    const wallLimit = Math.max(targetMs * 3, 6000);
    /** Yield only after ~220 ms of measured work, so timer throttling cannot dominate. */
    let sinceYield = 0;

    // At least two samples, so very slow GPUs still produce a value instead of a
    // single batch; hidden time never counts towards the budget.
    while ((elapsed < targetMs || samples.length < 2) && performance.now() - wallStart < wallLimit) {
      throwIfAborted(options.signal);
      if (contextLost) throw new Error('WebGL-Kontext wurde während der Messung verloren.');
      if (document.visibilityState === 'hidden') {
        // Every browser throttles timers and compositing in background tabs.
        // Waiting keeps the measurement comparable instead of silently skewing it.
        await waitForVisible(options.signal);
        wallStart = performance.now();
        sinceYield = 0;
        continue;
      }
      const t0 = performance.now();
      for (let i = 0; i < batch; i++) draw();
      syncFrom(target);
      const ms = performance.now() - t0;
      elapsed += ms;
      draws += batch;
      sinceYield += ms;
      const perFrame = ms / batch;
      if (perFrame > 0.0005) samples.push(perFrame);
      batch = clamp(Math.round(38 / Math.max(perFrame, 0.05)), 1, 96);

      if (sinceYield >= 220 || elapsed >= targetMs) {
        sinceYield = 0;
        present(target);
        options.onProgress({
          test: testId,
          label,
          fraction: progressBase + progressSpan * Math.min(1, elapsed / targetMs),
          detail: `${(valueOf(elapsed, draws, perFrameValue) / 1e6).toFixed(1)} ${GPU_TEST_INFO[testId].unit}`,
        });
        await sleepTick();
      }
    }

    present(target);
    return { draws, elapsed, samples, value: valueOf(elapsed, draws, perFrameValue) };
  }

  function valueOf(elapsedMs: number, draws: number, perFrameValue: number): number {
    if (elapsedMs <= 0) return 0;
    return (draws * perFrameValue) / (elapsedMs / 1000);
  }

  /** Optional GPU-only time for one representative frame set. */
  async function gpuTimePerFrame(draw: () => void, frames: number): Promise<number | null> {
    if (!timerExt) return null;
    try {
      const ext = timerExt;
      const query = gl!.createQuery();
      if (!query) return null;
      gl!.beginQuery(Number(ext.TIME_ELAPSED_EXT), query);
      for (let i = 0; i < frames; i++) draw();
      gl!.endQuery(Number(ext.TIME_ELAPSED_EXT));
      for (let attempt = 0; attempt < 120; attempt++) {
        const available = gl!.getQueryParameter(query, gl!.QUERY_RESULT_AVAILABLE) as boolean;
        if (available) break;
        await new Promise((resolve) => window.setTimeout(resolve, 4));
      }
      const ns = gl!.getQueryParameter(query, gl!.QUERY_RESULT) as number;
      gl!.deleteQuery(query);
      if (!ns || ns <= 0) return null;
      return ns / 1e6 / frames;
    } catch {
      return null;
    }
  }

  /** Timer queries are cheap, but slow frames should not be repeated four times. */
  const timerFrames = (measured: Measured): number => {
    const first = measured.samples[0] ?? 10;
    return first > 60 ? 1 : first > 15 ? 2 : 4;
  };

  const tests: GpuTestScore[] = [];
  const scaling: GpuResult['scaling'] = [];

  try {
    throwIfAborted(options.signal);

    // ---------------------------------------------------------------- shader
    const shaderTarget = makeTarget(gl, width, height, false);
    const shaderProgram = compile(gl, FS_TRIANGLE, SHADER_TEST_FS, 'Shader-Test');
    const shaderUniforms = uniforms(gl, shaderProgram, ['uRes', 'uIters', 'uPhase']);
    let phase = 0;
    const drawShader = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shaderTarget.fb);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(shaderProgram);
      gl.uniform2f(shaderUniforms.uRes, width, height);
      gl.uniform1i(shaderUniforms.uIters, 48);
      gl.uniform1f(shaderUniforms.uPhase, (phase += 0.37));
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const shaderMeasured = await measure(
      shaderTarget,
      drawShader,
      width * height,
      timing.gpuTestMs,
      'fragment',
      GPU_TEST_INFO.fragment.label,
      0.02,
      0.28,
    );
    const shaderGpuMs = await gpuTimePerFrame(drawShader, timerFrames(shaderMeasured));
    tests.push({
      id: 'fragment',
      label: GPU_TEST_INFO.fragment.label,
      detail: GPU_TEST_INFO.fragment.detail,
      unit: GPU_TEST_INFO.fragment.unit,
      value: shaderMeasured.value,
      score: normalize(shaderMeasured.value, GPU_REFERENCE.fragment),
      avgFrameMs: shaderMeasured.samples.length
        ? shaderMeasured.samples.reduce((a, b) => a + b, 0) / shaderMeasured.samples.length
        : 0,
      gpuMs: shaderGpuMs,
      samples: shaderMeasured.samples.slice(-240),
    });
    gl.deleteProgram(shaderProgram);

    // ------------------------------------------------------------- geometry
    throwIfAborted(options.signal);
    if (options.mode === 'full') await options.pause(timing.pauseBetweenGpuMs, 'Kurze Pause');
    throwIfAborted(options.signal);

    const geoTarget = makeTarget(gl, width, height, false);
    const geoProgram = compile(gl, VERTEX_TEST_VS, VERTEX_TEST_FS, 'Vertex-Test');
    const geoUniforms = uniforms(gl, geoProgram, ['uPhase']);
    const vertexCount = 262144;
    const vertexData = new Float32Array(vertexCount * 2);
    for (let i = 0; i < vertexCount; i++) {
      vertexData[i * 2] = (i * 0.6180339887) % 1;
      vertexData[i * 2 + 1] = ((i * 0.7548776662) % 1 + 1) % 1;
    }
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
    const vertexVao = gl.createVertexArray();
    gl.bindVertexArray(vertexVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    let geoPhase = 0;
    const drawGeometry = () => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, geoTarget.fb);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(geoProgram);
      gl.uniform1f(geoUniforms.uPhase, (geoPhase += 0.41));
      gl.bindVertexArray(vertexVao);
      gl.drawArrays(gl.POINTS, 0, vertexCount);
    };
    const geoMeasured = await measure(
      geoTarget,
      drawGeometry,
      vertexCount,
      timing.gpuTestMs,
      'geometry',
      GPU_TEST_INFO.geometry.label,
      0.3,
      0.2,
    );
    const geoGpuMs = await gpuTimePerFrame(drawGeometry, timerFrames(geoMeasured));
    tests.push({
      id: 'geometry',
      label: GPU_TEST_INFO.geometry.label,
      detail: GPU_TEST_INFO.geometry.detail,
      unit: GPU_TEST_INFO.geometry.unit,
      value: geoMeasured.value,
      score: normalize(geoMeasured.value, GPU_REFERENCE.geometry),
      avgFrameMs: geoMeasured.samples.length
        ? geoMeasured.samples.reduce((a, b) => a + b, 0) / geoMeasured.samples.length
        : 0,
      gpuMs: geoGpuMs,
      samples: geoMeasured.samples.slice(-240),
    });
    gl.deleteProgram(geoProgram);
    gl.deleteBuffer(vertexBuffer);

    // ---------------------------------------------------------------- scene
    throwIfAborted(options.signal);
    if (options.mode === 'full') await options.pause(timing.pauseBetweenGpuMs, 'Kurze Pause');
    throwIfAborted(options.signal);

    const sceneTarget = makeTarget(gl, width, height, true);
    const sceneProgram = compile(gl, TERRAIN_VS, TERRAIN_FS, 'Szenen-Test');
    const sceneUniforms = uniforms(gl, sceneProgram, ['uProj', 'uView', 'uEye']);
    const terrain = buildTerrain(160);
    const terrainBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, terrain.data, gl.STATIC_DRAW);
    const terrainIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, terrain.indices, gl.STATIC_DRAW);
    const terrainVao = gl.createVertexArray();
    gl.bindVertexArray(terrainVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, terrainBuffer);
    const stride = 8 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIndexBuffer);

    const proj = perspective((55 * Math.PI) / 180, width / height, 0.1, 100);
    let sceneAngle = 0.6;
    let eye: [number, number, number] = [0, 0, 0];
    const drawScene = () => {
      sceneAngle += 0.006;
      const radius = 3.4;
      eye = [Math.sin(sceneAngle) * radius, 1.7, Math.cos(sceneAngle) * radius];
      const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneTarget.fb);
      gl.viewport(0, 0, width, height);
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0.03, 0.035, 0.045, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(sceneProgram);
      gl.uniformMatrix4fv(sceneUniforms.uProj, false, proj);
      gl.uniformMatrix4fv(sceneUniforms.uView, false, view);
      gl.uniform3f(sceneUniforms.uEye, eye[0], eye[1], eye[2]);
      gl.bindVertexArray(terrainVao);
      gl.drawElements(gl.TRIANGLES, terrain.indices.length, gl.UNSIGNED_INT, 0);
    };

    const sceneMeasured = await measure(
      sceneTarget,
      drawScene,
      terrain.triangles,
      timing.gpuTestMs,
      'scene',
      GPU_TEST_INFO.scene.label,
      0.52,
      0.22,
    );
    const sceneGpuMs = await gpuTimePerFrame(drawScene, timerFrames(sceneMeasured));
    tests.push({
      id: 'scene',
      label: GPU_TEST_INFO.scene.label,
      detail: GPU_TEST_INFO.scene.detail,
      unit: GPU_TEST_INFO.scene.unit,
      value: sceneMeasured.value,
      score: normalize(sceneMeasured.value, GPU_REFERENCE.scene),
      avgFrameMs: sceneMeasured.samples.length
        ? sceneMeasured.samples.reduce((a, b) => a + b, 0) / sceneMeasured.samples.length
        : 0,
      gpuMs: sceneGpuMs,
      samples: sceneMeasured.samples.slice(-240),
    });
    gl.deleteProgram(sceneProgram);
    gl.deleteBuffer(terrainBuffer);
    gl.deleteBuffer(terrainIndexBuffer);

    // ------------------------------------------------------------- particles
    throwIfAborted(options.signal);
    if (options.mode === 'full') await options.pause(timing.pauseBetweenGpuMs, 'Kurze Pause');
    throwIfAborted(options.signal);

    const simSize = 512;
    const simCount = simSize * simSize;
    // RGBA8 on every platform. Float render targets depend on an optional
    // extension and would change the bytes per texel, i.e. the workload itself.
    const simTargetA = makeTarget(gl, simSize, simSize, false);
    const simTargetB = makeTarget(gl, simSize, simSize, false);

    const initialiseSim = (target: Target) => {
      const count = simCount * 4;
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      const data = new Uint8Array(count);
      for (let i = 0; i < simCount; i++) {
        data[i * 4] = (i * 137) % 256;
        data[i * 4 + 1] = (i * 71 + 13) % 256;
        data[i * 4 + 2] = 128;
        data[i * 4 + 3] = 128;
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, simSize, simSize, gl.RGBA, gl.UNSIGNED_BYTE, data);
    };
    initialiseSim(simTargetA);
    initialiseSim(simTargetB);

    const simUpdateProgram = compile(gl, FS_TRIANGLE, SIM_UPDATE_FS, 'Simulation');
    const simUpdateUniforms = uniforms(gl, simUpdateProgram, ['uState', 'uRes', 'uTime', 'uDt']);
    const simRenderProgram = compile(gl, SIM_RENDER_VS, SIM_RENDER_FS, 'Partikel');
    const simRenderUniforms = uniforms(gl, simRenderProgram, ['uState', 'uSize']);
    const simVao = gl.createVertexArray();

    let source = simTargetA;
    let destination = simTargetB;
    let simTime = 0;
    let simStep = 0;
    const drawSim = () => {
      simTime += 0.016;
      simStep += 1;
      gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fb);
      gl.viewport(0, 0, simSize, simSize);
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(simUpdateProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(simUpdateUniforms.uState, 0);
      gl.uniform2f(simUpdateUniforms.uRes, simSize, simSize);
      gl.uniform1f(simUpdateUniforms.uTime, simTime);
      gl.uniform1f(simUpdateUniforms.uDt, 0.016);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (simStep % 6 === 0) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, simRenderTarget.fb);
        gl.viewport(0, 0, simSize, simSize);
        gl.useProgram(simRenderProgram);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, destination.tex);
        gl.uniform1i(simRenderUniforms.uState, 0);
        gl.uniform1f(simRenderUniforms.uSize, simSize);
        gl.bindVertexArray(simVao);
        gl.drawArrays(gl.POINTS, 0, simCount);
      }

      const swap = source;
      source = destination;
      destination = swap;
    };

    const simRenderTarget = makeTarget(gl, simSize, simSize, false);
    const simMeasured = await measure(
      simRenderTarget,
      drawSim,
      simCount,
      timing.gpuTestMs,
      'sim',
      GPU_TEST_INFO.sim.label,
      0.76,
      0.18,
    );
    const simGpuMs = await gpuTimePerFrame(drawSim, timerFrames(simMeasured));
    tests.push({
      id: 'sim',
      label: GPU_TEST_INFO.sim.label,
      detail: GPU_TEST_INFO.sim.detail,
      unit: GPU_TEST_INFO.sim.unit,
      value: simMeasured.value,
      score: normalize(simMeasured.value, GPU_REFERENCE.sim),
      avgFrameMs: simMeasured.samples.length
        ? simMeasured.samples.reduce((a, b) => a + b, 0) / simMeasured.samples.length
        : 0,
      gpuMs: simGpuMs,
      samples: simMeasured.samples.slice(-240),
    });

    gl.deleteProgram(simUpdateProgram);
    gl.deleteProgram(simRenderProgram);
    gl.deleteProgram(presentProgram);
    gl.deleteFramebuffer(shaderTarget.fb);
    gl.deleteTexture(shaderTarget.tex);
    gl.deleteFramebuffer(geoTarget.fb);
    gl.deleteTexture(geoTarget.tex);
    gl.deleteFramebuffer(sceneTarget.fb);
    gl.deleteTexture(sceneTarget.tex);
    gl.deleteFramebuffer(simTargetA.fb);
    gl.deleteTexture(simTargetA.tex);
    gl.deleteFramebuffer(simTargetB.fb);
    gl.deleteTexture(simTargetB.tex);
    gl.deleteFramebuffer(simRenderTarget.fb);
    gl.deleteTexture(simRenderTarget.tex);

    // --------------------------------------------------------- resolution
    if (options.mode === 'full') {
      throwIfAborted(options.signal);
      const scales = [1, 0.7, 0.5];
      const scalingProgram = compile(gl, FS_TRIANGLE, SHADER_TEST_FS, 'Skalierung');
      const scalingUniforms = uniforms(gl, scalingProgram, ['uRes', 'uIters', 'uPhase']);
      for (const scale of scales) {
        throwIfAborted(options.signal);
        const w = Math.max(64, Math.round(width * scale));
        const h = Math.max(64, Math.round(height * scale));
        const target = makeTarget(gl, w, h, false);
        let localPhase = 0;
        const draw = () => {
          gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
          gl.viewport(0, 0, w, h);
          gl.disable(gl.DEPTH_TEST);
          gl.useProgram(scalingProgram);
          gl.uniform2f(scalingUniforms.uRes, w, h);
          gl.uniform1i(scalingUniforms.uIters, 48);
          gl.uniform1f(scalingUniforms.uPhase, (localPhase += 0.37));
          gl.bindVertexArray(vao);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        };
        const measured = await measure(
          target,
          draw,
          w * h,
          timing.gpuScaleMs,
          'fragment',
          'Auflösungsabhängigkeit',
          0.95,
          0.04,
        );
        scaling.push({ scale, value: measured.value });
        gl.deleteFramebuffer(target.fb);
        gl.deleteTexture(target.tex);
        options.onProgress({
          test: 'scaling',
          label: 'Auflösungsabhängigkeit',
          fraction: 0.95 + (0.05 * (scales.indexOf(scale) + 1)) / scales.length,
          detail: `${Math.round(scale * 100)} % · ${(measured.value / 1e6).toFixed(1)} Mpx/s`,
        });
      }
      gl.deleteProgram(scalingProgram);
    }

    const gpuScore = Math.round(
      weightedMean(
        tests.map((test) => ({ value: test.score, weight: GPU_WEIGHTS[test.id] })),
      ),
    );

    options.onProgress({ test: 'scaling', label: 'GPU-Auswertung', fraction: 1 });

    return {
      score: gpuScore,
      tests,
      api: 'webgl2',
      renderer: renderer ?? null,
      vendor: vendor ?? null,
      software,
      timerQuery: Boolean(timerExt),
      resolution: { w: width, h: height },
      scaling,
      durationMs: Math.round(performance.now() - started),
    };
  } finally {
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.remove();
    const ext = gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}
