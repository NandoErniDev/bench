/**
 * Benchmark orchestration: device info → CPU → cooldown → GPU → optional
 * WebGPU → scoring. The runner never invents values: unavailable stages are
 * reported as notes and left out of the scores.
 */

import { detectDevice } from './device';
import { runCpuBenchmark } from './cpu';
import { runGpuBenchmark } from './gpu';
import { runWebGpuProbe } from './webgpu';
import {
  OVERALL_FORMULA,
  SUITE,
  TIMING,
  overallFrom,
  type CpuResult,
  type EfficiencyResult,
  type GpuResult,
  type Mode,
  type RunResult,
} from './suite';
import { throwIfAborted, uid, waitForVisible } from './util';

export interface StageState {
  id: string;
  label: string;
  /** 0..1 overall progress. */
  progress: number;
  live: Array<{ label: string; value: string }>;
}

export interface RunOptions {
  mode: Mode;
  signal: AbortSignal;
  /** Element that hosts the GPU rendering canvas, so the test is visible. */
  gpuHost: HTMLElement | null;
  onStage: (stage: StageState) => void;
  pause: (ms: number, label: string) => Promise<void>;
}

const PROGRESS = {
  device: [0, 0.05],
  cpu: [0.05, 0.55],
  cooldown: [0.55, 0.58],
  gpu: [0.58, 0.95],
  webgpu: [0.95, 0.98],
  finalize: [0.98, 1],
} as const;

function mapProgress(range: readonly [number, number], fraction: number): number {
  return range[0] + (range[1] - range[0]) * Math.min(1, Math.max(0, fraction));
}

export function computeEfficiency(cpu: CpuResult): EfficiencyResult {
  const parallelScaling =
    cpu.singleScore > 0 && cpu.workersUsed > 0
      ? Math.min(200, (cpu.multiScore / (cpu.singleScore * cpu.workersUsed)) * 100)
      : null;
  const stability = cpu.sustained && cpu.sustained.peak > 0 ? (cpu.sustained.average / cpu.sustained.peak) * 100 : null;
  const dropPct = cpu.sustained ? cpu.sustained.dropPct : null;
  const proxy =
    stability !== null && parallelScaling !== null
      ? (stability * Math.min(parallelScaling, 110)) / 100
      : null;

  return {
    parallelScaling,
    stability,
    dropPct,
    proxy,
    watts: null,
    note:
      'Es gibt keine Leistungsaufnahme in Watt: Browser stellen keinen Zugriff auf Energie- oder Thermischnutzung bereit. '
      + 'Der Effizienz-Proxy wird ausschließlich aus gemessener Parallelskalierung und gemessener Stabilität berechnet.',
  };
}

export async function runBenchmark(options: RunOptions): Promise<RunResult> {
  let hiddenSeen = false;
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') hiddenSeen = true;
  };
  document.addEventListener('visibilitychange', onVisibility);
  try {
    return await executeRun(options, () => hiddenSeen);
  } finally {
    document.removeEventListener('visibilitychange', onVisibility);
  }
}

