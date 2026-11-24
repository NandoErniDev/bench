/**
 * Particle Simulation — the same simulation twice: once entirely on the GPU
 * (ping-pong render targets) and once in JavaScript on the CPU. The two modes
 * are measured separately, which is as close as a browser gets to comparing CPU
 * and GPU cost for identical work.
 */

import { el, fmtNum, fmtInt } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { segmented, toggleControl } from '../ui/components';

const UPDATE_FS = `#version 300 es
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
  vel += vec2(n, m) * uDt * 0.9;
  vel *= 0.985;
  pos = fract(pos + vel * uDt * 0.06 + 1.0);
  outState = vec4(pos, vel * 0.45 + 0.5);
}`;

const POINT_VS_TEXTURE = `#version 300 es
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
  gl_PointSize = 2.0;
  vColor = vec3(0.35 + 0.65 * s.z, 0.5, 0.95 - 0.5 * s.w);
}`;

const POINT_VS_ATTRIBUTE = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec3 vColor;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  gl_PointSize = 2.0;
  vColor = vec3(0.35 + 0.35 * (aPos.x * 0.5 + 0.5), 0.5, 0.65 + 0.3 * (aPos.y * 0.5 + 0.5));
}`;

const POINT_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor, 1.0);
}`;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
}

const COUNTS = [
  { value: '65536', label: '65 536' },
  { value: '262144', label: '262 144' },
  { value: '1048576', label: '1 048 576' },
];

function makeTarget(gl: WebGL2RenderingContext, size: number): Target {
  const tex = gl.createTexture();
  const fb = gl.createFramebuffer();
  if (!tex || !fb) throw new Error('Partikel-State konnte nicht erstellt werden');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex };
}

