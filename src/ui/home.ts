import { el, svg, ICONS, fmtInt, fmtDate, fmtDuration } from '../core/util';
import { MODE_INFO, SUITE, type Mode } from '../core/suite';
import { detectDevice, osLabel, browserLabel } from '../core/device';
import { loadRuns } from '../core/storage';
import { badge, card, note, segmented, tag } from './components';
import { navigate } from './router';
import type { View } from './types';

const FEATURES = [
  {
    icon: ICONS.cpu,
    title: 'CPU-Benchmark',
    text: 'Integer- und Gleitkomma-Arithmetik, komplexe Mathematik und FFT — jeweils Single-Core und über alle Kerne. Im Full Test zusätzlich Dauerlast über mehrere Durchläufe.',
    meta: '4 Arbeitslasten · Web Worker',
  },
  {
    icon: ICONS.gpu,
    title: 'GPU-Benchmark',
    text: 'Fragment-Shader, instanzierte Geometrie, eine beleuchtete 3D-Szene und eine GPGPU-Partikelsimulation. Gemessen bei fixer interner Auflösung von 1280 × 720.',
    meta: 'WebGL2 · WebGPU optional',
  },
  {
    icon: ICONS.gauge,
    title: 'Overall & Effizienz',
    text: 'Overall als geometrisches Mittel aus CPU und GPU. Effizienz ausschließlich aus gemessener Skalierung und Stabilität — niemals aus erfundenen Wattwerten.',
    meta: 'Formel offengelegt',
  },
  {
    icon: ICONS.layers,
    title: 'Interactive Experiments',
    text: 'Mandelbrot, Volume Shader, Partikelsimulation, 3D-Landschaft, Mandelbulb-Raymarcher, GPU-Fluid, Path Tracer, Reaktions-Diffusion und ein seltsamer Attraktor. Direkt auf dem Gerät berechnet — unabhängig von den Scores.',
    meta: '12 Labs · Echtzeit',
  },
];

