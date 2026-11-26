/**
 * Suite definition: versions, weights, normalization basis and result types.
 *
 * Everything that influences a score is versioned here. Runs of different
 * suite versions are never merged in comparisons.
 */

import type { WorkloadId } from './workloads';
import type { DeviceInfo } from './device';

export type Mode = 'quick' | 'full';
export type GpuTestId = 'fragment' | 'geometry' | 'scene' | 'sim';

export const SUITE = {
  name: 'BENCH',
  version: '1.1.0',
  cpuVersion: 'c2',
  gpuVersion: 'g2',
  normalization: 'Basis 1 (definierte Kalibrierungskonstanten)',
} as const;

export const MODE_INFO: Record<Mode, { label: string; description: string; detail: string }> = {
  quick: {
    label: 'Quick Test',
    description: 'Kurze Laufzeit, schnelle Orientierung',
    detail: '1 Messdurchlauf pro Stufe · ca. 10–20 s Gesamtdauer',
  },
  full: {
    label: 'Full Test',
    description: 'Mehrere Durchläufe, Dauerlast, Stabilitätsanalyse',
    detail: 'Wiederholte Messungen mit Abkühlpausen · ca. 1–2 min',
  },
};

/** Target measurement window per workload, in milliseconds. */
export const TIMING = {
  quick: {
    batchTargetMs: 24,
    cpuSingleMs: 800,
    cpuMultiMs: 800,
    sustainedTrials: 0,
    sustainedMs: 0,
    gpuTestMs: 1200,
    gpuScaleMs: 500,
    pauseAfterCpuMs: 1500,
    pauseBetweenGpuMs: 400,
  },
  full: {
    batchTargetMs: 32,
    cpuSingleMs: 1800,
    cpuMultiMs: 2200,
    sustainedTrials: 3,
    sustainedMs: 1600,
    gpuTestMs: 3200,
    gpuScaleMs: 900,
    pauseAfterCpuMs: 5000,
    pauseBetweenGpuMs: 1200,
  },
} as const;

/**
 * Normalization constants. A score of 1000 corresponds to this basis.
 * They are fixed constants of the suite version — not measurements of a
 * specific device — and are documented in the methodology view.
 */
export const CPU_REFERENCE: Record<WorkloadId, number> = {
  int: 260e6,
  float: 235e6,
  math: 276e6,
  fft: 107e6,
};

export const GPU_REFERENCE: Record<GpuTestId, number> = {
  fragment: 60e6,
  geometry: 120e6,
  scene: 30e6,
  sim: 80e6,
};

export const CPU_WEIGHTS: Record<WorkloadId, number> = {
  int: 0.3,
  float: 0.25,
  math: 0.25,
  fft: 0.2,
};

export const CPU_COMPOSITE = { single: 0.4, multi: 0.6 } as const;

export const GPU_WEIGHTS: Record<GpuTestId, number> = {
  fragment: 0.4,
  geometry: 0.2,
  scene: 0.25,
  sim: 0.15,
};

export const GPU_TEST_INFO: Record<GpuTestId, { label: string; detail: string; unit: string }> = {
  fragment: {
    label: 'Shader-Berechnung',
    detail: 'Fullscreen-Fragment-Shader, 48 komplexe Iterationen pro Pixel bei 1280 × 720',
    unit: 'Mpx/s',
  },
  geometry: {
    label: 'Vertex-Durchsatz',
    detail: '262 144 Punkte, Vertex-Shader-Transformation mit Trigonometrie, 1280 × 720',
    unit: 'MVert/s',
  },
  scene: {
    label: '3D-Szene',
    detail: 'Prozedurales Terrain-Gitter mit Normalen, Tiefentest und Beleuchtung',
    unit: 'Mtri/s',
  },
  sim: {
    label: 'GPGPU-Partikelsimulation',
    detail: '262 144 Partikel, Ping-Pong-Zustand (RGBA8), Integrationsschritte',
    unit: 'Mstep/s',
  },
};

export const GPU_RESOLUTION = { w: 1280, h: 720 } as const;

