/**
 * Schleimpilz-Netzwerk — Physarum-Polycephalum als GPGPU-Agentensimulation.
 * Hunderttausende Agenten tasten drei Sensoren in einem Pheromonfeld ab,
 * drehen sich danach und hinterlassen eine Spur. Zwischen den Schritten wird
 * die Spur verwischt und abgeschwächt — aus reinem Nachlaufen entstehen
 * Adernnetze, die wie Straßennetze aussehen und trotzdem aus keiner Regel
 * über Straßen entstehen.
 */

import { el, fmtInt } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl, toggleControl } from '../ui/components';

const AGENT_UPDATE = `#version 300 es
precision highp float;

uniform sampler2D uAgents;
uniform sampler2D uTrail;
uniform vec2 uAgentRes;
uniform float uSensorAngle;
uniform float uSensorDist;
uniform float uTurn;
uniform float uSpeed;
uniform float uJitter;
uniform float uTime;
out vec4 outState;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

float trailAt(vec2 p) {
  return texture(uTrail, fract(p)).r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uAgentRes;
  vec4 state = texture(uAgents, uv);
  vec2 pos = state.xy;
  float angle = state.z;

  vec2 forward = vec2(cos(angle), sin(angle));
  float centre = trailAt(pos + forward * uSensorDist);
  float left = trailAt(pos + vec2(cos(angle - uSensorAngle), sin(angle - uSensorAngle)) * uSensorDist);
  float right = trailAt(pos + vec2(cos(angle + uSensorAngle), sin(angle + uSensorAngle)) * uSensorDist);

  float rnd = hash21(gl_FragCoord.xy + vec2(uTime * 13.7, uTime * 5.3));

  if (centre > left && centre > right) {
    /* straight ahead is strongest: keep the heading */
  } else if (centre < left && centre < right) {
    angle += (rnd - 0.5) * uTurn * 4.0;
  } else if (left > right) {
    angle += uTurn;
  } else if (right > left) {
    angle -= uTurn;
  }
  angle += (rnd - 0.5) * uTurn * uJitter;

  pos += vec2(cos(angle), sin(angle)) * uSpeed;
  outState = vec4(fract(pos + 1.0), mod(angle, 6.2831853), 0.0);
}`;

const DEPOSIT_VS = `#version 300 es
precision highp float;
uniform sampler2D uAgents;
uniform vec2 uAgentRes;
void main() {
  int width = int(uAgentRes.x);
  ivec2 id = ivec2(gl_VertexID % width, gl_VertexID / width);
  vec4 state = texelFetch(uAgents, id, 0);
  gl_Position = vec4(state.xy * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}`;

const DEPOSIT_FS = `#version 300 es
precision highp float;
uniform float uDeposit;
out vec4 fragColor;
void main() {
  fragColor = vec4(uDeposit, 0.0, 0.0, 1.0);
}`;

const TRAIL_PASS = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform vec2 uTexel;
uniform float uDecay;
uniform float uDiffuse;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float c = texture(uTrail, uv).r;
  float sum = texture(uTrail, uv + vec2(-uTexel.x, 0.0)).r
            + texture(uTrail, uv + vec2(uTexel.x, 0.0)).r
            + texture(uTrail, uv + vec2(0.0, -uTexel.y)).r
            + texture(uTrail, uv + vec2(0.0, uTexel.y)).r
            + 0.5 * texture(uTrail, uv + vec2(-uTexel.x, -uTexel.y)).r
            + 0.5 * texture(uTrail, uv + vec2(uTexel.x, -uTexel.y)).r
            + 0.5 * texture(uTrail, uv + vec2(-uTexel.x, uTexel.y)).r
            + 0.5 * texture(uTrail, uv + vec2(uTexel.x, uTexel.y)).r;
  float blurred = mix(c, sum / 6.0, uDiffuse);
  fragColor = vec4(blurred * uDecay, 0.0, 0.0, 1.0);
}`;

const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uTrail;
uniform vec2 uRes;
uniform int uPalette;
out vec4 fragColor;

vec3 ramp(float v, int id) {
  if (id == 1) {
    vec3 a = vec3(0.05, 0.06, 0.10);
    vec3 b = vec3(0.95, 0.94, 0.97);
    vec3 c = vec3(0.99, 0.83, 0.52);
    return mix(mix(a, b, smoothstep(0.0, 0.55, v)), c, smoothstep(0.55, 1.0, v));
  }
  if (id == 2) {
    vec3 a = vec3(0.02, 0.05, 0.06);
    vec3 b = vec3(0.18, 0.85, 0.72);
    vec3 c = vec3(0.80, 1.0, 0.90);
    return mix(mix(a, b, smoothstep(0.0, 0.5, v)), c, smoothstep(0.5, 1.0, v));
  }
  if (id == 3) {
    vec3 a = vec3(0.06, 0.02, 0.06);
    vec3 b = vec3(0.95, 0.35, 0.62);
    vec3 c = vec3(1.0, 0.88, 0.72);
    return mix(mix(a, b, smoothstep(0.0, 0.5, v)), c, smoothstep(0.5, 1.0, v));
  }
  vec3 a = vec3(0.04, 0.05, 0.08);
  vec3 b = vec3(0.42, 0.55, 1.0);
  vec3 c = vec3(1.0, 0.96, 0.90);
  return mix(mix(a, b, smoothstep(0.0, 0.45, v)), c, smoothstep(0.45, 1.0, v));
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float v = texture(uTrail, uv).r;
  v = 1.0 - exp(-v * 0.32);
  vec3 col = ramp(v, uPalette);
  vec2 p = uv - 0.5;
  col *= 1.0 - 0.42 * dot(p, p);
  col += vec3(0.006);
  fragColor = vec4(col, 1.0);
}`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  size: number;
}

