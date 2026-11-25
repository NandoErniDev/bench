/**
 * GPU Fluid — incompressible Navier-Stokes on the GPU: advection, vorticity
 * confinement and a Jacobi pressure solve with dozens of full-grid passes per
 * frame. Resolution and iteration count directly scale the load.
 */

import { el } from '../core/util';
import { LabSurface, compileProgram, uniformMap, FS_TRIANGLE } from './gl';
import { rangeControl, selectControl, toggleControl } from '../ui/components';

const ADVECT = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uDt;
uniform float uDissipation;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 vel = texture(uVelocity, uv).xy;
  vec2 coord = clamp(uv - uDt * vel * uTexel, vec2(0.0), vec2(1.0));
  vec4 result = texture(uSource, coord);
  fragColor = result / (1.0 + uDissipation * uDt);
}`;

const SPLAT = `#version 300 es
precision highp float;
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec3 uColor;
uniform float uRadius;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uTarget, 0));
  vec2 delta = uv - uPoint;
  float falloff = exp(-dot(delta, delta) / uRadius);
  vec4 base = texture(uTarget, uv);
  fragColor = base + vec4(uColor * falloff, 0.0);
}`;

const CURL = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float left = texture(uVelocity, uv - vec2(uTexel.x, 0.0)).y;
  float right = texture(uVelocity, uv + vec2(uTexel.x, 0.0)).y;
  float bottom = texture(uVelocity, uv - vec2(0.0, uTexel.y)).x;
  float top = texture(uVelocity, uv + vec2(0.0, uTexel.y)).x;
  fragColor = vec4((right - left - top + bottom) * 0.5, 0.0, 0.0, 1.0);
}`;

