/** Small DOM + formatting helpers shared by every view. */

export type Child = Node | string | number | null | undefined | false;

type Props = Record<string, unknown> & {
  class?: string;
  html?: string;
  on?: Record<string, (event: Event) => void>;
  dataset?: Record<string, string>;
  style?: string;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null) continue;
      if (key === 'class') node.className = String(value);
      else if (key === 'html') node.innerHTML = String(value);
      else if (key === 'dataset') Object.assign(node.dataset, value as Record<string, string>);
      else if (key === 'on') {
        for (const [evt, fn] of Object.entries(value as Record<string, (e: Event) => void>)) {
          node.addEventListener(evt, fn);
        }
      } else if (key === 'style') node.setAttribute('style', String(value));
      else if (key.includes('-') || key === 'role' || key === 'tabindex') {
        node.setAttribute(key, String(value));
      } else {
        (node as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function svg(pathData: string, viewBox = '0 0 24 24'): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', pathData);
  s.appendChild(p);
  return s;
}

export const ICONS = {
  cpu: 'M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2M6 6h12v12H6zM10 10h4v4h-4z',
  gpu: 'M3 6h18v10H3zM7 16v3M17 16v3M7 10h4v3H7zM14 10h3M14 13h3',
  gauge: 'M12 14l4-4M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  arrow: 'M9 6l6 6-6 6',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6',
  check: 'M4 12l5 5L20 6',
  info: 'M12 16v-5M12 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  warning: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a1.7 1.7 0 0 0 1.5 2.5h16.2A1.7 1.7 0 0 0 21.6 18L13.7 3.9a1.7 1.7 0 0 0-3.4 0z',
  x: 'M6 6l12 12M18 6L6 18',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4 4.2 19.8M19.8 4.2l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  contrast: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3v18',
  download: 'M12 3v12M7 11l5 5 5-5M4 20h16',
  play: 'M7 4l12 8-12 8z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  shield: 'M12 3l8 3v6c0 5-3.4 8.2-8 9-4.6-.8-8-4-8-9V6z',
  layers: 'M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  waves: 'M2 8c3 0 3 4 6 4s3-4 6-4 3 4 6 4M2 16c3 0 3 4 6 4s3-4 6-4 3 4 6 4',
  sphere: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3.2 3.6 3.2 14.4 0 18M12 3c-3.2 3.6-3.2 14.4 0 18',
  orbit: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 12c0-2.2 3.6-4 8-4s8 1.8 8 4-3.6 4-8 4-8-1.8-8-4zM6.3 6.3c1.6-1.6 5.4 0.9 8.4 3.9s5.5 6.8 3.9 8.4-5.4-.9-8.4-3.9-5.5-6.8-3.9-8.4z',
};

export const nf = new Intl.NumberFormat('de-DE');
export const nf1 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
export const nf2 = new Intl.NumberFormat('de-DE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtInt(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  return nf.format(Math.round(value));
}

export function fmtNum(value: number | null | undefined, digits = 1, fallback = '—'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
  if (digits === 2) return nf2.format(value);
  if (digits === 1) return nf1.format(value);
  return nf.format(Number(value.toFixed(digits)));
}

/** 1.24 M / 3.8 G with a fixed German decimal comma. */
export function fmtSI(value: number | null | undefined, digits = 2, suffix = ''): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [scale, prefix] of units) {
    if (abs >= scale) return `${fmtNum(value / scale, digits)} ${prefix}${suffix}`;
  }
  return `${fmtNum(value, digits)} ${suffix}`.trim();
}

export function fmtMs(ms: number | null | undefined, digits = 2): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1) return `${fmtNum(ms * 1000, 0)} µs`;
  if (ms < 1000) return `${fmtNum(ms, digits)} ms`;
  return `${fmtNum(ms / 1000, 2)} s`;
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${fmtNum(value, digits)} %`;
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  const total = Math.round(ms);
  if (total < 1000) return `${total} ms`;
  const s = total / 1000;
  if (s < 60) return `${fmtNum(s, 1)} s`;
  const m = Math.floor(s / 60);
  const rest = Math.round(s % 60);
  return `${m}:${String(rest).padStart(2, '0')} min`;
}

export function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function uid(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function abortError(): DOMException {
  return new DOMException('Benchmark abgebrochen', 'AbortError');
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Yields one macrotask so the UI can paint between measurement batches. */
export function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (document.visibilityState === 'visible') requestAnimationFrame(() => resolve());
    else window.setTimeout(resolve, 0);
  });
}

/**
 * Waits until the tab is in the foreground again. Background tabs are throttled
 * by every browser, so measuring there would produce incomparable numbers.
 */
export function waitForVisible(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.visibilityState === 'visible') {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      cleanup();
      resolve();
    };
    function onAbort() {
      cleanup();
      reject(abortError());
    }
    function cleanup() {
      document.removeEventListener('visibilitychange', onVisible);
      signal?.removeEventListener('abort', onAbort);
    }
    document.addEventListener('visibilitychange', onVisible);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function nextTick(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function toast(message: string): void {
  let host = document.querySelector<HTMLElement>('.toast-host');
  if (!host) {
    host = el('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const node = el('div', { class: 'toast' }, message);
  host.appendChild(node);
  window.setTimeout(() => {
    node.style.transition = 'opacity .3s';
    node.style.opacity = '0';
    window.setTimeout(() => node.remove(), 320);
  }, 2600);
}

export function modal(content: Node, label: string): () => void {
  const close = el('button', {
    class: 'icon-btn',
    type: 'button',
    'aria-label': 'Schließen',
    on: { click: () => dismiss() },
  });
  close.appendChild(svg(ICONS.x));
  const card = el('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': label });
  card.appendChild(el('div', { class: 'modal-head' }, el('h3', null, label), close));
  card.appendChild(content);
  const overlay = el('div', { class: 'modal' }, card);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) dismiss();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') dismiss();
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  (close as HTMLElement).focus();

  function dismiss() {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  return dismiss;
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}