export function homeView(): View {
  let mode: Mode = 'quick';

  const startButton = el(
    'button',
    {
      class: 'btn primary lg',
      type: 'button',
      on: { click: () => navigate(`/run?mode=${mode}`) },
    },
    svg(ICONS.play),
    'Benchmark starten',
  );

  const modeHint = el('p', { class: 'footnote', style: 'margin-top:2px' }, MODE_INFO.quick.detail);

  const modeSwitch = segmented<Mode>(
    [
      { value: 'quick', label: 'Quick Test' },
      { value: 'full', label: 'Full Test' },
    ],
    mode,
    (value) => {
      mode = value;
      modeHint.textContent = MODE_INFO[value].detail;
    },
  );

  const deviceLine = el('span', { class: 'small muted' }, 'Gerät wird erkannt …');

  const hero = el(
    'section',
    { class: 'hero' },
    el('div', { class: 'eyebrow' }, el('span', { class: 'eyebrow-dot' }), 'bench.naerdev.ch'),
    el('h1', null, 'Device Performance Benchmark'),
    el(
      'p',
      { class: 'lede' },
      'BENCH misst die tatsächliche Rechen- und Grafikleistung deines Geräts — lokal im Browser, ohne Installation und ohne Konto. Jeder Score entsteht aus echter Berechnung auf deiner Hardware.',
    ),
    el('div', { class: 'hero-actions' }, modeSwitch, startButton),
    modeHint,
    el(
      'ul',
      { class: 'hero-facts' },
      el('li', null, svg(ICONS.shield), 'Keine Datenübertragung'),
      el('li', null, svg(ICONS.cpu), 'Web Worker für CPU-Last'),
      el('li', null, svg(ICONS.gpu), 'WebGL2 mit GPU-Timer'),
      el('li', null, deviceLine),
    ),
  );

  const features = el(
    'section',
    { class: 'grid grid-2', style: 'margin-top:44px' },
    ...FEATURES.map((feature) =>
      el(
        'article',
        { class: 'card feature' },
        el('div', { class: 'feature-icon' }, svg(feature.icon)),
        el('h3', null, feature.title),
        el('p', null, feature.text),
        el('div', { class: 'feature-meta' }, feature.meta),
      ),
    ),
  );

  const steps = el(
    'section',
    { class: 'section' },
    el(
      'div',
      { class: 'section-head' },
      el('div', null, el('h2', null, 'So läuft ein Test'), el('p', null, 'Drei Schritte, keine Anmeldung. Der Test läuft vollständig auf deinem Gerät.')),
    ),
    el(
      'div',
      { class: 'quickstart' },
      ...[
        {
          title: 'Modus wählen',
          text: 'Quick Test für eine schnelle Einordnung in rund 15 Sekunden. Full Test für mehrere Durchläufe, Dauerlast und Stabilitätsanalyse.',
        },
        {
          title: 'Test laufen lassen',
          text: 'Das Gerät bleibt am Netz und wird nicht bewegt. Zwischen den Belastungsphasen legt BENCH Abkühlpausen ein; du kannst jederzeit abbrechen.',
        },
        {
          title: 'Ergebnis teilen',
          text: 'Ausführliche Auswertung mit Diagrammen und ein fertiger Benchmark-Bericht als Grafik — über das native Teilen-Menü oder als PNG.',
        },
      ].map((step, index) =>
        el(
          'article',
          { class: 'card' },
          el('div', { class: 'step-num' }, `SCHRITT ${index + 1}`),
          el('h3', { style: 'margin-top:8px' }, step.title),
          el('p', { class: 'small muted', style: 'margin-top:6px;line-height:1.55' }, step.text),
        ),
      ),
    ),
    el('div', { style: 'margin-top:14px' }, note(
      '<strong>Quick und Full bleiben getrennt.</strong> Beide Modi verwenden unterschiedliche Laufzeiten und Durchläufe, deshalb werden ihre Scores nie direkt verglichen oder gemischt.',
      'default',
    )),
  );

  const lastRun = loadRuns()[0];
  const history = lastRun
    ? el(
        'section',
        { class: 'section' },
        el('div', { class: 'section-head' }, el('div', null, el('h2', null, 'Letztes Ergebnis auf diesem Gerät'))),
        el(
          'div',
          { class: 'card' },
          el(
            'div',
            { class: 'row between', style: 'align-items:flex-start' },
            el(
              'div',
              { class: 'stack', style: 'gap:4px' },
              el(
                'div',
                { class: 'row', style: 'gap:8px' },
                el('span', { style: 'font-weight:600' }, lastRun.device.model || lastRun.device.label),
                badge(lastRun.mode),
              ),
              el('div', { class: 'small muted' }, `${fmtDate(lastRun.createdAt)} · ${fmtDuration(lastRun.durationMs)}`),
            ),
            el(
              'div',
              { class: 'row', style: 'gap:24px' },
              scoreMini('CPU', lastRun.cpu.score),
              scoreMini('GPU', lastRun.gpu?.score ?? null),
              scoreMini('Overall', lastRun.overall),
            ),
          ),
          el(
            'div',
            { class: 'row', style: 'margin-top:16px;gap:8px' },
            el('a', { class: 'btn secondary small', href: `#/result/${lastRun.id}` }, 'Ergebnis öffnen'),
            el('a', { class: 'btn ghost small', href: '#/compare' }, 'Mit anderen Läufen vergleichen'),
            el('a', { class: 'btn ghost small', href: '#/experiments' }, 'Experimente ansehen'),
          ),
        ),
      )
    : null;

  const limits = el(
    'section',
    { class: 'section' },
    card([
      el('div', { class: 'card-head' }, el('h3', null, 'Was Browser messen können — und was nicht')),
      el(
        'div',
        { class: 'stack', style: 'gap:10px' },
        el(
          'p',
          { class: 'small muted' },
          'Gemessen werden Rechenzeit, Durchsatz, Bildrate und Frame-Zeiten. Nicht verfügbar sind Leistungsaufnahme in Watt, Temperatur, Taktfrequenz und echte Hardwareauslastung — diese Werte werden weder geschätzt noch erfunden.',
        ),
        el(
          'div',
          { class: 'row', style: 'gap:6px' },
          tag('measured', 'gemessen'),
          el('span', { class: 'footnote' }, 'Durchsatz, Frame-Zeiten, Skalierung'),
          tag('derived', 'berechnet'),
          el('span', { class: 'footnote' }, 'Scores, Stabilität, Effizienz-Proxy'),
          tag('na'),
          el('span', { class: 'footnote' }, 'Watt, Temperatur, Takt'),
        ),
      ),
      el(
        'div',
        { class: 'row', style: 'margin-top:14px' },
        el('a', { class: 'btn secondary small', href: '#/method' }, 'Methodik und Gewichtung ansehen'),
        el('span', { class: 'footnote' }, `Suite ${SUITE.version} · CPU ${SUITE.cpuVersion} · GPU ${SUITE.gpuVersion}`),
      ),
    ]),
  );

  const node = el('div', null, hero, features, steps, history, limits);

  detectDevice()
    .then((device) => {
      if (!node.isConnected) return;
      deviceLine.textContent = `Erkannt: ${device.model || device.label} · ${osLabel(device)} · ${browserLabel(device)}`;
      deviceLine.title = device.userAgent;
    })
    .catch(() => {
      deviceLine.textContent = 'Geräteerkennung nicht verfügbar';
    });

  return { node };
}

function scoreMini(label: string, value: number | null) {
  return el(
    'div',
    { class: 'stat', style: 'gap:0' },
    el('div', { class: 'stat-label' }, label),
    el('div', { class: 'stat-value', style: 'font-size:1.35rem' }, value === null ? '—' : fmtInt(value)),
  );
}
