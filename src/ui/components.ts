/** Reusable UI building blocks. */

import { el, type Child, svg, ICONS } from '../core/util';

export type TagKind = 'measured' | 'derived' | 'na' | 'neutral';

export const TAG_TEXT: Record<TagKind, string> = {
  measured: 'gemessen',
  derived: 'berechnet',
  na: 'nicht verfügbar',
  neutral: 'Angabe',
};

export function tag(kind: TagKind, text?: string): HTMLElement {
  return el('span', { class: `tag ${kind}` }, text ?? TAG_TEXT[kind]);
}

export function card(children: Child[], options: { class?: string } = {}): HTMLElement {
  return el('section', { class: `card${options.class ? ` ${options.class}` : ''}` }, ...children);
}

export function cardHead(title: string, right?: Child, subtitle?: string): HTMLElement {
  return el(
    'div',
    { class: 'card-head' },
    el('div', null, el('h3', null, title), subtitle ? el('div', { class: 'card-sub' }, subtitle) : null),
    right ?? null,
  );
}

export function statBlock(options: {
  label: string;
  value: string;
  unit?: string;
  foot?: string;
  size?: 'md' | 'lg' | 'xl';
}): HTMLElement {
  return el(
    'div',
    { class: 'stat' },
    el('div', { class: 'stat-label' }, options.label),
    el(
      'div',
      { class: `stat-value${options.size && options.size !== 'md' ? ` ${options.size}` : ''}` },
      options.value,
      options.unit ? el('span', { class: 'stat-unit' }, ` ${options.unit}`) : null,
    ),
    options.foot ? el('div', { class: 'footnote' }, options.foot) : null,
  );
}

export function meterRow(options: {
  name: string;
  value: number;
  max: number;
  display: string;
  tone?: 'accent' | 'pos' | 'muted';
}): HTMLElement {
  const percent = options.max > 0 ? Math.max(0.8, Math.min(100, (options.value / options.max) * 100)) : 0;
  const fillClass = options.tone === 'pos' ? 'meter-fill pos' : options.tone === 'muted' ? 'meter-fill muted' : 'meter-fill';
  return el(
    'div',
    { class: 'meter-row' },
    el('span', { class: 'meter-name', title: options.name }, options.name),
    el('div', { class: 'meter' }, el('div', { class: fillClass, style: `width:${percent}%` })),
    el('span', { class: 'meter-value' }, options.display),
  );
}

export function kv(rows: Array<{ label: string; value: Child; tag?: TagKind; tagText?: string }>): HTMLElement {
  const dl = el('dl', { class: 'kv' });
  for (const row of rows) {
    dl.appendChild(
      el(
        'div',
        null,
        el('dt', null, row.label),
        el(
          'dd',
          null,
          row.value,
          row.tag ? el('span', { style: 'margin-left:8px' }, tag(row.tag, row.tagText)) : null,
        ),
      ),
    );
  }
  return dl;
}

export function sectionHead(title: string, description?: string, right?: Child): HTMLElement {
  return el(
    'div',
    { class: 'section-head' },
    el('div', null, el('h2', null, title), description ? el('p', null, description) : null),
    right ?? null,
  );
}

export function note(text: string, tone: 'default' | 'warn' | 'accent' = 'default', icon?: string): HTMLElement {
  const iconNode = svg(icon ?? (tone === 'warn' ? ICONS.warning : ICONS.info));
  const node = el('div', { class: `note${tone === 'warn' ? ' warn' : tone === 'accent' ? ' accent' : ''}` });
  node.appendChild(iconNode);
  node.appendChild(el('div', { html: text }));
  return node;
}

export function badge(mode: 'quick' | 'full'): HTMLElement {
  return el('span', { class: `badge ${mode}` }, mode === 'quick' ? 'Quick' : 'Full');
}

export function segmented<T extends string>(
  options: Array<{ value: T; label: string }>,
  current: T,
  onChange: (value: T) => void,
  small = false,
): HTMLElement {
  const container = el('div', { class: `segmented${small ? ' small' : ''}`, role: 'group' });
  const buttons = new Map<T, HTMLButtonElement>();
  for (const option of options) {
    const button = el(
      'button',
      {
        type: 'button',
        'aria-pressed': option.value === current ? 'true' : 'false',
        on: {
          click: () => {
            for (const [value, btn] of buttons) btn.setAttribute('aria-pressed', value === option.value ? 'true' : 'false');
            onChange(option.value);
          },
        },
      },
      option.label,
    );
    buttons.set(option.value, button);
    container.appendChild(button);
  }
  return container;
}

export function controlsGrid(children: Child[]): HTMLElement {
  return el('div', { class: 'controls' }, ...children);
}

export function rangeControl(options: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  onInput: (value: number) => void;
}): { node: HTMLElement; input: HTMLInputElement; set: (value: number) => void } {
  const format = options.format ?? ((value: number) => String(value));
  const readout = el('span', null, format(options.value));
  const input = el('input', {
    type: 'range',
    min: String(options.min),
    max: String(options.max),
    step: String(options.step),
    value: String(options.value),
  });
  input.addEventListener('input', () => {
    const value = Number(input.value);
    readout.textContent = format(value);
    options.onInput(value);
  });
  const node = el(
    'div',
    { class: 'control' },
    el('label', null, options.label, readout),
    input,
  );
  return {
    node,
    input,
    set(value: number) {
      input.value = String(value);
      readout.textContent = format(value);
    },
  };
}

export function selectControl(options: {
  label: string;
  values: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}): HTMLElement {
  const select = el('select', { 'aria-label': options.label });
  for (const entry of options.values) {
    const option = el('option', { value: entry.value }, entry.label);
    if (entry.value === options.value) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener('change', () => options.onChange(select.value));
  return el('div', { class: 'control' }, el('label', null, options.label), select);
}

export function toggleControl(options: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}): HTMLElement {
  const input = el('input', { type: 'checkbox' });
  input.checked = options.checked;
  input.addEventListener('change', () => options.onChange(input.checked));
  return el('label', { class: 'switch' }, input, options.label);
}