const VORTICITY = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform vec2 uTexel;
uniform float uStrength;
uniform float uDt;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float left = texture(uCurl, uv - vec2(uTexel.x, 0.0)).x;
  float right = texture(uCurl, uv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture(uCurl, uv - vec2(0.0, uTexel.y)).x;
  float top = texture(uCurl, uv + vec2(0.0, uTexel.y)).x;
  float center = texture(uCurl, uv).x;
  vec2 force = 0.5 * vec2(abs(top) - abs(bottom), abs(right) - abs(left));
  force /= length(force) + 1e-4;
  force *= uStrength * center;
  force.y *= -1.0;
  vec2 velocity = texture(uVelocity, uv).xy + force * uDt;
  fragColor = vec4(clamp(velocity, vec2(-2000.0), vec2(2000.0)), 0.0, 1.0);
}`;

const DIVERGENCE = `#version 300 es
precision highp float;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  vec2 center = texture(uVelocity, uv).xy;
  float left = texture(uVelocity, uv - vec2(uTexel.x, 0.0)).x;
  float right = texture(uVelocity, uv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture(uVelocity, uv - vec2(0.0, uTexel.y)).y;
  float top = texture(uVelocity, uv + vec2(0.0, uTexel.y)).y;
  if (uv.x < uTexel.x) left = -center.x;
  if (uv.x > 1.0 - uTexel.x) right = -center.x;
  if (uv.y < uTexel.y) bottom = -center.y;
  if (uv.y > 1.0 - uTexel.y) top = -center.y;
  fragColor = vec4((right - left + top - bottom) * 0.5, 0.0, 0.0, 1.0);
}`;

const PRESSURE = `#version 300 es
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
uniform vec2 uTexel;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float left = texture(uPressure, uv - vec2(uTexel.x, 0.0)).x;
  float right = texture(uPressure, uv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture(uPressure, uv - vec2(0.0, uTexel.y)).x;
  float top = texture(uPressure, uv + vec2(0.0, uTexel.y)).x;
  float divergence = texture(uDivergence, uv).x;
  fragColor = vec4((left + right + bottom + top - divergence) * 0.25, 0.0, 0.0, 1.0);
}`;

const GRADIENT = `#version 300 es
precision highp float;
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
uniform vec2 uTexel;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy * uTexel;
  float left = texture(uPressure, uv - vec2(uTexel.x, 0.0)).x;
  float right = texture(uPressure, uv + vec2(uTexel.x, 0.0)).x;
  float bottom = texture(uPressure, uv - vec2(0.0, uTexel.y)).x;
  float top = texture(uPressure, uv + vec2(0.0, uTexel.y)).x;
  vec2 velocity = texture(uVelocity, uv).xy - vec2(right - left, top - bottom) * 0.5;
  fragColor = vec4(velocity, 0.0, 1.0);
}`;

const DECAY = `#version 300 es
precision highp float;
uniform sampler2D uSource;
uniform float uFactor;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSource, 0));
  fragColor = texture(uSource, uv) * uFactor;
}`;

const DISPLAY = `#version 300 es
precision highp float;
uniform sampler2D uDye;
uniform vec2 uRes;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 color = texture(uDye, uv).rgb;
  color = color / (1.0 + color);
  color = pow(max(color, vec3(0.0)), vec3(1.0 / 1.9));
  vec2 p = uv - 0.5;
  color *= 1.0 - 0.55 * dot(p, p);
  color += vec3(0.012, 0.014, 0.02);
  fragColor = vec4(color, 1.0);
}`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface PingPong {
  read: Target;
  write: Target;
  width: number;
  height: number;
  swap: () => void;
}

interface Pass {
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

const PALETTE: Array<[number, number, number]> = [
  [0.9, 0.35, 0.1],
  [0.15, 0.55, 0.95],
  [0.95, 0.75, 0.2],
  [0.3, 0.85, 0.55],
  [0.75, 0.3, 0.95],
];

export function mountFluid(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host);
  const gl = surface.gl;
  const floatSupport = gl.getExtension('EXT_color_buffer_float') ?? gl.getExtension('EXT_color_buffer_half_float');
  if (!floatSupport) {
    surface.destroy();
    throw new Error(
      'Die Fluidsimulation braucht Float-Renderziele (EXT_color_buffer_float). Dieser Browser oder diese GPU bietet sie nicht an.',
    );
  }

  const make = (fragment: string, label: string, names: string[]): Pass => {
    const program = compileProgram(gl, FS_TRIANGLE, fragment, label);
    return { program, uniforms: uniformMap(gl, program, names) };
  };

  const advect = make(ADVECT, 'Fluid-Advektion', ['uVelocity', 'uSource', 'uTexel', 'uDt', 'uDissipation']);
  const splatPass = make(SPLAT, 'Fluid-Splat', ['uTarget', 'uPoint', 'uColor', 'uRadius']);
  const curlPass = make(CURL, 'Fluid-Curl', ['uVelocity', 'uTexel']);
  const vorticityPass = make(VORTICITY, 'Fluid-Wirbel', ['uVelocity', 'uCurl', 'uTexel', 'uStrength', 'uDt']);
  const divergencePass = make(DIVERGENCE, 'Fluid-Divergenz', ['uVelocity', 'uTexel']);
  const pressurePass = make(PRESSURE, 'Fluid-Druck', ['uPressure', 'uDivergence', 'uTexel']);
  const gradientPass = make(GRADIENT, 'Fluid-Gradient', ['uPressure', 'uVelocity', 'uTexel']);
  const decayPass = make(DECAY, 'Fluid-Abklingen', ['uSource', 'uFactor']);
  const displayPass = make(DISPLAY, 'Fluid-Anzeige', ['uDye', 'uRes']);

  let allocated: Target[] = [];

  const createTarget = (width: number, height: number, filter: number): Target => {
    const texture = gl.createTexture();
    if (!texture) throw new Error('Textur konnte nicht erstellt werden');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error('Framebuffer konnte nicht erstellt werden');
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Float-Framebuffer unvollständig (Status ${status})`);
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const target: Target = { texture, framebuffer, width, height };
    allocated.push(target);
    return target;
  };

  const createPingPong = (width: number, height: number, filter: number): PingPong => {
    let a = createTarget(width, height, filter);
    let b = createTarget(width, height, filter);
    return {
      get read() {
        return a;
      },
      get write() {
        return b;
      },
      width,
      height,
      swap() {
        const temporary = a;
        a = b;
        b = temporary;
      },
    };
  };

  const state = { simRes: 256, pressureIterations: 28, dyeDecay: 0.9, auto: true };

  let velocity: PingPong;
  let dye: PingPong;
  let pressure: PingPong;
  let divergence: Target;
  let curl: Target;
  let dyeRes = 0;

  const allocate = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (const target of allocated) {
      gl.deleteTexture(target.texture);
      gl.deleteFramebuffer(target.framebuffer);
    }
    allocated = [];
    dyeRes = Math.min(1024, state.simRes * 2);
    velocity = createPingPong(state.simRes, state.simRes, gl.LINEAR);
    dye = createPingPong(dyeRes, dyeRes, gl.LINEAR);
    pressure = createPingPong(state.simRes, state.simRes, gl.NEAREST);
    divergence = createTarget(state.simRes, state.simRes, gl.NEAREST);
    curl = createTarget(state.simRes, state.simRes, gl.NEAREST);
  };

  allocate();

  const bind = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  const draw = (target: Target | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
    gl.viewport(0, 0, target ? target.width : surface.width, target ? target.height : surface.height);
    gl.bindVertexArray(surface.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const splat = (
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: [number, number, number],
    radius: number,
  ) => {
    gl.useProgram(splatPass.program);
    gl.disable(gl.BLEND);
    bind(0, velocity.read.texture);
    gl.uniform1i(splatPass.uniforms.uTarget, 0);
    gl.uniform2f(splatPass.uniforms.uPoint, x, y);
    gl.uniform3f(splatPass.uniforms.uColor, vx, vy, 0);
    gl.uniform1f(splatPass.uniforms.uRadius, radius);
    draw(velocity.write);
    velocity.swap();

    bind(0, dye.read.texture);
    gl.uniform1i(splatPass.uniforms.uTarget, 0);
    gl.uniform2f(splatPass.uniforms.uPoint, x, y);
    gl.uniform3f(splatPass.uniforms.uColor, color[0], color[1], color[2]);
    gl.uniform1f(splatPass.uniforms.uRadius, radius);
    draw(dye.write);
    dye.swap();
  };

  const toUv = (clientX: number, clientY: number) => {
    const rect = surface.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / Math.max(1, rect.width),
      y: 1 - (clientY - rect.top) / Math.max(1, rect.height),
    };
  };

  const pointers = new Map<number, { x: number; y: number }>();

  const onPointerDown = (event: PointerEvent) => {
    surface.canvas.setPointerCapture(event.pointerId);
    const uv = toUv(event.clientX, event.clientY);
    pointers.set(event.pointerId, uv);
    splat(uv.x, uv.y, 0, 0, PALETTE[Math.floor(Math.random() * PALETTE.length)], 0.0006);
  };

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    const uv = toUv(event.clientX, event.clientY);
    pointers.set(event.pointerId, uv);
    const scale = state.simRes * 30;
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    splat(
      uv.x,
      uv.y,
      (uv.x - previous.x) * scale,
      (uv.y - previous.y) * scale,
      [color[0] * 0.9, color[1] * 0.9, color[2] * 0.9],
      0.0005,
    );
  };

  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);

  const simControl = selectControl({
    label: 'Simulationsraster',
    values: [
      { value: '128', label: '128 × 128' },
      { value: '256', label: '256 × 256' },
      { value: '384', label: '384 × 384' },
      { value: '512', label: '512 × 512' },
    ],
    value: String(state.simRes),
    onChange: (value) => {
      state.simRes = Number(value);
      allocate();
    },
  });

  const iterationControl = rangeControl({
    label: 'Druck-Iterationen',
    min: 4,
    max: 64,
    step: 2,
    value: state.pressureIterations,
    format: (value) => `${value} ×`,
    onInput: (value) => {
      state.pressureIterations = value;
    },
  });

  const decayControl = rangeControl({
    label: 'Farbauflösung',
    min: 0.2,
    max: 2.4,
    step: 0.1,
    value: state.dyeDecay,
    format: (value) => `${value.toFixed(1)} ×`,
    onInput: (value) => {
      state.dyeDecay = value;
    },
  });

  const autoToggle = toggleControl({
    label: 'Automatische Impulse',
    checked: true,
    onChange: (checked) => {
      state.auto = checked;
    },
  });

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Simulation')),
      el('div', { class: 'stack', style: 'gap:14px' }, simControl, iterationControl.node, decayControl.node, el('div', null, autoToggle)),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Pro Frame laufen Advektion, Wirbelstärke, Divergenz, Abklingen, alle Druck-Iterationen und der Gradientenabzug über das komplette Raster — '
          + 'jeder Durchlauf schreibt ein Float-Ziel. Bei 256² und 28 Iterationen sind das fast zwei Millionen Texel-Schreibvorgänge pro Bild, '
          + 'bevor das erste Pixel auf dem Bildschirm erscheint.',
      ),
      el('p', { class: 'footnote', style: 'margin-top:8px' }, 'Ziehen: Farbe und Impuls einspritzen'),
    ),
  );

  let last = performance.now();
  let autoTimer = 0;

  surface.start((_time, metrics) => {
    const now = performance.now();
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
    last = now;

    if (state.auto) {
      autoTimer += dt;
      if (autoTimer > 0.65) {
        autoTimer = 0;
        const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        splat(
          0.2 + Math.random() * 0.6,
          0.2 + Math.random() * 0.6,
          (Math.random() - 0.5) * state.simRes * 1.2,
          (Math.random() - 0.5) * state.simRes * 1.2,
          [color[0], color[1], color[2]],
          0.0008,
        );
      }
    }

    const texel: [number, number] = [1 / state.simRes, 1 / state.simRes];

    gl.useProgram(curlPass.program);
    bind(0, velocity.read.texture);
    gl.uniform1i(curlPass.uniforms.uVelocity, 0);
    gl.uniform2f(curlPass.uniforms.uTexel, texel[0], texel[1]);
    draw(curl);

    gl.useProgram(vorticityPass.program);
    bind(0, velocity.read.texture);
    bind(1, curl.texture);
    gl.uniform1i(vorticityPass.uniforms.uVelocity, 0);
    gl.uniform1i(vorticityPass.uniforms.uCurl, 1);
    gl.uniform2f(vorticityPass.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform1f(vorticityPass.uniforms.uStrength, 24);
    gl.uniform1f(vorticityPass.uniforms.uDt, dt);
    draw(velocity.write);
    velocity.swap();

    gl.useProgram(divergencePass.program);
    bind(0, velocity.read.texture);
    gl.uniform1i(divergencePass.uniforms.uVelocity, 0);
    gl.uniform2f(divergencePass.uniforms.uTexel, texel[0], texel[1]);
    draw(divergence);

    gl.useProgram(decayPass.program);
    bind(0, pressure.read.texture);
    gl.uniform1i(decayPass.uniforms.uSource, 0);
    gl.uniform1f(decayPass.uniforms.uFactor, 0.82);
    draw(pressure.write);
    pressure.swap();

    gl.useProgram(pressurePass.program);
    bind(1, divergence.texture);
    gl.uniform1i(pressurePass.uniforms.uDivergence, 1);
    gl.uniform2f(pressurePass.uniforms.uTexel, texel[0], texel[1]);
    for (let i = 0; i < state.pressureIterations; i++) {
      bind(0, pressure.read.texture);
      gl.uniform1i(pressurePass.uniforms.uPressure, 0);
      draw(pressure.write);
      pressure.swap();
    }

    gl.useProgram(gradientPass.program);
    bind(0, pressure.read.texture);
    bind(1, velocity.read.texture);
    gl.uniform1i(gradientPass.uniforms.uPressure, 0);
    gl.uniform1i(gradientPass.uniforms.uVelocity, 1);
    gl.uniform2f(gradientPass.uniforms.uTexel, texel[0], texel[1]);
    draw(velocity.write);
    velocity.swap();

    gl.useProgram(advect.program);
    gl.uniform1i(advect.uniforms.uVelocity, 0);
    gl.uniform1i(advect.uniforms.uSource, 1);
    gl.uniform1f(advect.uniforms.uDt, dt);
    bind(0, velocity.read.texture);
    bind(1, velocity.read.texture);
    gl.uniform2f(advect.uniforms.uTexel, texel[0], texel[1]);
    gl.uniform1f(advect.uniforms.uDissipation, 0.25);
    draw(velocity.write);
    velocity.swap();

    const dyeTexel: [number, number] = [1 / dye.width, 1 / dye.height];
    bind(0, velocity.read.texture);
    bind(1, dye.read.texture);
    gl.uniform2f(advect.uniforms.uTexel, dyeTexel[0], dyeTexel[1]);
    gl.uniform1f(advect.uniforms.uDissipation, state.dyeDecay);
    draw(dye.write);
    dye.swap();

    gl.useProgram(displayPass.program);
    bind(0, dye.read.texture);
    gl.uniform1i(displayPass.uniforms.uDye, 0);
    gl.uniform2f(displayPass.uniforms.uRes, surface.width, surface.height);
    draw(null);

    const passes = state.pressureIterations + 8;
    surface.hudSet('passes', `${passes} × ${state.simRes}²`);
    surface.hudSet('Mtex/s', `${((state.simRes * state.simRes * passes * metrics.fps) / 1e6).toFixed(1)} Mtex/s`);
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (const target of allocated) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
      for (const item of [advect, splatPass, curlPass, vorticityPass, divergencePass, pressurePass, gradientPass, decayPass, displayPass]) {
        gl.deleteProgram(item.program);
      }
      surface.destroy();
    },
  };
}