async function executeRun(options: RunOptions, wasHidden: () => boolean): Promise<RunResult> {
  const started = performance.now();
  const { mode, signal } = options;
  const timing = TIMING[mode];
  const notes: string[] = [];

  options.onStage({
    id: 'device',
    label: 'Gerät und Browser erkennen',
    progress: 0.01,
    live: [],
  });
  const device = await detectDevice();
  throwIfAborted(signal);
  // Measurements only start while the tab is visible: background throttling
  // would change the numbers for reasons that have nothing to do with the device.
  await waitForVisible(signal);

  options.onStage({
    id: 'cpu',
    label: 'CPU-Benchmark wird vorbereitet',
    progress: mapProgress(PROGRESS.cpu, 0),
    live: [
      { label: 'Gerät', value: device.label },
      { label: 'Kerne (Browser)', value: device.cores ? String(device.cores) : 'nicht verfügbar' },
    ],
  });

  const cpu = await runCpuBenchmark({
    mode,
    signal,
    coresDetected: device.cores,
    pause: options.pause,
    onProgress: (progress) => {
      options.onStage({
        id: 'cpu',
        label: progress.label,
        progress: mapProgress(PROGRESS.cpu, progress.fraction),
        live: progress.live,
      });
    },
  });
  throwIfAborted(signal);

  await options.pause(
    timing.pauseAfterCpuMs,
    'Abkühlpause vor dem GPU-Test — das Gerät soll nicht unnötig heiß werden',
  );
  throwIfAborted(signal);
  await waitForVisible(signal);

  let gpu: GpuResult | null = null;
  if (!options.gpuHost) {
    notes.push('GPU-Test übersprungen: kein Render-Ziel verfügbar.');
  } else {
    try {
      gpu = await runGpuBenchmark({
        mode,
        signal,
        host: options.gpuHost,
        pause: options.pause,
        onProgress: (progress) => {
          options.onStage({
            id: 'gpu',
            label: progress.label,
            progress: mapProgress(PROGRESS.gpu, progress.fraction),
            live: progress.detail ? [{ label: 'Aktuell', value: progress.detail }] : [],
          });
        },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      if (signal.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      notes.push(`GPU-Test nicht abgeschlossen: ${message}`);
    }
  }

  let webgpu: RunResult['webgpu'] = null;
  if (mode === 'full') {
    throwIfAborted(signal);
    options.onStage({
      id: 'webgpu',
      label: 'WebGPU-Verfügbarkeit prüfen',
      progress: mapProgress(PROGRESS.webgpu, 0.3),
      live: [],
    });
    webgpu = await runWebGpuProbe(signal);
    throwIfAborted(signal);
  }

  options.onStage({
    id: 'finalize',
    label: 'Ergebnis berechnen',
    progress: mapProgress(PROGRESS.finalize, 0.6),
    live: [],
  });

  const efficiency = computeEfficiency(cpu);
  const overall = overallFrom(cpu.score, gpu ? gpu.score : null);
  if (gpu) {
    if (!gpu.timerQuery) {
      notes.push(
        'GPU-Zeitmessung: EXT_disjoint_timer_query_webgl2 nicht verfügbar — die Frame-Zeiten sind Wall-Clock-Werte inklusive CPU-Overhead.',
      );
    }
    notes.push('WebGL2 bei fixer interner Auflösung 1280 × 720 gemessen, unabhängig von der Displayauflösung.');
    if (gpu.software) {
      notes.push(
        `Software-Rasterizer statt Hardware-GPU erkannt (${gpu.renderer ?? 'Renderer unbekannt'}). Der GPU-Score beschreibt hier keine Grafikhardware und ist nicht mit echten GPUs vergleichbar.`,
      );
    }
  }
  notes.push(
    `CPU-Multi-Core mit ${cpu.workersUsed} Workern gemessen; der Browser meldet ${device.cores ?? 'keine'} logische Kerne.`,
  );
  if (wasHidden()) {
    notes.push(
      'Der Tab war während der Messung im Hintergrund. Browser drosseln Timer, Worker und Grafik — dieses Ergebnis ist nicht repräsentativ.',
    );
  }
  if (!cpu.sustained) {
    notes.push('Quick Test: keine Dauerlast-Messung, daher keine Stabilitäts- und Effizienz-Proxy-Werte.');
  }

  const result: RunResult = {
    id: uid(),
    createdAt: Date.now(),
    mode,
    suiteVersion: SUITE.version,
    cpuVersion: SUITE.cpuVersion,
    gpuVersion: SUITE.gpuVersion,
    device,
    cpu,
    gpu,
    overall,
    efficiency,
    webgpu,
    durationMs: Math.round(performance.now() - started),
    notes,
  };

  options.onStage({ id: 'finalize', label: 'Fertig', progress: 1, live: [] });
  void OVERALL_FORMULA;
  return result;
}