export interface WorkloadScore {
  id: WorkloadId;
  label: string;
  unit: string;
  detail: string;
  singleValue: number;
  singleScore: number;
  multiValue: number;
  multiScore: number;
}

export interface SustainedTrial {
  index: number;
  score: number;
  value: number;
}

export interface CpuResult {
  score: number;
  singleScore: number;
  multiScore: number;
  /** Logical cores the browser reported, capped to the tested worker count. */
  coresAvailable: number | null;
  workersUsed: number;
  workloads: WorkloadScore[];
  sustained: {
    trials: SustainedTrial[];
    peak: number;
    average: number;
    last: number;
    dropPct: number;
  } | null;
  durationMs: number;
  workerSupport: boolean;
}

export interface GpuTestScore {
  id: GpuTestId;
  label: string;
  detail: string;
  unit: string;
  value: number;
  score: number;
  avgFrameMs: number;
  gpuMs: number | null;
  samples: number[];
}

export interface GpuResult {
  score: number;
  tests: GpuTestScore[];
  api: 'webgl2';
  renderer: string | null;
  vendor: string | null;
  /** True when WebGL runs on a software rasteriser instead of a real GPU. */
  software: boolean;
  timerQuery: boolean;
  resolution: { w: number; h: number };
  scaling: Array<{ scale: number; value: number }>;
  durationMs: number;
}

export interface WebGpuResult {
  supported: boolean;
  adapter: string | null;
  vendor: string | null;
  computeValue: number | null;
  unit: string;
  durationMs: number | null;
  note: string;
}

export interface EfficiencyResult {
  /** Measured multi-core scaling, derived from single vs. multi throughput. */
  parallelScaling: number | null;
  /** Retained sustained performance (average / peak). */
  stability: number | null;
  dropPct: number | null;
  /** Documented proxy combining scaling and stability. Never watts. */
  proxy: number | null;
  watts: null;
  note: string;
}

export interface RunResult {
  id: string;
  createdAt: number;
  mode: Mode;
  suiteVersion: string;
  cpuVersion: string;
  gpuVersion: string;
  device: DeviceInfo;
  cpu: CpuResult;
  gpu: GpuResult | null;
  overall: number | null;
  efficiency: EfficiencyResult;
  webgpu: WebGpuResult | null;
  durationMs: number;
  notes: string[];
}

export function normalize(value: number, reference: number): number {
  if (!Number.isFinite(value) || reference <= 0) return 0;
  return (value / reference) * 1000;
}

export function weightedMean(items: Array<{ value: number; weight: number }>): number {
  let weightSum = 0;
  let acc = 0;
  for (const item of items) {
    acc += item.value * item.weight;
    weightSum += item.weight;
  }
  return weightSum > 0 ? acc / weightSum : 0;
}

export function overallFrom(cpuScore: number, gpuScore: number | null): number | null {
  if (gpuScore === null || !Number.isFinite(gpuScore)) return null;
  return Math.round(Math.sqrt(Math.max(cpuScore, 0) * Math.max(gpuScore, 0)));
}

export const OVERALL_FORMULA = 'Overall = √(CPU-Score × GPU-Score) — gleiche Gewichtung 50 / 50';

export function scoreLabel(score: number | null): string {
  if (score === null) return '—';
  return Math.round(score).toLocaleString('de-DE');
}

export function modeLabel(mode: Mode): string {
  return MODE_INFO[mode].label;
}

export function isComparable(a: RunResult, b: RunResult): { ok: boolean; reason: string | null } {
  if (a.mode !== b.mode) {
    return { ok: false, reason: 'Quick- und Full-Ergebnisse sind nicht direkt vergleichbar.' };
  }
  if (a.suiteVersion !== b.suiteVersion || a.cpuVersion !== b.cpuVersion || a.gpuVersion !== b.gpuVersion) {
    return {
      ok: false,
      reason: 'Unterschiedliche Testversionen — Ergebnisse dürfen nicht vermischt werden.',
    };
  }
  return { ok: true, reason: null };
}
