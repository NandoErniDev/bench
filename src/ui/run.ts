import { el, svg, ICONS, fmtInt, sleep } from '../core/util';
import { MODE_INFO, type Mode } from '../core/suite';
import { runBenchmark, type StageState } from '../core/runner';
import { saveRun } from '../core/storage';
import { navigate } from './router';
import { card, note } from './components';
import type { View } from './types';

const STAGES = [
  { id: 'device', label: 'Gerät und Browser erkennen' },
  { id: 'cpu', label: 'CPU: Single-Core, Multi-Core, Dauerlast' },
  { id: 'cooldown', label: 'Abkühlpause' },
  { id: 'gpu', label: 'GPU: Shader, Geometrie, Szene, Simulation' },
  { id: 'webgpu', label: 'WebGPU-Verfügbarkeit (optional)' },
  { id: 'finalize', label: 'Auswertung und Scores' },
];

export function runView(params: { mode: Mode }): View {
  const mode = params.mode;
  const controller = new AbortController();
  const startedAt = performance.now();
  let finished = false;

  const stageItems = new Map<string, HTMLElement>();
  const stageList = el('ul', { class: 'stage-list' });
  for (const stage of STAGES) {
    const item = el(
      'li',
      { class: 'stage', dataset: { state: 'pending' } },
      el('span', { class: 'dot' }),
      el('span', { class: 'stage-name' }, stage.label),
      el('span', { class: 'stage-detail' }),
    );
    stageItems.set(stage.id, item);
    stageList.appendChild(item);
  }

  const progressFill = el('div', { class: 'progress-fill' });
  const percentLabel = el('span', { class: 'mono small muted' }, '0 %');
  const stageLabel = el('div', { style: 'font-weight:550' }, 'Vorbereitung …');
  const detailLabel = el('div', { class: 'footnote' }, MODE_INFO[mode].label);

  const liveMetrics = el('div', { class: 'live-metrics', style: 'margin-top:12px' });
  const canvasHost = el('div', { class: 'run-canvas' },
    el('div', { class: 'canvas-placeholder' }, 'GPU-Test startet nach der CPU-Messung'),
  );

  const pauseLabel = el('div', { style: 'font-weight:550' }, 'Abkühlpause');
  const pauseCountdown = el('div', { class: 'stat-value', style: 'font-size:2rem' }, '0 s');
  const pausePanel = el(
    'div',
    { class: 'card', style: 'margin-top:10px;display:none', dataset: { pause: 'panel' } },
    el('div', { class: 'row between' }, pauseLabel, pauseCountdown),
    el(
      'p',
      { class: 'footnote', style: 'margin-top:8px' },
      'Kurze Pause zwischen den Belastungsphasen, damit das Gerät nicht unnötig überhitzt. Die Messwerte werden davon nicht beeinflusst.',
    ),
    el(
      'button',
      {
        class: 'btn secondary small',
        type: 'button',
        style: 'margin-top:10px',
        on: { click: () => { pauseSkip = true; } },
      },
      'Pause überspringen',
    ),
  );

  const cancelButton = el(
    'button',
    { class: 'btn secondary', type: 'button', on: { click: () => controller.abort() } },
    svg(ICONS.x),
    'Abbrechen',
  );

  const backgroundWarning = el('div', { style: 'margin-top:12px' });

  const header = el(
    'div',
    { class: 'row between', style: 'align-items:flex-start' },
    el(
      'div',
      null,
      el('div', { class: 'eyebrow' }, el('span', { class: 'eyebrow-dot' }), MODE_INFO[mode].label),
      el('h1', { style: 'font-size:clamp(1.7rem,3.4vw,2.3rem);margin-top:10px' }, 'Benchmark läuft'),
      el('p', { class: 'lede small', style: 'margin-top:6px' }, MODE_INFO[mode].description),
    ),
    cancelButton,
  );

  const panel = card([
    el('div', { class: 'row between', style: 'margin-bottom:8px' }, stageLabel, percentLabel),
    el('div', { class: 'progress' }, progressFill),
    detailLabel,
    el(
      'div',
      { class: 'run-stage', style: 'margin-top:18px' },
      el('div', null, canvasHost, liveMetrics),
      el('div', null, stageList, pausePanel),
    ),
    backgroundWarning,
  ]);

  const footerNote = el(
    'div',
    { class: 'section' },
    note(
      '<strong>Während der Messung:</strong> Tab sichtbar lassen, Gerät nicht sperren, keine Hintergrund-Downloads starten. Browser drosseln Timer und Grafik im Hintergrund — das würde die Werte verfälschen.',
      'default',
    ),
  );

  const node = el('div', null, header, el('div', { style: 'margin-top:18px' }, panel), footerNote);

  let pauseSkip = false;
  let activeStageId = 'device';
  const completed = new Set<string>();

  function setActive(id: string): void {
    activeStageId = id;
    let reached = false;
    for (const stage of STAGES) {
      const item = stageItems.get(stage.id);
      if (!item) continue;
      if (stage.id === id) {
        item.dataset.state = 'active';
        reached = true;
      } else if (!reached) {
        item.dataset.state = completed.has(stage.id) ? 'done' : 'pending';
      } else {
        item.dataset.state = completed.has(stage.id) ? 'done' : 'pending';
      }
    }
    for (const [id2, item] of stageItems) {
      if (!completed.has(id2) && item.dataset.state === 'pending' && id2 === id) item.dataset.state = 'active';
    }
  }

  function applyStage(stage: StageState): void {
    if (!node.isConnected) return;
    const index = STAGES.findIndex((s) => s.id === stage.id);
    if (index >= 0) {
      for (let i = 0; i < index; i++) completed.add(STAGES[i].id);
      setActive(stage.id);
    }
    stageLabel.textContent = stage.label;
    const percent = Math.round(stage.progress * 100);
    progressFill.style.width = `${percent}%`;
    percentLabel.textContent = `${percent} %`;
    const elapsed = performance.now() - startedAt;
    detailLabel.textContent = `${MODE_INFO[mode].label} · ${Math.round(elapsed / 1000)} s vergangen`;

    for (const [id, item] of stageItems) {
      const detail = item.querySelector('.stage-detail');
      if (!detail) continue;
      if (id === stage.id) detail.textContent = stage.live[0]?.value ?? '';
      else if (completed.has(id)) detail.textContent = 'abgeschlossen';
    }

    liveMetrics.replaceChildren(
      ...(stage.live.length
        ? stage.live.map((entry) =>
            el(
              'div',
              { class: 'live-metric' },
              el('div', { class: 'lm-label' }, entry.label),
              el('div', { class: 'lm-value' }, entry.value),
            ),
          )
        : [
            el(
              'div',
              { class: 'live-metric' },
              el('div', { class: 'lm-label' }, 'Status'),
              el('div', { class: 'lm-value', style: 'font-size:0.95rem;font-weight:500' }, stage.label),
            ),
          ]),
    );

    if (stage.id === 'gpu') {
      const placeholder = canvasHost.querySelector('.canvas-placeholder');
      if (placeholder) placeholder.textContent = 'GPU-Test läuft …';
    }
  }

  async function pause(ms: number, label: string): Promise<void> {
    pauseSkip = false;
    pausePanel.style.display = 'block';
    pauseLabel.textContent = label;
    setActive('cooldown');
    stageLabel.textContent = label;
    const end = performance.now() + ms;
    try {
      while (performance.now() < end) {
        if (pauseSkip) break;
        pauseCountdown.textContent = `${Math.ceil((end - performance.now()) / 1000)} s`;
        await sleep(Math.min(140, Math.max(0, end - performance.now())), controller.signal);
      }
    } finally {
      pausePanel.style.display = 'none';
    }
  }

  const onVisibility = () => {
    if (finished) return;
    backgroundWarning.replaceChildren(
      ...(document.visibilityState === 'hidden'
        ? [
            el('div', { style: 'margin-top:12px' }, note(
              'Der Tab ist im Hintergrund. Browser drosseln dann Timer und Grafik — dieses Ergebnis ist möglicherweise nicht repräsentativ.',
              'warn',
            )),
          ]
        : []),
    );
  };
  document.addEventListener('visibilitychange', onVisibility);

  function showCancelled(): void {
    cancelButton.remove();
    const cancelled = card([
      el('h3', null, 'Test abgebrochen'),
      el(
        'p',
        { class: 'small muted', style: 'margin-top:6px' },
        'Es wurden keine unvollständigen Werte gespeichert. Du kannst jederzeit einen neuen Durchlauf starten.',
      ),
      el(
        'div',
        { class: 'row', style: 'margin-top:16px;gap:8px' },
        el('button', { class: 'btn primary', type: 'button', on: { click: () => navigate(`/run?mode=${mode}`) } }, 'Neu starten'),
        el('a', { class: 'btn secondary', href: '#/' }, 'Zur Startseite'),
      ),
    ]);
    panel.replaceWith(cancelled);
  }

  function showError(message: string): void {
    cancelButton.remove();
    const error = card([
      el('h3', null, 'Test konnte nicht abgeschlossen werden'),
      el('p', { class: 'small muted', style: 'margin-top:6px' }, message),
      el(
        'div',
        { class: 'row', style: 'margin-top:16px;gap:8px' },
        el('button', { class: 'btn primary', type: 'button', on: { click: () => navigate(`/run?mode=${mode}`) } }, 'Erneut versuchen'),
        el('a', { class: 'btn secondary', href: '#/' }, 'Zur Startseite'),
      ),
    ]);
    panel.replaceWith(error);
  }

  runBenchmark({
    mode,
    signal: controller.signal,
    gpuHost: canvasHost,
    onStage: applyStage,
    pause,
  })
    .then((result) => {
      finished = true;
      saveRun(result);
      navigate(`/result/${result.id}`);
    })
    .catch((error: unknown) => {
      finished = true;
      if (!node.isConnected) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        showCancelled();
        return;
      }
      showError(error instanceof Error ? error.message : String(error));
    });

  return {
    node,
    destroy() {
      finished = true;
      document.removeEventListener('visibilitychange', onVisibility);
      controller.abort();
    },
  };
}

void fmtInt;