const AGENT_COUNTS = [
  { value: '256', label: '65 536' },
  { value: '512', label: '262 144' },
  { value: '1024', label: '1 048 576' },
  { value: '2048', label: '4 194 304' },
];

const TRAIL_SIZES = [
  { value: '1024', label: '1024 × 1024' },
  { value: '2048', label: '2048 × 2048' },
  { value: '3072', label: '3072 × 3072' },
  { value: '4096', label: '4096 × 4096' },
];

const PALETTES = [
  { value: '0', label: 'Azur' },
  { value: '1', label: 'Papier' },
  { value: '2', label: 'Mint' },
  { value: '3', label: 'Magento' },
];

export function mountPhysarum(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const floatRender = gl.getExtension('EXT_color_buffer_float');
  if (!floatRender) {
    surface.destroy();
    throw new Error('Das Schleimpilz-Netzwerk braucht Float-Renderziele (EXT_color_buffer_float).');
  }

  const agentProgram = compileProgram(gl, FS_TRIANGLE, AGENT_UPDATE, 'Physarum-Agenten');
  const agentUniforms = uniformMap(gl, agentProgram, [
    'uAgents',
    'uTrail',
    'uAgentRes',
    'uSensorAngle',
    'uSensorDist',
    'uTurn',
    'uSpeed',
    'uJitter',
    'uTime',
  ]);
  const depositProgram = compileProgram(gl, DEPOSIT_VS, DEPOSIT_FS, 'Physarum-Ablage');
  const depositUniforms = uniformMap(gl, depositProgram, ['uAgents', 'uAgentRes', 'uDeposit']);
  const trailProgram = compileProgram(gl, FS_TRIANGLE, TRAIL_PASS, 'Physarum-Spur');
  const trailUniforms = uniformMap(gl, trailProgram, ['uTrail', 'uTexel', 'uDecay', 'uDiffuse']);
  const displayProgram = compileProgram(gl, FS_TRIANGLE, DISPLAY, 'Physarum-Anzeige');
  const displayUniforms = uniformMap(gl, displayProgram, ['uTrail', 'uRes', 'uPalette']);

  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const state = {
    agents: 1024,
    trail: 2048,
    steps: 2,
    sensorAngle: 32,
    sensorPixels: 22,
    turn: 0.55,
    speed: 0.45,
    deposit: 0.18,
    decay: 0.945,
    diffuse: 0.62,
    jitter: 0.18,
    palette: 0,
    paused: false,
  };

  let agentTargets: [Target, Target];
  let trailTargets: [Target, Target];
  let agentIndex = 0;
  let trailIndex = 0;
  const allocated: Target[] = [];

  const createTarget = (size: number, format: number, type: number, filter: number): Target => {
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Simulationsziel konnte nicht erstellt werden');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, size, size, 0, gl.RGBA, type, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Das Float-Ziel für das Netzwerk ist unvollständig.');
    }
    gl.viewport(0, 0, size, size);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const target: Target = { texture, framebuffer, size };
    allocated.push(target);
    return target;
  };

  const dispose = () => {
    for (const target of allocated) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    allocated.length = 0;
  };

  const seedAgents = (target: Target) => {
    const size = target.size;
    const data = new Float32Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      // Irrational rotations spread the start positions evenly instead of in rows.
      const px = (i * 0.6180339887) % 1;
      const py = (i * 0.7548776662) % 1;
      const angle = ((i * 2.3999632297) % (Math.PI * 2)) + Math.random() * 0.4;
      data[i * 4] = px;
      data[i * 4 + 1] = py;
      data[i * 4 + 2] = angle;
      data[i * 4 + 3] = 1;
    }
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, size, size, gl.RGBA, gl.FLOAT, data);
  };

  const allocate = () => {
    dispose();
    const agentSize = Math.min(state.agents, maxTexture);
    const trailSize = Math.min(state.trail, maxTexture);
    agentTargets = [
      createTarget(agentSize, gl.RGBA32F, gl.FLOAT, gl.NEAREST),
      createTarget(agentSize, gl.RGBA32F, gl.FLOAT, gl.NEAREST),
    ];
    trailTargets = [
      createTarget(trailSize, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR),
      createTarget(trailSize, gl.RGBA16F, gl.HALF_FLOAT, gl.LINEAR),
    ];
    agentIndex = 0;
    trailIndex = 0;
    seedAgents(agentTargets[0]);
  };

  allocate();

  const bindTexture = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  const step = (time: number) => {
    const agentSize = agentTargets[0].size;
    const trailSize = trailTargets[0].size;
    const source = agentTargets[agentIndex];
    const destination = agentTargets[1 - agentIndex];

    gl.disable(gl.BLEND);
    gl.useProgram(agentProgram);
    bindTexture(0, source.texture);
    bindTexture(1, trailTargets[trailIndex].texture);
    gl.uniform1i(agentUniforms.uAgents, 0);
    gl.uniform1i(agentUniforms.uTrail, 1);
    gl.uniform2f(agentUniforms.uAgentRes, agentSize, agentSize);
    gl.uniform1f(agentUniforms.uSensorAngle, (state.sensorAngle * Math.PI) / 180);
    gl.uniform1f(agentUniforms.uSensorDist, state.sensorPixels / trailSize);
    gl.uniform1f(agentUniforms.uTurn, state.turn * 0.35);
    gl.uniform1f(agentUniforms.uSpeed, state.speed / trailSize);
    gl.uniform1f(agentUniforms.uJitter, state.jitter);
    gl.uniform1f(agentUniforms.uTime, time);
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination.framebuffer);
    gl.viewport(0, 0, agentSize, agentSize);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    agentIndex = 1 - agentIndex;

    const trailSource = trailTargets[trailIndex];
    const trailDestination = trailTargets[1 - trailIndex];

    gl.useProgram(trailProgram);
    bindTexture(0, trailSource.texture);
    gl.uniform1i(trailUniforms.uTrail, 0);
    gl.uniform2f(trailUniforms.uTexel, 1 / trailSize, 1 / trailSize);
    gl.uniform1f(trailUniforms.uDecay, state.decay);
    gl.uniform1f(trailUniforms.uDiffuse, state.diffuse);
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailDestination.framebuffer);
    gl.viewport(0, 0, trailSize, trailSize);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(depositProgram);
    bindTexture(1, agentTargets[agentIndex].texture);
    gl.uniform1i(depositUniforms.uAgents, 1);
    gl.uniform2f(depositUniforms.uAgentRes, agentSize, agentSize);
    gl.uniform1f(depositUniforms.uDeposit, state.deposit);
    gl.drawArrays(gl.POINTS, 0, agentSize * agentSize);
    gl.disable(gl.BLEND);

    trailIndex = 1 - trailIndex;
  };

  const precision = rangeControl({
    label: 'Schritte pro Bild',
    min: 1,
    max: 8,
    step: 1,
    value: state.steps,
    format: (value) => `${value} ×`,
    onInput: (value) => {
      state.steps = value;
    },
  });

  const sensorAngleControl = rangeControl({
    label: 'Sensorwinkel',
    min: 4,
    max: 180,
    step: 1,
    value: state.sensorAngle,
    format: (value) => `${value}°`,
    onInput: (value) => {
      state.sensorAngle = value;
    },
  });

  const sensorDistanceControl = rangeControl({
    label: 'Sensorabstand',
    min: 2,
    max: 64,
    step: 1,
    value: state.sensorPixels,
    format: (value) => `${value} px`,
    onInput: (value) => {
      state.sensorPixels = value;
    },
  });

  const speedControl = rangeControl({
    label: 'Tempo',
    min: 0.2,
    max: 4,
    step: 0.05,
    value: state.speed,
    format: (value) => `${value.toFixed(2).replace('.', ',')} px`,
    onInput: (value) => {
      state.speed = value;
    },
  });

  const turnControl = rangeControl({
    label: 'Drehrate',
    min: 0.05,
    max: 2,
    step: 0.01,
    value: state.turn,
    format: (value) => `${value.toFixed(2).replace('.', ',')} rad`,
    onInput: (value) => {
      state.turn = value;
    },
  });

  const depositControl = rangeControl({
    label: 'Spurmenge',
    min: 0.05,
    max: 6,
    step: 0.05,
    value: state.deposit,
    format: (value) => value.toFixed(2).replace('.', ',') + ' ×',
    onInput: (value) => {
      state.deposit = value;
    },
  });

  const decayControl = rangeControl({
    label: 'Spur-Zerfall',
    min: 0.88,
    max: 1,
    step: 0.002,
    value: state.decay,
    format: (value) => value.toFixed(3).replace('.', ','),
    onInput: (value) => {
      state.decay = value;
    },
  });

  const diffuseControl = rangeControl({
    label: 'Verwischung',
    min: 0,
    max: 1,
    step: 0.02,
    value: state.diffuse,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => {
      state.diffuse = value;
    },
  });

  const agentControl = selectControl({
    label: 'Agenten',
    values: AGENT_COUNTS,
    value: '1024',
    onChange: (value) => {
      state.agents = Number(value);
      allocate();
    },
  });

  const trailControl = selectControl({
    label: 'Spur-Raster',
    values: TRAIL_SIZES,
    value: '2048',
    onChange: (value) => {
      state.trail = Number(value);
      allocate();
    },
  });

  const paletteControl = selectControl({
    label: 'Farbwelt',
    values: PALETTES,
    value: '0',
    onChange: (value) => {
      state.palette = Number(value);
    },
  });

  const pauseToggle = toggleControl({
    label: 'Simulation anhalten',
    checked: false,
    onChange: (checked) => {
      state.paused = checked;
    },
  });

  const reseed = el(
    'button',
    { class: 'btn secondary small', type: 'button', on: { click: () => allocate() } },
    'Netzwerk neu starten',
  );

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Netzwerk')),
      el(
        'div',
        { class: 'stack', style: 'gap:14px' },
        agentControl,
        trailControl,
        precision.node,
        paletteControl,
        sensorAngleControl.node,
        sensorDistanceControl.node,
        speedControl.node,
        turnControl.node,
        depositControl.node,
        decayControl.node,
        diffuseControl.node,
        el('div', null, pauseToggle),
        reseed,
      ),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Jeder Agent liest drei Sensoren aus einer Float-Textur, dreht sich, läuft weiter und schreibt einen Punkt additiv in die Spur. '
          + 'Danach wird die Spur in einem zweiten Durchgang verwischt und gedämpft. Bei 1 048 576 Agenten und 2 Schritten pro Bild sind das '
          + 'über zwei Millionen Sensorabfragen und genauso viele additive Punkte pro Bild — ohne einen einzigen CPU-Zugriff.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Kein Eingriff nötig — das Netzwerk wächst von selbst.'),
    ),
  );

  let clock = 0;
  let last = performance.now();

  surface.start((_time, metrics) => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!state.paused) {
      clock += dt;
      for (let i = 0; i < state.steps; i++) step(clock + i * 0.01);
    }

    gl.useProgram(displayProgram);
    bindTexture(0, trailTargets[trailIndex].texture);
    gl.uniform1i(displayUniforms.uTrail, 0);
    gl.uniform2f(displayUniforms.uRes, surface.width, surface.height);
    gl.uniform1i(displayUniforms.uPalette, state.palette);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, surface.width, surface.height);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const agentSize = agentTargets[0].size;
    const agents = agentSize * agentSize;
    const updates = agents * state.steps * metrics.fps;
    surface.hudSet('agenten', fmtInt(agents));
    surface.hudSet('schritte', `${state.steps}/Bild`);
    surface.hudSet('abfragen/s', `${(updates * 3 / 1e6).toFixed(1)} M/s`);
  });

  return {
    destroy() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      dispose();
      gl.deleteProgram(agentProgram);
      gl.deleteProgram(depositProgram);
      gl.deleteProgram(trailProgram);
      gl.deleteProgram(displayProgram);
      surface.destroy();
    },
  };
}
