/** Minimal SVG charts. Crisp at any DPR, no chart library, theme-aware. */

import { el, fmtNum } from '../core/util';

const NS = 'http://www.w3.org/2000/svg';

function node<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  return element;
}

export interface LineChartOptions {
  values: number[];
  format?: (value: number) => string;
  captionLeft?: string;
  captionRight?: string;
  tone?: 'accent' | 'pos';
  baseline?: number | null;
  baselineLabel?: string;
  emptyLabel?: string;
}

/** Downsamples long series while keeping first and last points. */
function reduce(values: number[], limit: number): number[] {
  if (values.length <= limit) return values;
  const step = (values.length - 1) / (limit - 1);
  const out: number[] = [];
  for (let i = 0; i < limit; i++) out.push(values[Math.round(i * step)]);
  return out;
}

function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  const normalized = value / base;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * base;
}

export function lineChart(options: LineChartOptions): HTMLElement {
  const format = options.format ?? ((value: number) => fmtNum(value, 1));
  const wrapper = el('div');
  const values = options.values.filter((v) => Number.isFinite(v));

  if (!values.length) {
    wrapper.appendChild(
      el('div', { class: 'footnote', style: 'padding:18px 0;text-align:center' }, options.emptyLabel ?? 'Keine Messreihe verfügbar'),
    );
    return wrapper;
  }

  const W = 600;
  const H = 176;
  const pad = { left: 46, right: 8, top: 12, bottom: 30 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const series = reduce(values, 220);
  const dataMax = Math.max(...series, options.baseline ?? 0);
  const dataMin = Math.min(...series, options.baseline ?? Number.POSITIVE_INFINITY);
  const top = niceMax(dataMax <= 0 ? 1 : dataMax * 1.08);
  const bottom = dataMin > 0 && dataMin > top * 0.45 ? Math.max(0, Math.floor(dataMin * 0.9)) : 0;
  const span = Math.max(0.000001, top - bottom);

  const xAt = (index: number) => pad.left + (series.length <= 1 ? plotW / 2 : (index / (series.length - 1)) * plotW);
  const yAt = (value: number) => pad.top + plotH - ((value - bottom) / span) * plotH;

  const svg = node('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    'aria-label': options.captionLeft ?? 'Messreihe',
    preserveAspectRatio: 'xMidYMid meet',
  });

  for (let i = 0; i <= 2; i++) {
    const value = bottom + (span * i) / 2;
    const y = yAt(value);
    svg.appendChild(node('line', { class: 'axis-line', x1: pad.left, x2: W - pad.right, y1: y, y2: y }));
    const label = node('text', { x: pad.left - 8, y: y + 3.5, 'text-anchor': 'end' });
    label.textContent = format(value);
    svg.appendChild(label);
  }

  if (options.baseline !== null && options.baseline !== undefined) {
    const y = yAt(options.baseline);
    svg.appendChild(
      node('line', {
        x1: pad.left,
        x2: W - pad.right,
        y1: y,
        y2: y,
        stroke: 'currentColor',
        'stroke-width': 1,
        'stroke-dasharray': '3 4',
        opacity: '0.35',
      }),
    );
    if (options.baselineLabel) {
      const label = node('text', { x: W - pad.right, y: y - 6, 'text-anchor': 'end' });
      label.textContent = options.baselineLabel;
      svg.appendChild(label);
    }
  }

  const line = series.map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(2)},${yAt(value).toFixed(2)}`).join(' ');
  const area = `${line} L${xAt(series.length - 1).toFixed(2)},${(pad.top + plotH).toFixed(2)} L${xAt(0).toFixed(2)},${(pad.top + plotH).toFixed(2)} Z`;
  svg.appendChild(node('path', { class: 'area', d: area }));
  svg.appendChild(node('path', { class: `series${options.tone === 'pos' ? ' pos' : ''}`, d: line }));
  svg.appendChild(
    node('circle', {
      class: 'dot',
      cx: xAt(series.length - 1),
      cy: yAt(series[series.length - 1]),
      r: 2.6,
    }),
  );

  wrapper.appendChild(svg);
  if (options.captionLeft || options.captionRight) {
    wrapper.appendChild(
      el(
        'div',
        { class: 'chart-caption' },
        el('span', null, options.captionLeft ?? ''),
        el('span', null, options.captionRight ?? ''),
      ),
    );
  }
  return wrapper;
}

export interface BarChartOptions {
  items: Array<{ label: string; value: number; display?: string; muted?: boolean }>;
  max?: number;
}

/** Horizontal comparison bars, used for resolution scaling and score splits. */
export function barChart(options: BarChartOptions): HTMLElement {
  const wrapper = el('div', { class: 'stack', style: 'gap:8px' });
  const max = options.max ?? Math.max(...options.items.map((item) => item.value), 1);
  for (const item of options.items) {
    const width = Math.max(1.5, Math.min(100, (item.value / max) * 100));
    wrapper.appendChild(
      el(
        'div',
        { class: 'meter-row', style: 'grid-template-columns:92px 1fr auto' },
        el('span', { class: 'meter-name' }, item.label),
        el('div', { class: 'meter' }, el('div', { class: `meter-fill${item.muted ? ' muted' : ''}`, style: `width:${width}%` })),
        el('span', { class: 'meter-value' }, item.display ?? fmtNum(item.value, 1)),
      ),
    );
  }
  return wrapper;
}
