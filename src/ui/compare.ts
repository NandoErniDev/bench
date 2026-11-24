import { el, fmtInt, fmtNum, fmtDate, fmtDuration, type Child } from '../core/util';
import { isComparable, modeLabel, type RunResult } from '../core/suite';
import { loadRuns } from '../core/storage';
import { badge, card, cardHead, note, tag } from './components';
import { barChart } from './charts';
import { navigate } from './router';
import type { View } from './types';

function optionLabel(run: RunResult): string {
  return `${run.device.model || run.device.label} · ${run.mode === 'quick' ? 'Quick' : 'Full'} · ${fmtDate(run.createdAt)}`;
}

function metricRow(
  label: string,
  a: number | null,
  b: number | null,
  footnote: string | undefined,
  showDelta: boolean,
): Child[] {
  const cells: Child[] = [
    el('div', null, el('div', null, label), footnote ? el('div', { class: 'muted' }, footnote) : null),
    a === null ? '—' : fmtInt(a),
    b === null ? '—' : fmtInt(b),
  ];
  if (!showDelta) return cells;
  const delta = a !== null && b !== null && a !== 0 ? ((b - a) / a) * 100 : null;
  cells.push(
    delta === null
      ? '—'
      : el(
          'span',
          { style: `color:${delta > 1 ? 'var(--pos)' : delta < -1 ? 'var(--neg)' : 'var(--text-2)'}` },
          `${delta > 0 ? '+' : ''}${fmtNum(delta, 1)} %`,
        ),
  );
  return cells;
}