export function mountParticles(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;

  let mode: 'gpu' | 'cpu' = 'gpu';
  let count = 262144;
  let simSize = Math.round(Math.sqrt(count));
  let clock = 0;
  let cpuSimMs = 0;
  let gpuSimMs: number | null = null;

  const updateProgram = compileProgram(gl, FS_TRIANGLE, UPDATE_FS, 'Partikel-Update');
  const updateUniforms = uniformMap(gl, updateProgram, ['uState', 'uRes', 'uTime', 'uDt']);
  const drawTextureProgram = compileProgram(gl, POINT_VS_TEXTURE, POINT_FS, 'Partikel-Draw');
  const drawTextureUniforms = uniformMap(gl, drawTextureProgram, ['uState', 'uSize']);
  const drawAttributeProgram = compileProgram(gl, POINT_VS_ATTRIBUTE, POINT_FS, 'Partikel-CPU-Draw');
  const pointVao = gl.createVertexArray();

  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
    | { TIME_ELAPSED_EXT: number }
    | null;
  let timerQuery: WebGLQuery | null = null;
  let timerRunning = false;

  let targets: [Target, Target] | null = null;
  let sourceIndex = 0;

  let cpuPositions: Float32Array | null = null;
  let cpuVelocities: Float32Array | null = null;
  let cpuRenderData: Float32Array | null = null;
  let cpuBuffer: WebGLBuffer | null = null;
  let cpuVao: WebGLVertexArrayObject | null = null;

  function disposeGpu(): void {
    if (!targets) return;
    for (const target of targets) {
      gl.deleteFramebuffer(target.fb);
      gl.deleteTexture(target.tex);
    }
    targets = null;
  }

  function buildGpu(): void {
    disposeGpu();
    simSize = Math.round(Math.sqrt(count));
    const first = makeTarget(gl, simSize);
    const second = makeTarget(gl, simSize);
    targets = [first, second];
    sourceIndex = 0;

    const data = new Uint8Array(simSize * simSize * 4);
    for (let i = 0; i < simSize * simSize; i++) {
      data[i * 4] = (i * 97 + 31) % 256;
      data[i * 4 + 1] = (i * 57 + 101) % 256;
      data[i * 4 + 2] = 128;
      data[i * 4 + 3] = 128;
    }
    for (const target of targets) {
      gl.bindTexture(gl.TEXTURE_2D, target.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, simSize, simSize, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }
  }

  function disposeCpu(): void {
    if (cpuBuffer) gl.deleteBuffer(cpuBuffer);
    if (cpuVao) gl.deleteVertexArray(cpuVao);
    cpuBuffer = null;
    cpuVao = null;
    cpuPositions = null;
    cpuVelocities = null;
    cpuRenderData = null;
  }

  function buildCpu(): void {
    disposeCpu();
    cpuPositions = new Float32Array(count * 2);
    cpuVelocities = new Float32Array(count * 2);
    cpuRenderData = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      cpuPositions[i * 2] = ((i * 0.6180339887) % 1) * 2 - 1;
      cpuPositions[i * 2 + 1] = ((i * 0.7548776662) % 1) * 2 - 1;
      cpuVelocities[i * 2] = 0;
      cpuVelocities[i * 2 + 1] = 0;
    }
    cpuBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, cpuBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, cpuRenderData, gl.DYNAMIC_DRAW);
    cpuVao = gl.createVertexArray();
    gl.bindVertexArray(cpuVao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  function rebuild(): void {
    if (mode === 'gpu') buildGpu();
    else buildCpu();
  }

  function gpuFrame(): void {
    if (!targets) buildGpu();
    if (!targets) return;
    if (timerQuery && !timerRunning && timerExt) {
      const available = gl.getQueryParameter(timerQuery, gl.QUERY_RESULT_AVAILABLE);
      if (available) {
        const ns = gl.getQueryParameter(timerQuery, gl.QUERY_RESULT) as number;
        gpuSimMs = ns / 1e6;
        gl.deleteQuery(timerQuery);
        timerQuery = null;
      }
    }

    const source = targets[sourceIndex];
    const destination = targets[1 - sourceIndex];

    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.fb);
    gl.viewport(0, 0, simSize, simSize);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(updateProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, source.tex);
    gl.uniform1i(updateUniforms.uState, 0);
    gl.uniform2f(updateUniforms.uRes, simSize, simSize);
    gl.uniform1f(updateUniforms.uTime, clock);
    gl.uniform1f(updateUniforms.uDt, 0.016);

    if (timerExt && !timerQuery) {
      timerQuery = gl.createQuery();
      if (timerQuery) {
        gl.beginQuery(timerExt.TIME_ELAPSED_EXT, timerQuery);
        timerRunning = true;
      }
    }

    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (timerRunning) {
      gl.endQuery(timerExt!.TIME_ELAPSED_EXT);
      timerRunning = false;
    }

    sourceIndex = 1 - sourceIndex;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.useProgram(drawTextureProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[sourceIndex].tex);
    gl.uniform1i(drawTextureUniforms.uState, 0);
    gl.uniform1f(drawTextureUniforms.uSize, simSize);
    gl.bindVertexArray(pointVao);
    gl.drawArrays(gl.POINTS, 0, simSize * simSize);

    surface.hudSet('sim', gpuSimMs === null ? 'n/a' : `${fmtNum(gpuSimMs, 2)} ms`);
  }

  function cpuFrame(): void {
    if (!cpuPositions || !cpuVelocities || !cpuRenderData) buildCpu();
    if (!cpuPositions || !cpuVelocities || !cpuRenderData || !cpuBuffer) return;

    const started = performance.now();
    const positions = cpuPositions;
    const velocities = cpuVelocities;
    const render = cpuRenderData;
    const t = clock;
    for (let i = 0; i < count; i++) {
      const index = i * 2;
      const x = positions[index];
      const y = positions[index + 1];
      const n = Math.sin(x * 12.9 + t) * Math.cos(y * 9.7 - t * 0.7);
      const m = Math.cos(x * 6.3 - t * 0.6) * Math.sin(y * 14.1 + t);
      let vx = (velocities[index] + n * 0.0009) * 0.985;
      let vy = (velocities[index + 1] + m * 0.0009) * 0.985;
      let px = x + vx * 0.0022;
      let py = y + vy * 0.0022;
      if (px > 1) px -= 2;
      else if (px < -1) px += 2;
      if (py > 1) py -= 2;
      else if (py < -1) py += 2;
      velocities[index] = vx;
      velocities[index + 1] = vy;
      positions[index] = px;
      positions[index + 1] = py;
      render[index] = px;
      render[index + 1] = py;
    }
    const elapsed = performance.now() - started;
    cpuSimMs = cpuSimMs * 0.85 + elapsed * 0.15;

    gl.bindBuffer(gl.ARRAY_BUFFER, cpuBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, render);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.useProgram(drawAttributeProgram);
    gl.bindVertexArray(cpuVao);
    gl.drawArrays(gl.POINTS, 0, count);

    surface.hudSet('sim', `${fmtNum(cpuSimMs, 2)} ms`);
    surface.hudSet('modus', 'CPU (JS)');
  }

  buildGpu();

  const modeSwitch = segmented<'gpu' | 'cpu'>(
    [
      { value: 'gpu', label: 'GPU · FBO' },
      { value: 'cpu', label: 'CPU · JS' },
    ],
    mode,
    (value) => {
      mode = value;
      if (mode === 'gpu') buildGpu();
      else buildCpu();
      surface.hudSet('modus', mode === 'gpu' ? 'GPU (FBO)' : 'CPU (JS)');
    },
  );

  const countSwitch = segmented<string>(
    COUNTS,
    '262144',
    (value) => {
      count = Number(value);
      rebuild();
    },
  );

  let paused = false;
  const pauseSwitch = toggleControl({
    label: 'Simulation anhalten',
    checked: false,
    onChange: (checked) => {
      paused = checked;
    },
  });

  const resetButton = el(
    'button',
    {
      class: 'btn secondary small',
      type: 'button',
      on: {
        click: () => {
          rebuild();
          cpuSimMs = 0;
          gpuSimMs = null;
        },
      },
    },
    'Partikel zurücksetzen',
  );

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Simulation')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        el('div', { class: 'control' }, el('label', null, 'Berechnung'), modeSwitch),
        el('div', { class: 'control' }, el('label', null, 'Partikelanzahl'), countSwitch),
        el('div', null, pauseSwitch),
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
        'Beide Modi führen dieselbe Integration aus: GPU im Ping-Pong-Render-Target, CPU in JavaScript. '
          + 'Angezeigt wird die reine Simulationszeit je Frame. Für den GPU-Pfad ist eine Timer-Query nötig; ohne diese Erweiterung bleibt der Wert „n/a". '
          + 'Prozentuale Auslastung von CPU oder GPU ist im Browser grundsätzlich nicht auslesbar.',
      ),
    ),
  );

  surface.hudSet('modus', 'GPU (FBO)');

  let last = performance.now();
  surface.start(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) clock += dt;
    surface.hudSet('partikel', fmtInt(count));
    if (mode === 'gpu') gpuFrame();
    else cpuFrame();
  });

  return {
    destroy() {
      disposeGpu();
      disposeCpu();
      if (timerQuery) gl.deleteQuery(timerQuery);
      gl.deleteProgram(updateProgram);
      gl.deleteProgram(drawTextureProgram);
      gl.deleteProgram(drawAttributeProgram);
      surface.destroy();
    },
  };
}
