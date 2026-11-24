import {
  el,
  svg,
  ICONS,
  fmtInt,
  fmtNum,
  fmtMs,
  fmtPct,
  fmtDuration,
  fmtDate,
  modal,
  toast,
  type Child,
} from '../core/util';
import {
  CPU_COMPOSITE,
  CPU_WEIGHTS,
  GPU_WEIGHTS,
  OVERALL_FORMULA,
  SUITE,
  modeLabel,
  type RunResult,
} from '../core/suite';
import { browserLabel, osLabel } from '../core/device';
import { deleteRun, getRun } from '../core/storage';
import { badge, card, cardHead, kv, meterRow, note, statBlock, tag } from './components';
import { barChart, lineChart } from './charts';
import { navigate } from './router';
import { downloadCard, renderShareCard, shareRun, summaryText } from '../share/card';
import type { View } from './types';

function dataTable(headers: Array<{ label: string; num?: boolean }>, rows: Child[][]): HTMLElement {
  const table = el('table', { class: 'data' });
  const thead = el('thead');
  thead.appendChild(
    el(
      'tr',
      null,
      ...headers.map((header) => el('th', { class: header.num ? 'num' : undefined }, header.label)),
    ),
  );
  const tbody = el('tbody');
  for (const row of rows) {
    tbody.appendChild(
      el(
        'tr',
        null,
        ...row.map((cell, index) =>
          el('td', { class: headers[index]?.num ? 'num' : undefined }, cell),
        ),
      ),
    );
  }
  table.append(thead, tbody);
  return el('div', { class: 'table-wrap' }, table);
}

function throughput(value: number, unit: string): string {
  return `${fmtNum(value / 1e6, 1)} ${unit}`;
}

function openShareModal(run: RunResult): void {
  const canvas = renderShareCard(run);
  const preview = el('div', { style: 'background:var(--surface-2);padding:10px;border-radius:var(--radius)' }, canvas);

  let canFiles = false;
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
    canFiles = Boolean(navigator.canShare?.({ files: [probe] }));
  } catch {
    canFiles = false;
  }

  const shareButton = el(
    'button',
    {
      class: 'btn primary',
      type: 'button',
      on: {
        click: async () => {
          const outcome = await shareRun(run);
          toast(outcome.message);
        },
      },
    },
    svg(ICONS.share),
    'Teilen …',
  );

  const downloadButton = el(
    'button',
    {
      class: 'btn secondary',
      type: 'button',
      on: {
        click: async () => {
          await downloadCard(run);
          toast('Grafik als PNG gespeichert.');
        },
      },
    },
    svg(ICONS.download),
    'PNG speichern',
  );

  const copyButton = el(
    'button',
    {
      class: 'btn ghost',
      type: 'button',
      on: {
        click: async () => {
          try {
            await navigator.clipboard.writeText(summaryText(run));
            toast('Zusammenfassung kopiert.');
          } catch {
            toast('Zwischenablage nicht verfügbar.');
          }
        },
      },
    },
    'Text kopieren',
  );

  const content = el(
    'div',
    null,
    preview,
    el(
      'div',
      { class: 'modal-actions' },
      shareButton,
      downloadButton,
      copyButton,
    ),
    el(
      'p',
      { class: 'footnote', style: 'margin-top:10px' },
      canFiles
        ? 'Die Grafik wird direkt an das Teilen-Menü übergeben — WhatsApp, AirDrop, Messages und andere installierte Apps erscheinen dort.'
        : 'Dieser Browser kann keine Dateien über das Teilen-Menü senden. Die Grafik wird stattdessen als PNG gespeichert und die Zusammenfassung kopiert.',
    ),
  );

  modal(content, 'Ergebnis teilen');
}