export function compareView(): View {
  const runs = loadRuns();

  const header = el(
    'div',
    null,
    el('div', { class: 'eyebrow' }, el('span', { class: 'eyebrow-dot' }), 'Lokal gespeicherte Läufe'),
    el('h1', { style: 'font-size:clamp(1.7rem,3.4vw,2.2rem);margin-top:10px' }, 'Ergebnisse vergleichen'),
    el(
      'p',
      { class: 'lede', style: 'margin-top:8px' },
      'Mehrere Geräte lassen sich direkt nacheinander testen: Jeder Lauf wird lokal gespeichert und kann hier gegen einen anderen Lauf gestellt werden. Es gibt keine zentrale Rangliste und keine Übertragung.',
    ),
  );

  if (runs.length < 2) {
    return {
      node: el(
        'div',
        null,
        header,
        el(
          'div',
          { class: 'section' },
          card([
            cardHead('Noch zu wenig Vergleichsdaten'),
            el(
              'p',
              { class: 'small muted' },
              runs.length === 0
                ? 'Es ist noch kein Ergebnis gespeichert. Starte einen Quick oder Full Test — danach erscheint der Lauf hier.'
                : 'Es ist erst ein Ergebnis gespeichert. Führe den Test auf einem weiteren Gerät oder in einem anderen Modus aus, um zu vergleichen.',
            ),
            el(
              'div',
              { class: 'row', style: 'margin-top:16px;gap:8px' },
              el('a', { class: 'btn primary', href: '#/run?mode=quick' }, 'Quick Test starten'),
              el('a', { class: 'btn secondary', href: '#/run?mode=full' }, 'Full Test starten'),
              runs.length === 1
                ? el('a', { class: 'btn ghost', href: `#/result/${runs[0].id}` }, 'Vorhandenes Ergebnis')
                : null,
            ),
          ]),
        ),
      ),
    };
  }

  let leftId = runs[0].id;
  let rightId = runs[1].id;

  const comparison = el('div', { class: 'section' });

  const leftSelect = el('select', { 'aria-label': 'Erster Lauf' });
  const rightSelect = el('select', { 'aria-label': 'Zweiter Lauf' });
  for (const run of runs) {
    leftSelect.appendChild(el('option', { value: run.id }, optionLabel(run)));
    rightSelect.appendChild(el('option', { value: run.id }, optionLabel(run)));
  }
  leftSelect.value = leftId;
  rightSelect.value = rightId;

  const render = () => {
    const a = runs.find((run) => run.id === leftId);
    const b = runs.find((run) => run.id === rightId);
    comparison.replaceChildren();
    if (!a || !b) return;

    const check = isComparable(a, b);
    const sameRun = a.id === b.id;

    const summary = el(
      'div',
      { class: 'grid grid-2', style: 'margin-bottom:14px' },
      card([
        el('div', { class: 'row', style: 'gap:8px' }, el('strong', null, a.device.model || a.device.label), badge(a.mode)),
        el('p', { class: 'small muted', style: 'margin-top:6px' }, `${a.device.platform ?? '—'} · ${a.device.browser} · ${fmtDuration(a.durationMs)}`),
        el('p', { class: 'footnote' }, fmtDate(a.createdAt)),
      ]),
      card([
        el('div', { class: 'row', style: 'gap:8px' }, el('strong', null, b.device.model || b.device.label), badge(b.mode)),
        el('p', { class: 'small muted', style: 'margin-top:6px' }, `${b.device.platform ?? '—'} · ${b.device.browser} · ${fmtDuration(b.durationMs)}`),
        el('p', { class: 'footnote' }, fmtDate(b.createdAt)),
      ]),
    );

    const buildTable = (showDelta: boolean): HTMLElement => {
      const headers = showDelta ? ['Messwert', 'A', 'B', 'Δ B zu A'] : ['Messwert', 'A', 'B'];
      const table = el('table', { class: 'data' });
      table.appendChild(
        el(
          'thead',
          null,
          el('tr', null, ...headers.map((header, index) => el('th', { class: index > 0 ? 'num' : undefined }, header))),
        ),
      );
      const tbody = el('tbody');
      const rows = [
        metricRow('CPU-Score', a.cpu.score, b.cpu.score, undefined, showDelta),
        metricRow('Single-Core', a.cpu.singleScore, b.cpu.singleScore, undefined, showDelta),
        metricRow('Multi-Core', a.cpu.multiScore, b.cpu.multiScore, `${a.cpu.workersUsed} / ${b.cpu.workersUsed} Worker`, showDelta),
        metricRow('GPU-Score', a.gpu?.score ?? null, b.gpu?.score ?? null, undefined, showDelta),
        metricRow('Overall', a.overall, b.overall, undefined, showDelta),
        metricRow('Stabilität (%)', a.efficiency.stability, b.efficiency.stability, undefined, showDelta),
        metricRow('Parallelskalierung (%)', a.efficiency.parallelScaling, b.efficiency.parallelScaling, undefined, showDelta),
      ];
      for (const row of rows) {
        tbody.appendChild(el('tr', null, ...row.map((cell, index) => el('td', { class: index > 0 ? 'num' : undefined }, cell))));
      }
      table.appendChild(tbody);
      return table;
    };
    const showDelta = check.ok && !sameRun;
    const table = buildTable(showDelta);

    const chart = el(
      'div',
      { style: 'margin-top:16px' },
      barChart({
        items: [
          { label: 'CPU A', value: a.cpu.score, display: fmtInt(a.cpu.score), muted: true },
          { label: 'CPU B', value: b.cpu.score, display: fmtInt(b.cpu.score) },
          { label: 'GPU A', value: a.gpu?.score ?? 0, display: a.gpu ? fmtInt(a.gpu.score) : '—', muted: true },
          { label: 'GPU B', value: b.gpu?.score ?? 0, display: b.gpu ? fmtInt(b.gpu.score) : '—' },
          { label: 'Overall A', value: a.overall ?? 0, display: a.overall ? fmtInt(a.overall) : '—', muted: true },
          { label: 'Overall B', value: b.overall ?? 0, display: b.overall ? fmtInt(b.overall) : '—' },
        ],
        max: Math.max(a.overall ?? 0, b.overall ?? 0, a.cpu.score, b.cpu.score, a.gpu?.score ?? 0, b.gpu?.score ?? 0),
      }),
    );

    comparison.append(summary);

    if (!check.ok || sameRun) {
      comparison.appendChild(
        el(
          'div',
          { style: 'margin-bottom:14px' },
          note(
            sameRun
              ? 'Beide Felder zeigen denselben Lauf. Wähle zwei unterschiedliche Ergebnisse.'
              : (check.reason ?? 'Diese Läufe sind nicht vergleichbar.'),
            'warn',
          ),
        ),
      );
      comparison.appendChild(
        card([
          cardHead('Einzelwerte', el('span', { class: 'row', style: 'gap:6px' }, tag('na', 'kein direkter Vergleich'))),
          table,
        ]),
      );
      return;
    }

    comparison.appendChild(card([cardHead('Direkter Vergleich', tag('neutral', `${modeLabel(a.mode)} · Suite ${a.suiteVersion}`)), table, chart]));
    comparison.appendChild(
      el(
        'div',
        { style: 'margin-top:14px' },
        note(
          'Δ beschreibt B relativ zu A. Werte über mehrere Durchläufe schwanken gerätebedingt; kleine Unterschiede sind kein Qualitätsurteil.',
          'default',
        ),
      ),
    );
  };

  leftSelect.addEventListener('change', () => {
    leftId = leftSelect.value;
    render();
  });
  rightSelect.addEventListener('change', () => {
    rightId = rightSelect.value;
    render();
  });

  render();

  const controls = card([
    cardHead(
      'Läufe auswählen',
      el(
        'button',
        { class: 'btn ghost small', type: 'button', on: { click: () => navigate('/run?mode=full') } },
        'Full Test starten',
      ),
    ),
    el('div', { class: 'grid grid-2' }, el('div', { class: 'control' }, el('label', null, 'Lauf A'), leftSelect), el('div', { class: 'control' }, el('label', null, 'Lauf B'), rightSelect)),
    el(
      'p',
      { class: 'footnote', style: 'margin-top:10px' },
      'Vergleiche nur denselben Modus und dieselbe Suite-Version. Quick- und Full-Ergebnisse werden nicht gegeneinander gerechnet.',
    ),
  ]);

  return {
    node: el('div', null, header, el('div', { class: 'section' }, controls), comparison),
  };
}
