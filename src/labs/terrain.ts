/**
 * 3D Rendering — procedural terrain with directional lighting and a real
 * shadow map pass. Detail level and render resolution are adjustable, so the
 * frame-rate change is directly attributable to geometry and fill cost.
 */

import { el, fmtNum, fmtInt } from '../core/util';
import { LabSurface, compileProgram, uniformMap } from './gl';
import { rangeControl, toggleControl } from '../ui/components';

const DEPTH_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
uniform mat4 uLightVP;
void main() {
  gl_Position = uLightVP * vec4(aPos, 1.0);
}`;

const DEPTH_FS = `#version 300 es
precision mediump float;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0);
}`;

const TERRAIN_VS = `#version 300 es
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNormal;
uniform mat4 uProj;
uniform mat4 uView;
uniform mat4 uLightVP;
out vec3 vNormal;
out vec3 vWorld;
out vec4 vLightPos;
out float vHeight;
void main() {
  vNormal = aNormal;
  vWorld = aPos;
  vHeight = aPos.y;
  vLightPos = uLightVP * vec4(aPos, 1.0);
  gl_Position = uProj * uView * vec4(aPos, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec4 vLightPos;
in float vHeight;
uniform vec3 uEye;
uniform sampler2D uShadow;
uniform int uShadows;
out vec4 fragColor;

float shadowFactor() {
  if (uShadows == 0) return 1.0;
  vec3 proj = vLightPos.xyz / vLightPos.w;
  proj = proj * 0.5 + 0.5;
  if (proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0 || proj.z > 1.0) return 1.0;
  float bias = 0.0022;
  vec2 texel = 1.0 / vec2(textureSize(uShadow, 0));
  float sum = 0.0;
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float depth = texture(uShadow, proj.xy + vec2(float(x), float(y)) * texel).r;
      sum += (proj.z - bias) > depth ? 0.0 : 1.0;
    }
  }
  return sum / 9.0;
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(0.6, 0.8, 0.4));
  vec3 v = normalize(uEye - vWorld);
  float diff = max(dot(n, l), 0.0);
  float shadow = shadowFactor();
  vec3 h = normalize(l + v);
  float spec = pow(max(dot(n, h), 0.0), 42.0) * 0.35 * shadow;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.25;
  vec3 rock = mix(vec3(0.10, 0.125, 0.16), vec3(0.55, 0.6, 0.64), smoothstep(-0.45, 0.5, vHeight));
  vec3 snow = vec3(0.82, 0.86, 0.92) * smoothstep(0.34, 0.52, vHeight);
  vec3 base = mix(rock, snow, smoothstep(0.36, 0.5, vHeight) * 0.85);
  float ambient = 0.22 + 0.12 * smoothstep(-0.6, 0.6, vHeight);
  vec3 color = base * (ambient + 0.95 * diff * shadow) + spec + rim;
  float fog = 1.0 - exp(-max(0.0, length(uEye - vWorld) - 2.0) * 0.16);
  color = mix(color, vec3(0.045, 0.055, 0.07), clamp(fog, 0.0, 0.75));
  fragColor = vec4(color, 1.0);
}`;

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

function lookAt(eye: [number, number, number], centre: [number, number, number], up: [number, number, number]): Float32Array {
  const z = [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]];
  const zl = Math.hypot(z[0], z[1], z[2]) || 1;
  z[0] /= zl;
  z[1] /= zl;
  z[2] /= zl;
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

function ortho(left: number, right: number, bottom: number, top: number, near: number, far: number): Float32Array {
  const out = new Float32Array(16);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = -2 / (far - near);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = -(far + near) / (far - near);
  out[15] = 1;
  return out;
}

function heightAt(x: number, z: number): number {
  return (
    Math.sin(x * 2.3 + 0.4) * Math.cos(z * 1.9 - 0.3) * 0.42 +
    Math.sin(x * 5.7 - 1.1) * Math.cos(z * 4.9 + 0.8) * 0.2 +
    Math.sin(x * 13.1 + 2.2) * Math.cos(z * 11.7 - 1.4) * 0.08
  );
}

function buildTerrain(grid: number) {
  const size = 3.2;
  const count = (grid + 1) * (grid + 1);
  const data = new Float32Array(count * 6);
  const step = size / grid;
  const eps = step * 0.4;
  let offset = 0;
  for (let iz = 0; iz <= grid; iz++) {
    for (let ix = 0; ix <= grid; ix++) {
      const x = -size / 2 + ix * step;
      const z = -size / 2 + iz * step;
      const y = heightAt(x, z);
      const dx = heightAt(x + eps, z) - heightAt(x - eps, z);
      const dz = heightAt(x, z + eps) - heightAt(x, z - eps);
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
  return { data, indices, triangles: grid * grid * 2 };
}

export function mountTerrain(host: HTMLElement, controls: HTMLElement): { destroy: () => void } {
  const surface = new LabSurface(host, { depth: true });
  const gl = surface.gl;

  const depthProgram = compileProgram(gl, DEPTH_VS, DEPTH_FS, 'Terrain-Schatten');
  const depthUniforms = uniformMap(gl, depthProgram, ['uLightVP']);
  const mainProgram = compileProgram(gl, TERRAIN_VS, TERRAIN_FS, 'Terrain');
  const mainUniforms = uniformMap(gl, mainProgram, ['uProj', 'uView', 'uLightVP', 'uEye', 'uShadow', 'uShadows']);

  const shadowSize = 1024;
  const shadowTexture = gl.createTexture();
  const shadowFramebuffer = gl.createFramebuffer();
  if (!shadowTexture || !shadowFramebuffer) throw new Error('Schatten-Target konnte nicht erstellt werden');
  gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.DEPTH_COMPONENT24,
    shadowSize,
    shadowSize,
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTexture, 0);
  gl.drawBuffers([gl.NONE]);
  gl.readBuffer(gl.NONE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const lightEye: [number, number, number] = [2.6, 3.4, 1.9];
  const lightVP = (() => {
    const view = lookAt(lightEye, [0, 0, 0], [0, 1, 0]);
    const proj = ortho(-2.6, 2.6, -2.6, 2.6, 0.2, 12);
    const out = new Float32Array(16);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) sum += proj[k * 4 + row] * view[col * 4 + k];
        out[col * 4 + row] = sum;
      }
    }
    return out;
  })();

  const state = { detail: 192, shadows: true, rotate: true, radius: 3.6, angle: 0.9, height: 1.9 };
  let mesh: ReturnType<typeof buildTerrain> | null = null;
  let vertexBuffer: WebGLBuffer | null = null;
  let indexBuffer: WebGLBuffer | null = null;
  let vao: WebGLVertexArrayObject | null = null;

  function disposeMesh(): void {
    if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
    if (indexBuffer) gl.deleteBuffer(indexBuffer);
    if (vao) gl.deleteVertexArray(vao);
    vertexBuffer = null;
    indexBuffer = null;
    vao = null;
  }

  function buildMesh(): void {
    disposeMesh();
    mesh = buildTerrain(state.detail);
    vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
    indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);
  }

  buildMesh();

  // ----------------------------------------------------------- interaction
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onPointerDown = (event: PointerEvent) => {
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
    surface.canvas.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    state.angle -= (event.clientX - lastX) * 0.006;
    state.height = Math.min(3.6, Math.max(0.6, state.height + (event.clientY - lastY) * 0.008));
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = () => {
    dragging = false;
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    state.radius = Math.min(7, Math.max(1.8, state.radius + event.deltaY * 0.003));
  };

  surface.canvas.addEventListener('pointerdown', onPointerDown);
  surface.canvas.addEventListener('pointermove', onPointerMove);
  surface.canvas.addEventListener('pointerup', onPointerUp);
  surface.canvas.addEventListener('pointercancel', onPointerUp);
  surface.canvas.addEventListener('wheel', onWheel, { passive: false });

  // -------------------------------------------------------------- controls
  const detailControl = rangeControl({
    label: 'Detailgrad (Gitter)',
    min: 64,
    max: 320,
    step: 32,
    value: state.detail,
    format: (value) => `${value}²`,
    onInput: (value) => {
      state.detail = value;
      buildMesh();
    },
  });

  const resolutionControl = rangeControl({
    label: 'Renderauflösung',
    min: 0.4,
    max: 1.5,
    step: 0.05,
    value: 1,
    format: (value) => `${Math.round(value * 100)} %`,
    onInput: (value) => surface.setScale(value),
  });

  const shadowToggle = toggleControl({
    label: 'Schatten (Shadow Map)',
    checked: true,
    onChange: (checked) => {
      state.shadows = checked;
    },
  });

  const rotateToggle = toggleControl({
    label: 'Kamera automatisch drehen',
    checked: true,
    onChange: (checked) => {
      state.rotate = checked;
    },
  });

  controls.append(
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Szene')),
      el('div', { class: 'stack', style: 'gap:14px' }, detailControl.node, resolutionControl.node, el('div', null, shadowToggle), el('div', null, rotateToggle)),
      el('p', { class: 'footnote', style: 'margin-top:10px' }, 'Ziehen: Kamera drehen · Mausrad: Abstand'),
    ),
    el(
      'div',
      { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', null, 'Messung')),
      el(
        'p',
        { class: 'footnote', style: 'line-height:1.6' },
        'Die Landschaft wird prozedural erzeugt und in zwei Durchgängen gerendert: Schattenwurf aus Sicht der Lichtquelle, danach die beleuchtete Szene mit 3×3-PCF-Schatten. '
          + 'Detailgrad und Auflösung verändern Dreiecks- und Fülllast direkt; die HUD-Anzeige zeigt Dreiecke und reale Frame-Zeit.',
      ),
    ),
  );

  let rotation = 0;
  surface.start(() => {
    if (!mesh || !vao) return;
    if (state.rotate && !dragging) rotation += 0.0025;
    const angle = state.angle + rotation;
    const eye: [number, number, number] = [
      Math.sin(angle) * state.radius,
      state.height,
      Math.cos(angle) * state.radius,
    ];

    const { width, height } = surface;

    if (state.shadows) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFramebuffer);
      gl.viewport(0, 0, shadowSize, shadowSize);
      gl.enable(gl.DEPTH_TEST);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(depthProgram);
      gl.uniformMatrix4fv(depthUniforms.uLightVP, false, lightVP);
      gl.bindVertexArray(vao);
      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.03, 0.035, 0.045, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(mainProgram);
    const proj = perspective((52 * Math.PI) / 180, width / height, 0.1, 100);
    const view = lookAt(eye, [0, -0.05, 0], [0, 1, 0]);
    gl.uniformMatrix4fv(mainUniforms.uProj, false, proj);
    gl.uniformMatrix4fv(mainUniforms.uView, false, view);
    gl.uniformMatrix4fv(mainUniforms.uLightVP, false, lightVP);
    gl.uniform3f(mainUniforms.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1i(mainUniforms.uShadows, state.shadows ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, shadowTexture);
    gl.uniform1i(mainUniforms.uShadow, 0);
    gl.bindVertexArray(vao);
    gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_INT, 0);

    surface.hudSet('tris', `${fmtNum(mesh.triangles / 1000, 0)} k`);
    surface.hudSet('schatten', state.shadows ? 'an' : 'aus');
    void fmtInt;
  });

  return {
    destroy() {
      surface.canvas.removeEventListener('pointerdown', onPointerDown);
      surface.canvas.removeEventListener('pointermove', onPointerMove);
      surface.canvas.removeEventListener('pointerup', onPointerUp);
      surface.canvas.removeEventListener('wheel', onWheel);
      disposeMesh();
      gl.deleteTexture(shadowTexture);
      gl.deleteFramebuffer(shadowFramebuffer);
      gl.deleteProgram(depthProgram);
      gl.deleteProgram(mainProgram);
      surface.destroy();
    },
  };
}
