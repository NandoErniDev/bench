/** Shared WebGL helpers for the interactive experiments. */

import { el, svg } from '../core/util';

const ICON_EXPAND = 'M4 9V4h5M20 15v5h-5M4 15v5h5M20 9V4h-5';
const ICON_COLLAPSE = 'M9 4v5H4M15 20v-5h5M9 20v-5H4M15 4v5h5';

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
  private fullscreenButton: HTMLButtonElement;
  private pseudoFullscreen = false;
  private onFullscreenChange = () => this.syncFullscreenUi();
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.pseudoFullscreen) this.exitPseudoFullscreen();
  };

  constructor(host: HTMLElement, options: { alpha?: boolean; depth?: boolean } = {}) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.hud = el('div', { class: 'lab-hud' });
    this.fullscreenButton = el('button', {
      class: 'lab-fullscreen',
      type: 'button',
      title: 'Vollbild',
      'aria-label': 'Rendering im Vollbild anzeigen',
      on: { click: () => this.toggleFullscreen() },
    });
    this.fullscreenButton.appendChild(svg(ICON_EXPAND));
    host.append(this.canvas, this.hud, this.fullscreenButton);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', this.onFullscreenChange);

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

  // ------------------------------------------------------------ fullscreen
  private fullscreenActive(): boolean {
    return this.pseudoFullscreen || document.fullscreenElement === this.host;
  }

  private toggleFullscreen(): void {
    if (this.fullscreenActive()) {
      this.leaveFullscreen();
      return;
    }
    const target = this.host as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    if (typeof target.requestFullscreen === 'function') {
      target.requestFullscreen().catch(() => this.enterPseudoFullscreen());
      return;
    }
    if (typeof target.webkitRequestFullscreen === 'function') {
      target.webkitRequestFullscreen();
      return;
    }
    // iPhone Safari only allows video elements in fullscreen, so the lab is
    // pinned over the page instead.
    this.enterPseudoFullscreen();
  }

  private leaveFullscreen(): void {
    if (this.pseudoFullscreen) {
      this.exitPseudoFullscreen();
      return;
    }
    const doc = document as Document & { webkitExitFullscreen?: () => void };
    if (doc.fullscreenElement) doc.exitFullscreen().catch(() => undefined);
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
  }

  private enterPseudoFullscreen(): void {
    this.pseudoFullscreen = true;
    this.host.classList.add('pseudo-fullscreen');
    document.body.classList.add('lab-fullscreen-active');
    window.addEventListener('keydown', this.onKeyDown);
    this.syncFullscreenUi();
  }

  private exitPseudoFullscreen(): void {
    this.pseudoFullscreen = false;
    this.host.classList.remove('pseudo-fullscreen');
    document.body.classList.remove('lab-fullscreen-active');
    window.removeEventListener('keydown', this.onKeyDown);
    this.syncFullscreenUi();
  }

  private syncFullscreenUi(): void {
    const active = this.fullscreenActive();
    this.fullscreenButton.replaceChildren(svg(active ? ICON_COLLAPSE : ICON_EXPAND));
    this.fullscreenButton.title = active ? 'Vollbild verlassen (Esc)' : 'Vollbild';
    this.fullscreenButton.setAttribute(
      'aria-label',
      active ? 'Vollbild verlassen' : 'Rendering im Vollbild anzeigen',
    );
    this.host.classList.toggle('is-fullscreen', active);
    this.resize();
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
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', this.onFullscreenChange);
    if (this.pseudoFullscreen) this.exitPseudoFullscreen();
    if (document.fullscreenElement === this.host) document.exitFullscreen().catch(() => undefined);
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
    this.fullscreenButton.remove();
    this.canvas.remove();
    this.hud.remove();
  }
}