export function resultView(id: string): View {
  const run = getRun(id);
  if (!run) {
    return {
      node: el(
        'div',
        { class: 'stack', style: 'gap:14px;padding:24px 0' },
        el('h1', { style: 'font-size:1.8rem' }, 'Ergebnis nicht gefunden'),
        el(
          'p',
          { class: 'muted' },
          'Ergebnisse werden ausschließlich lokal in diesem Browser gespeichert. Möglicherweise wurde der Eintrag gelöscht, oder der Link stammt aus einem anderen Browser.',
        ),
        el(
          'div',
          { class: 'row' },
          el('a', { class: 'btn primary', href: '#/run?mode=quick' }, 'Quick Test starten'),
          el('a', { class: 'btn secondary', href: '#/compare' }, 'Gespeicherte Läufe'),
        ),
      ),
    };
  }

  const device = run.device;
  const gpu = run.gpu;
  const cpu = run.cpu;
  const sustained = cpu.sustained;
  const canFileShare = (() => {
    try {
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
      return Boolean(navigator.canShare?.({ files: [probe] }));
    } catch {
      return false;
    }
  })();

  const shareButton = el(
    'button',
    { class: 'btn primary', type: 'button', on: { click: () => openShareModal(run) } },
    svg(ICONS.share),
    'Ergebnis teilen',
  );

  const header = el(
    'div',
    null,
    el('a', { class: 'breadcrumb', href: '#/' }, '← Benchmark'),
    el(
      'div',
      { class: 'row between', style: 'align-items:flex-start' },
      el(
        'div',
        null,
        el('div', { class: 'row', style: 'gap:10px' }, el('h1', { style: 'font-size:clamp(1.7rem,3.4vw,2.2rem)' }, 'Ergebnis'), badge(run.mode)),
        el(
          'p',
          { class: 'small muted', style: 'margin-top:8px' },
          `${device.model || device.label} · ${osLabel(device)} · ${fmtDate(run.createdAt)} · Messdauer ${fmtDuration(run.durationMs)}`,
        ),
      ),
      el(
        'div',
        { class: 'row', style: 'gap:8px' },
        shareButton,
        el('a', { class: 'btn secondary', href: '#/compare' }, 'Vergleichen'),
      ),
    ),
  );

  const scores = el(
    'div',
    { class: 'score-trio', style: 'margin-top:20px' },
    el(
      'div',
      { class: 'score-cell' },
      el('div', { class: 'score-name' }, 'CPU'),
      el('div', { class: 'score-num' }, fmtInt(cpu.score)),
      el('div', { class: 'score-foot' }, `Single ${fmtInt(cpu.singleScore)} · Multi ${fmtInt(cpu.multiScore)}`),
    ),
    el(
      'div',
      { class: 'score-cell' },
      el('div', { class: 'score-name' }, 'GPU'),
      el('div', { class: 'score-num' }, gpu ? fmtInt(gpu.score) : '—'),
      el('div', { class: 'score-foot' }, gpu ? `WebGL2 · ${gpu.resolution.w} × ${gpu.resolution.h}` : 'nicht verfügbar'),
    ),
    el(
      'div',
      { class: 'score-cell primary' },
      el('div', { class: 'score-name' }, 'Overall'),
      el('div', { class: 'score-num' }, run.overall === null ? '—' : fmtInt(run.overall)),
      el('div', { class: 'score-foot' }, OVERALL_FORMULA),
    ),
  );

  // ---------------------------------------------------------------- device
  const deviceCard = card([
    cardHead('Gerät und Umgebung', tag('neutral', 'Browserangaben')),
    kv([
      {
        label: 'Gerät',
        value: device.model || device.label,
        tag: device.model ? 'neutral' : 'derived',
        tagText: device.model ? 'Browserangabe' : 'aus Plattform abgeleitet',
      },
      { label: 'Betriebssystem', value: osLabel(device) },
      { label: 'Browser', value: browserLabel(device) },
      {
        label: 'Logische Kerne',
        value: device.cores ? `${device.cores}` : 'nicht verfügbar',
        tag: device.cores ? 'measured' : 'na',
      },
      {
        label: 'Arbeitsspeicher',
        value: device.memoryGb ? `≥ ${device.memoryGb} GB` : 'nicht verfügbar',
        tag: device.memoryGb ? 'measured' : 'na',
      },
      {
        label: 'GPU (Renderer)',
        value: gpu?.renderer ?? device.gpuRenderer ?? 'nicht verfügbar',
        tag: gpu?.renderer || device.gpuRenderer ? 'measured' : 'na',
      },
      {
        label: 'GPU-Hersteller',
        value: gpu?.vendor ?? device.gpuVendor ?? 'nicht verfügbar',
        tag: gpu?.vendor || device.gpuVendor ? 'measured' : 'na',
      },
      {
        label: 'Architektur',
        value: device.architecture
          ? `${device.architecture}${device.bitness ? ` · ${device.bitness}-Bit` : ''}`
          : 'nicht verfügbar',
        tag: device.architecture ? 'neutral' : 'na',
      },
      { label: 'Display', value: `${device.screenW} × ${device.screenH} · ${fmtNum(device.pixelRatio, 2)} ×` },
      {
        label: 'WebGPU',
        value: device.webgpu === null ? 'nicht verfügbar' : device.webgpu ? 'verfügbar' : 'nicht verfügbar',
        tag: device.webgpu === null ? 'na' : 'measured',
      },
    ]),
  ]);

  const measurementCard = card([
    cardHead('Messung', tag('neutral', `Suite ${run.suiteVersion}`)),
    kv([
      { label: 'Testmodus', value: modeLabel(run.mode) },
      { label: 'CPU-Testsuite', value: run.cpuVersion },
      { label: 'GPU-Testsuite', value: run.gpuVersion },
      { label: 'Messdauer gesamt', value: fmtDuration(run.durationMs) },
      { label: 'CPU-Messung', value: fmtDuration(cpu.durationMs) },
      { label: 'GPU-Messung', value: gpu ? fmtDuration(gpu.durationMs) : 'nicht verfügbar' },
      {
        label: 'GPU-Zeitmessung',
        value: gpu
          ? gpu.timerQuery
            ? 'EXT_disjoint_timer_query_webgl2 — GPU-Zeit gemessen'
            : 'nur Wall-Clock-Frame-Zeit'
          : 'nicht verfügbar',
        tag: gpu ? (gpu.timerQuery ? 'measured' : 'na') : 'na',
      },
      {
        label: 'Getestete Worker',
        value: `${cpu.workersUsed}${cpu.coresAvailable ? ` von ${cpu.coresAvailable} gemeldeten Kernen` : ''}`,
      },
      { label: 'Normalisierung', value: SUITE.normalization },
    ]),
    el('div', { style: 'margin-top:14px' }, note(
      'Quick- und Full-Scores sind nicht direkt vergleichbar: unterschiedliche Laufzeiten, Durchläufe und Dauerlast. Vergleiche nur Ergebnisse desselben Modus und derselben Suite-Version.',
      'default',
    )),
  ]);

  // ------------------------------------------------------------------- CPU
  const cpuRows: Child[][] = cpu.workloads.map((workload) => [
    el('div', null, el('div', { style: 'font-weight:500' }, workload.label), el('div', { class: 'muted' }, workload.detail)),
    throughput(workload.singleValue, workload.unit),
    throughput(workload.multiValue, workload.unit),
    fmtInt(workload.singleScore),
    fmtInt(workload.multiScore),
  ]);

  const cpuStats = el(
    'div',
    { class: 'grid grid-4', style: 'margin-bottom:16px' },
    statBlock({ label: 'Single-Core', value: fmtInt(cpu.singleScore), foot: `Gewicht ${Math.round(CPU_COMPOSITE.single * 100)} %` }),
    statBlock({ label: 'Multi-Core', value: fmtInt(cpu.multiScore), foot: `Gewicht ${Math.round(CPU_COMPOSITE.multi * 100)} %` }),
    statBlock({
      label: sustained ? 'Dauerlast Ø' : 'Dauerlast',
      value: sustained ? fmtInt(sustained.average) : '—',
      foot: sustained ? `Maximum ${fmtInt(sustained.peak)}` : 'nur im Full Test',
    }),
    statBlock({
      label: 'Stabilität',
      value: sustained ? fmtPct(run.efficiency.stability ?? null) : '—',
      foot: sustained ? `Abfall ${fmtPct(sustained.dropPct)}` : 'nicht gemessen',
    }),
  );

  const cpuChart = sustained
    ? el(
        'div',
        { style: 'margin-top:16px' },
        lineChart({
          values: sustained.trials.map((trial) => trial.score),
          format: (value) => fmtInt(value),
          captionLeft: 'Multi-Core-Score je Durchlauf (Dauerlast)',
          captionRight: `Abfall ${fmtPct(sustained.dropPct)} · ${sustained.trials.length} Durchläufe`,
          tone: 'pos',
        }),
      )
    : note(
        'Der Quick Test misst keine Dauerlast. Für Stabilität und Leistungseinbrüche über die Zeit ist der Full Test erforderlich.',
        'default',
      );

  const cpuCard = card([
    cardHead(
      'CPU-Benchmark',
      tag('measured', 'Durchsatz gemessen'),
      'Vier Arbeitslasten, kalibrierte Batches, Messung gegen performance.now() im Worker',
    ),
    cpuStats,
    dataTable(
      [
        { label: 'Arbeitslast' },
        { label: 'Single-Core', num: true },
        { label: 'Multi-Core', num: true },
        { label: 'Score S', num: true },
        { label: 'Score M', num: true },
      ],
      cpuRows,
    ),
    cpuChart,
    el(
      'p',
      { class: 'footnote', style: 'margin-top:12px' },
      `CPU-Score = ${Math.round(CPU_COMPOSITE.single * 100)} % Single + ${Math.round(CPU_COMPOSITE.multi * 100)} % Multi. `
        + `Gewichte der Arbeitslasten: Integer ${Math.round(CPU_WEIGHTS.int * 100)} %, Gleitkomma ${Math.round(CPU_WEIGHTS.float * 100)} %, `
        + `komplexe Mathematik ${Math.round(CPU_WEIGHTS.math * 100)} %, FFT ${Math.round(CPU_WEIGHTS.fft * 100)} %.`,
    ),
  ]);

  // ------------------------------------------------------------------- GPU
  const gpuRows: Child[][] = gpu
    ? gpu.tests.map((test) => [
        el('div', null, el('div', { style: 'font-weight:500' }, test.label), el('div', { class: 'muted' }, test.detail)),
        throughput(test.value, test.unit),
        fmtInt(test.score),
        fmtMs(test.avgFrameMs),
        test.gpuMs === null ? el('span', { class: 'muted' }, 'nicht verfügbar') : fmtMs(test.gpuMs, 3),
      ])
    : [];

  const gpuChart = gpu
    ? el(
        'div',
        { style: 'margin-top:16px' },
        lineChart({
          values: gpu.tests[0]?.samples ?? [],
          format: (value) => `${fmtNum(value, 2)} ms`,
          baseline: gpu.tests[0]?.avgFrameMs,
          baselineLabel: `Ø ${fmtNum(gpu.tests[0]?.avgFrameMs ?? 0, 2)} ms`,
          captionLeft: 'Frame-Zeiten · Shader-Berechnung (Wall Clock)',
          captionRight: gpu.timerQuery ? 'GPU-Timer verfügbar' : 'ohne GPU-Timer',
        }),
      )
    : null;

  const scalingBlock = gpu && gpu.scaling.length
    ? el(
        'div',
        { style: 'margin-top:16px' },
        el('div', { class: 'stat-label', style: 'margin-bottom:6px' }, 'Auflösungsabhängigkeit (Shader-Test)'),
        barChart({
          items: gpu.scaling.map((entry) => ({
            label: `${Math.round(entry.scale * 100)} %`,
            value: entry.value / 1e6,
            display: `${fmtNum(entry.value / 1e6, 1)} Mpx/s`,
            muted: entry.scale < 1,
          })),
        }),
      )
    : null;

  const gpuCard = card([
    cardHead(
      'GPU-Benchmark',
      gpu ? tag('measured', gpu.timerQuery ? 'GPU- & Frame-Zeit' : 'Frame-Zeit') : tag('na'),
      gpu
        ? `WebGL2 · fixe interne Auflösung ${gpu.resolution.w} × ${gpu.resolution.h} · ${gpu.tests.length} Arbeitslasten`
        : 'Der GPU-Test konnte nicht ausgeführt werden.',
    ),
    gpu
      ? el(
          'div',
          null,
          el(
            'div',
            { class: 'grid grid-4', style: 'margin-bottom:16px' },
            statBlock({ label: 'GPU-Score', value: fmtInt(gpu.score) }),
            statBlock({ label: 'Arbeitslasten', value: String(gpu.tests.length) }),
            statBlock({
              label: 'Shader-Durchsatz',
              value: fmtNum((gpu.tests[0]?.value ?? 0) / 1e6, 1),
              unit: gpu.tests[0]?.unit,
            }),
            statBlock({ label: 'Renderer', value: gpu.renderer ? 'erkannt' : '—', foot: gpu.vendor ?? 'Hersteller nicht verfügbar' }),
          ),
          dataTable(
            [
              { label: 'Test' },
              { label: 'Messwert', num: true },
              { label: 'Score', num: true },
              { label: 'Ø Frame', num: true },
              { label: 'GPU-Zeit', num: true },
            ],
            gpuRows,
          ),
          gpuChart,
          scalingBlock,
          el(
            'p',
            { class: 'footnote', style: 'margin-top:12px' },
            `GPU-Score = gewichtetes Mittel: Shader ${Math.round(GPU_WEIGHTS.fragment * 100)} %, `
              + `Geometrie ${Math.round(GPU_WEIGHTS.geometry * 100)} %, Szene ${Math.round(GPU_WEIGHTS.scene * 100)} %, `
              + `Simulation ${Math.round(GPU_WEIGHTS.sim * 100)} %. Jeder Batch wird mit readPixels synchronisiert, `
              + 'gemessen wird also abgeschlossene GPU-Arbeit.',
          ),
        )
      : note(
          'WebGL2 war nicht verfügbar oder der Kontext ging verloren. Overall und GPU-Score bleiben leer — es werden keine Ersatzwerte erzeugt.',
          'warn',
        ),
  ]);

  // ------------------------------------------------------------- efficiency
  const efficiencyCard = card([
    cardHead('Effizienz und Stabilität', run.efficiency.proxy === null ? tag('na', 'kein Proxy') : tag('derived', 'berechnet')),
    el(
      'div',
      { class: 'grid grid-2', style: 'gap:18px 24px' },
      statBlock({
        label: 'Parallelskalierung',
        value: run.efficiency.parallelScaling === null ? '—' : fmtPct(run.efficiency.parallelScaling),
        foot: `${cpu.workersUsed} Worker · 100 % = lineare Skalierung`,
      }),
      statBlock({
        label: 'Effizienz-Proxy',
        value: run.efficiency.proxy === null ? '—' : fmtPct(run.efficiency.proxy),
        foot: 'Stabilität × Skalierung, kein Wattwert',
      }),
      statBlock({
        label: 'Stabilität unter Last',
        value: run.efficiency.stability === null ? '—' : fmtPct(run.efficiency.stability),
        foot: sustained ? `Ø ${fmtInt(sustained.average)} von max. ${fmtInt(sustained.peak)}` : 'nur im Full Test',
      }),
      statBlock({
        label: 'Leistungseinbruch',
        value: run.efficiency.dropPct === null ? '—' : fmtPct(run.efficiency.dropPct),
        foot: sustained ? 'letzter vs. bester Durchlauf' : 'nur im Full Test',
      }),
    ),
    el(
      'div',
      { style: 'margin-top:16px' },
      kv([
        { label: 'Leistungsaufnahme', value: 'nicht verfügbar', tag: 'na' },
        { label: 'Temperatur', value: 'nicht verfügbar', tag: 'na' },
        { label: 'Taktfrequenz', value: 'nicht verfügbar', tag: 'na' },
        { label: 'CPU-/GPU-Auslastung', value: 'nicht verfügbar', tag: 'na' },
      ]),
    ),
    el('div', { style: 'margin-top:14px' }, note(run.efficiency.note, 'warn')),
  ]);

  // ---------------------------------------------------------------- webgpu
  const webgpuCard = run.webgpu
    ? card([
        cardHead('WebGPU (optional)', run.webgpu.supported && run.webgpu.computeValue !== null ? tag('measured', 'gemessen') : tag('na')),
        kv([
          { label: 'Verfügbar', value: run.webgpu.supported ? 'ja' : 'nein' },
          { label: 'Adapter', value: run.webgpu.adapter ?? 'nicht verfügbar' },
          { label: 'Hersteller', value: run.webgpu.vendor ?? 'nicht verfügbar' },
          {
            label: 'Compute-Durchsatz',
            value: run.webgpu.computeValue === null ? 'nicht verfügbar' : `${fmtNum(run.webgpu.computeValue, 1)} ${run.webgpu.unit}`,
            tag: run.webgpu.computeValue === null ? 'na' : 'measured',
          },
          {
            label: 'Messdauer',
            value: run.webgpu.durationMs === null ? 'nicht verfügbar' : fmtDuration(run.webgpu.durationMs),
          },
        ]),
        el('div', { style: 'margin-top:12px' }, note(run.webgpu.note, 'default')),
      ])
    : null;

  const notesCard = run.notes.length
    ? card([
        cardHead('Hinweise zur Messung'),
        el(
          'ul',
          { class: 'stack', style: 'gap:8px;padding-left:18px;margin:0' },
          ...run.notes.map((entry) => el('li', { class: 'small muted', style: 'line-height:1.55' }, entry)),
        ),
      ])
    : null;

  // --------------------------------------------------------------- actions
  const deleteButton = el(
    'button',
    {
      class: 'btn ghost small',
      type: 'button',
      on: {
        click: () => {
          const row = el(
            'div',
            { class: 'row', style: 'gap:8px' },
            el('span', { class: 'small muted' }, 'Ergebnis wirklich löschen?'),
            el(
              'button',
              {
                class: 'btn small',
                type: 'button',
                style: 'background:var(--neg);color:#fff',
                on: {
                  click: () => {
                    deleteRun(run.id);
                    toast('Ergebnis gelöscht.');
                    navigate('/');
                  },
                },
              },
              'Löschen',
            ),
            el(
              'button',
              { class: 'btn ghost small', type: 'button', on: { click: () => row.replaceWith(deleteButton) } },
              'Abbrechen',
            ),
          );
          deleteButton.replaceWith(row);
        },
      },
    },
    svg(ICONS.trash),
    'Ergebnis löschen',
  );

  const actions = el(
    'div',
    { class: 'section' },
    card([
      el(
        'div',
        { class: 'row between' },
        el(
          'div',
          { class: 'stack', style: 'gap:4px' },
          el('h3', null, 'Ergebnis teilen'),
          el(
            'p',
            { class: 'small muted' },
            canFileShare
              ? 'Ergebnisgrafik direkt über das native Teilen-Menü senden — ohne Konto.'
              : 'Ergebnisgrafik als PNG speichern; der Text wird zusätzlich kopiert.',
          ),
        ),
        el(
          'div',
          { class: 'row', style: 'gap:8px' },
          el(
            'button',
            { class: 'btn primary small', type: 'button', on: { click: () => openShareModal(run) } },
            svg(ICONS.share),
            'Teilen …',
          ),
          el('button', { class: 'btn secondary small', type: 'button', on: { click: () => openShareModal(run) } }, 'Grafik ansehen'),
        ),
      ),
      el('hr', { class: 'divider' }),
      el(
        'div',
        { class: 'row between' },
        el(
          'div',
          { class: 'row', style: 'gap:8px' },
          el('a', { class: 'btn secondary small', href: '#/compare' }, 'Mit anderen Läufen vergleichen'),
          el('a', { class: 'btn ghost small', href: `#/run?mode=${run.mode}` }, 'Erneut testen'),
        ),
        deleteButton,
      ),
    ]),
  );

  const node = el(
    'div',
    null,
    header,
    scores,
    el(
      'div',
      { class: 'section' },
      el('div', { class: 'grid grid-2' }, deviceCard, measurementCard),
    ),
    el('div', { class: 'section' }, cpuCard),
    el('div', { class: 'section' }, gpuCard),
    el('div', { class: 'section' }, efficiencyCard),
    webgpuCard ? el('div', { class: 'section' }, webgpuCard) : null,
    notesCard ? el('div', { class: 'section' }, notesCard) : null,
    actions,
    el(
      'p',
      { class: 'footnote', style: 'margin-top:20px' },
      `Alle Werte wurden in diesem Browser erzeugt. Scores sind relativ zur definierten Normalisierungsbasis der Suite ${run.suiteVersion} `
        + `(CPU ${run.cpuVersion}, GPU ${run.gpuVersion}).`,
    ),
  );

  return { node };
}
