/** Shared WebGL helpers for the interactive experiments. */

import { el } from '../core/util';

export function compileProgram(
  gl: WebGL2RenderingContext,
  vsSource: string,
  fsSource: string,
  label = 'Programm',
): WebGLProgram {
  const make = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error(`${label}: Shader konnte nicht erstellt werden`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? 'unbekannter Fehler';
      gl.deleteShader(shader);
      throw new Error(`${label}: ${log}`);
    }
    return shader;
  };
  const vs = make(gl.VERTEX_SHADER, vsSource);
  const fs = make(gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  if (!program) throw new Error(`${label}: Programm konnte nicht erstellt werden`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unbekannter Fehler';
    gl.deleteProgram(program);
    throw new Error(`${label}: ${log}`);
  }
  return program;
}

export function uniformMap(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]) {
  const map: Record<string, WebGLUniformLocation | null> = {};
  for (const name of names) map[name] = gl.getUniformLocation(program, name);
  return map;
}

export const FS_TRIANGLE = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export interface LabMetrics {
  fps: number;
  frameMs: number;
  width: number;
  height: number;
}

/**
 * Canvas + render loop + HUD for a lab. One surface per experiment; the loop is
 * stopped and the GL context released on destroy.
 */
export class LabSurface {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly vao: WebGLVertexArrayObject | null;
  readonly hud: HTMLElement;
  private host: HTMLElement;
  private raf = 0;
  private scale = 1;
  private renderFn: ((time: number, metrics: LabMetrics) => void) | null = null;
  private lastTime = 0;
  private emaMs = 16.7;
  private resizeObserver: ResizeObserver;
  private hudCells = new Map<string, HTMLElement>();

  constructor(host: HTMLElement, options: { alpha?: boolean; depth?: boolean } = {}) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.hud = el('div', { class: 'lab-hud' });
    host.append(this.canvas, this.hud);

    const gl = this.canvas.getContext('webgl2', {
      alpha: options.alpha ?? false,
      antialias: false,
      depth: options.depth ?? false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) {
      this.canvas.remove();
      this.hud.remove();
      throw new Error('WebGL2 ist in diesem Browser nicht verfügbar.');
    }
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
  }

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  hudSet(key: string, value: string): void {
    let label = this.hudCells.get(key);
    if (!label) {
      const cell = el('div');
      cell.appendChild(el('span', { class: 'hud-key' }, key));
      label = el('b', null, value);
      cell.appendChild(label);
      this.hud.appendChild(cell);
      this.hudCells.set(key, label);
    }
    label.textContent = value;
  }

  setScale(scale: number): void {
    this.scale = scale;
    this.resize();
  }

  resize(): void {
    const rect = this.host.getBoundingClientRect();
    // Native pixel density (Retina/OLED phones included). The pixel budget is
    // only a guard so the context cannot be lost; it is far above any laptop.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let width = Math.max(2, rect.width * dpr * this.scale);
    let height = Math.max(2, rect.height * dpr * this.scale);
    const budget = 16_000_000;
    if (width * height > budget) {
      const shrink = Math.sqrt(budget / (width * height));
      width *= shrink;
      height *= shrink;
    }
    const finalWidth = Math.max(2, Math.round(width));
    const finalHeight = Math.max(2, Math.round(height));
    if (this.canvas.width !== finalWidth || this.canvas.height !== finalHeight) {
      this.canvas.width = finalWidth;
      this.canvas.height = finalHeight;
      this.gl.viewport(0, 0, finalWidth, finalHeight);
    }
  }

  start(render: (time: number, metrics: LabMetrics) => void): void {
    this.renderFn = render;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (!this.renderFn) return;
      const dt = Math.max(0.1, now - this.lastTime);
      this.lastTime = now;
      this.emaMs = this.emaMs * 0.9 + dt * 0.1;
      const metrics: LabMetrics = {
        fps: 1000 / this.emaMs,
        frameMs: this.emaMs,
        width: this.canvas.width,
        height: this.canvas.height,
      };
      this.hudSet('fps', metrics.fps.toFixed(1));
      this.hudSet('frame', `${metrics.frameMs.toFixed(2)} ms`);
      this.hudSet('res', `${metrics.width}×${metrics.height}`);
      try {
        this.renderFn(now / 1000, metrics);
      } catch (error) {
        console.error(error);
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderFn = null;
  }

  destroy(): void {
    this.stop();
    this.resizeObserver.disconnect();
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
    this.canvas.remove();
    this.hud.remove();
  }
}
