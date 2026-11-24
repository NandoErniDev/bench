/**
 * CPU benchmark orchestration.
 *
 * Single-core: one worker runs every workload sequentially.
 * Multi-core: one worker per logical core (capped at 8) runs the same units
 * concurrently; throughput is the summed operations divided by the longest
 * worker wall clock, so no time is double counted.
 * Full mode additionally repeats the multi-core load to observe sustained
 * performance and thermal/scheduler throttling.
 */

import {
  CPU_COMPOSITE,
  CPU_REFERENCE,
  CPU_WEIGHTS,
  normalize,
  weightedMean,
  type CpuResult,
  type Mode,
  type SustainedTrial,
  type WorkloadScore,
} from './suite';
import { TIMING } from './suite';
import { WORKLOAD_INFO, type WorkloadId } from './workloads';
import { clamp, throwIfAborted } from './util';

const MAX_WORKERS = 8;
const WORKLOAD_ORDER: WorkloadId[] = ['int', 'float', 'math', 'fft'];

export interface CpuProgress {
  stage: 'calibrate' | 'single' | 'multi' | 'sustained';
  label: string;
  fraction: number;
  live: Array<{ label: string; value: string }>;
}

export interface CpuRunOptions {
  mode: Mode;
  signal: AbortSignal;
  onProgress: (progress: CpuProgress) => void;
  pause: (ms: number, label: string) => Promise<void>;
  coresDetected: number | null;
}

interface WorkerMessage {
  type: string;
  units?: Record<WorkloadId, number>;
  results?: Array<{
    id: WorkloadId;
    ops: number;
    elapsed: number;
    wallMs: number;
    batches: Array<{ ops: number; ms: number }>;
  }>;
  trial?: number;
  fraction?: number;
  workload?: WorkloadId;
  index?: number;
  total?: number;
  opsPerSecond?: number;
  message?: string;
}

function spawnWorker(): Worker {
  return new Worker(new URL('../workers/cpu.worker.ts', import.meta.url), { type: 'module' });
}

/** Sends one request and resolves on the matching terminal message. */
function call<T extends WorkerMessage>(
  worker: Worker,
  message: unknown,
  onProgress?: (msg: WorkerMessage) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onMessage = (event: MessageEvent<WorkerMessage>) => {
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'progress' || data.type === 'calibrating') {
        onProgress?.(data);
        return;
      }
      if (data.type === 'ready') return;
      if (data.type === 'error') {
        cleanup();
        reject(new Error(data.message ?? 'Worker-Fehler'));
        return;
      }
      cleanup();
      resolve(data as T);
    };
    const onError = (event: ErrorEvent) => {
      cleanup();
      reject(new Error(event.message || 'Worker konnte nicht ausgeführt werden'));
    };
    function cleanup() {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
    }
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.postMessage(message);
  });
}

interface Aggregate {
  id: WorkloadId;
  value: number;
  totalOps: number;
  wallMs: number;
}

type Measurement = {
  results: Array<{ id: WorkloadId; ops: number; elapsed: number; wallMs: number; batches: Array<{ ops: number; ms: number }> }>;
};

/** Summed ops over the longest worker wall clock = true aggregate throughput. */
function aggregate(results: Measurement['results'], workers: number): Aggregate[] {
  const map = new Map<WorkloadId, { ops: number; wall: number }>();
  for (const result of results) {
    const entry = map.get(result.id) ?? { ops: 0, wall: 0 };
    entry.ops += result.ops;
    entry.wall = Math.max(entry.wall, result.wallMs);
    map.set(result.id, entry);
  }
  const out: Aggregate[] = [];
  for (const id of WORKLOAD_ORDER) {
    const entry = map.get(id);
    if (!entry || entry.wall <= 0) continue;
    out.push({ id, value: entry.ops / (entry.wall / 1000), totalOps: entry.ops, wallMs: entry.wall });
  }
  void workers;
  return out;
}

function scoreFor(values: Aggregate[]): number {
  return weightedMean(
    values.map((entry) => ({
      value: normalize(entry.value, CPU_REFERENCE[entry.id]),
      weight: CPU_WEIGHTS[entry.id],
    })),
  );
}

export async function runCpuBenchmark(options: CpuRunOptions): Promise<CpuResult> {
  const started = performance.now();
  const timing = TIMING[options.mode];
  const { signal } = options;

  if (typeof Worker === 'undefined') {
    throw new Error('Web Workers werden von diesem Browser nicht unterstützt.');
  }

  const coresAvailable =
    options.coresDetected ?? (typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null);
  const workerCount = clamp(coresAvailable ?? 4, 1, MAX_WORKERS);

  options.onProgress({
    stage: 'calibrate',
    label: 'Arbeitslast kalibrieren',
    fraction: 0.02,
    live: [{ label: 'Kerne (Browser)', value: coresAvailable ? String(coresAvailable) : 'nicht verfügbar' }],
  });

  const workers: Worker[] = [];
  const terminateAll = () => {
    for (const worker of workers) worker.terminate();
    workers.length = 0;
  };

  try {
    throwIfAborted(signal);
    const singleWorker = spawnWorker();
    workers.push(singleWorker);
    const calibrated = await call<WorkerMessage>(singleWorker, {
      type: 'calibrate',
      batchTargetMs: timing.batchTargetMs,
    });
    throwIfAborted(signal);
    const units = calibrated.units;
    if (!units) throw new Error('Kalibrierung fehlgeschlagen.');

    // --- single core -----------------------------------------------------
    const single = await call<Measurement & WorkerMessage>(
      singleWorker,
      { type: 'measure', units, workloads: WORKLOAD_ORDER, targetMs: timing.cpuSingleMs, trial: 0 },
      (msg) => {
        if (msg.type !== 'progress') return;
        const base = 0.1;
        const span = 0.35;
        const done = ((msg.index ?? 0) + (msg.fraction ?? 0)) / WORKLOAD_ORDER.length;
        options.onProgress({
          stage: 'single',
          label: `Single-Core: ${WORKLOAD_INFO[msg.workload ?? 'int'].label}`,
          fraction: base + span * done,
          live: msg.opsPerSecond
            ? [
                { label: 'Aktuell', value: `${(msg.opsPerSecond / 1e6).toFixed(0)} Mops/s` },
                { label: 'Kerne (Browser)', value: coresAvailable ? String(coresAvailable) : 'nicht verfügbar' },
              ]
            : [],
        });
      },
    );
    const singleAggregate = aggregate(single.results ?? [], 1);
    singleWorker.terminate();
    workers.splice(workers.indexOf(singleWorker), 1);

    // --- multi core ------------------------------------------------------
    const multiWorkers: Worker[] = [];
    for (let i = 0; i < workerCount; i++) {
      const worker = spawnWorker();
      multiWorkers.push(worker);
      workers.push(worker);
    }

    const runMulti = async (targetMs: number, trial: number): Promise<Aggregate[]> => {
      const progress = new Map<number, { index: number; fraction: number; opsPerSecond: number; id: WorkloadId }>();
      const promises = multiWorkers.map((worker, index) =>
        call<Measurement & WorkerMessage>(
          worker,
          { type: 'measure', units, workloads: WORKLOAD_ORDER, targetMs, trial },
          (msg) => {
            if (msg.type !== 'progress') return;
            progress.set(index, {
              index: msg.index ?? 0,
              fraction: msg.fraction ?? 0,
              opsPerSecond: msg.opsPerSecond ?? 0,
              id: msg.workload ?? 'int',
            });
            let sum = 0;
            for (const p of progress.values()) sum += (p.index + p.fraction) / WORKLOAD_ORDER.length;
            const average = sum / multiWorkers.length;
            const throughput = Array.from(progress.values()).reduce((acc, p) => acc + p.opsPerSecond, 0);
            options.onProgress({
              stage: trial > 0 ? 'sustained' : 'multi',
              label:
                trial > 0
                  ? `Dauerlast — Durchlauf ${trial + 1}/${TIMING[options.mode].sustainedTrials}`
                  : `Multi-Core: ${WORKLOAD_INFO[progress.get(index)?.id ?? 'int'].label}`,
              fraction: trial > 0 ? 0.75 + (trial / Math.max(1, TIMING[options.mode].sustainedTrials)) * 0.15 + average * 0.05 : 0.45 + average * 0.28,
              live: [
                { label: 'Aggregiert', value: `${(throughput / 1e6).toFixed(0)} Mops/s` },
                { label: 'Worker', value: String(multiWorkers.length) },
              ],
            });
          },
        ),
      );
      const results = await Promise.all(promises);
      const merged: Measurement['results'] = [];
      for (const result of results) merged.push(...(result.results ?? []));
      return aggregate(merged, multiWorkers.length);
    };

    throwIfAborted(signal);
    const multiAggregate = await runMulti(timing.cpuMultiMs, 0);

    // --- sustained -------------------------------------------------------
    let sustained: CpuResult['sustained'] = null;
    if (timing.sustainedTrials > 0) {
      const trials: SustainedTrial[] = [];
      const baseScore = scoreFor(multiAggregate);
      trials.push({ index: 0, score: Math.round(baseScore), value: multiAggregate[0]?.value ?? 0 });
      for (let trial = 1; trial <= timing.sustainedTrials; trial++) {
        throwIfAborted(signal);
        await options.pause(4000, `Abkühlpause vor Durchlauf ${trial + 1}`);
        throwIfAborted(signal);
        const trialAggregate = await runMulti(timing.sustainedMs, trial);
        const trialScore = scoreFor(trialAggregate);
        trials.push({
          index: trial,
          score: Math.round(trialScore),
          value: trialAggregate.reduce((acc, entry) => acc + entry.value, 0),
        });
      }
      const scores = trials.map((t) => t.score);
      const peak = Math.max(...scores);
      const average = scores.reduce((a, b) => a + b, 0) / scores.length;
      const last = scores[scores.length - 1];
      sustained = {
        trials,
        peak,
        average,
        last,
        dropPct: peak > 0 ? ((peak - last) / peak) * 100 : 0,
      };
    }

    // --- scoring ---------------------------------------------------------
    const singleScore = scoreFor(singleAggregate);
    const multiScore = scoreFor(multiAggregate);
    const workloads: WorkloadScore[] = singleAggregate.map((entry) => {
      const info = WORKLOAD_INFO[entry.id];
      const multiEntry = multiAggregate.find((m) => m.id === entry.id);
      return {
        id: entry.id,
        label: info.label,
        unit: info.unit,
        detail: info.detail,
        singleValue: entry.value,
        singleScore: normalize(entry.value, CPU_REFERENCE[entry.id]),
        multiValue: multiEntry?.value ?? 0,
        multiScore: normalize(multiEntry?.value ?? 0, CPU_REFERENCE[entry.id]),
      };
    });

    const score = Math.round(
      singleScore * CPU_COMPOSITE.single + multiScore * CPU_COMPOSITE.multi,
    );

    options.onProgress({
      stage: 'sustained',
      label: 'CPU-Auswertung',
      fraction: 1,
      live: [
        { label: 'Single-Core', value: String(Math.round(singleScore)) },
        { label: 'Multi-Core', value: String(Math.round(multiScore)) },
      ],
    });

    return {
      score,
      singleScore: Math.round(singleScore),
      multiScore: Math.round(multiScore),
      coresAvailable,
      workersUsed: multiWorkers.length,
      workloads,
      sustained,
      durationMs: Math.round(performance.now() - started),
      workerSupport: true,
    };
  } finally {
    terminateAll();
  }
}
