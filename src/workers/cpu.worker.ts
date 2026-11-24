/**
 * CPU benchmark worker.
 *
 * Runs deterministic arithmetic, counts the primitive operations it performed
 * and reports throughput against a measured wall clock. Calibration happens
 * once so that every batch takes roughly the same time on any device, which is
 * what makes the measurement comparable across hardware.
 */

import { createRunner, WORKLOAD_INFO, type WorkloadId, type WorkloadRunner } from '../core/workloads';

interface CalibrateMessage {
  type: 'calibrate';
  batchTargetMs: number;
}

interface MeasureMessage {
  type: 'measure';
  units: Record<WorkloadId, number>;
  workloads: WorkloadId[];
  targetMs: number;
  trial: number;
}

interface AbortMessage {
  type: 'abort';
}

type InMessage = CalibrateMessage | MeasureMessage | AbortMessage;

const ctx = self as unknown as {
  postMessage: (message: unknown) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

const SEED = 0xbe11c4;
const MAX_UNITS = 1 << 28;

let aborted = false;
const runners = new Map<WorkloadId, WorkloadRunner>();

function runnerFor(id: WorkloadId): WorkloadRunner {
  let runner = runners.get(id);
  if (!runner) {
    runner = createRunner(id, SEED);
    runners.set(id, runner);
  }
  return runner;
}

function calibrate(batchTargetMs: number): Record<WorkloadId, number> {
  const units = {} as Record<WorkloadId, number>;
  for (const info of Object.values(WORKLOAD_INFO)) {
    const runner = runnerFor(info.id);
    let count = info.calibrateStart;
    let elapsed = 0;
    // Grow the batch geometrically until it reaches the target window.
    for (let attempt = 0; attempt < 24; attempt++) {
      const t0 = performance.now();
      runner.run(count);
      elapsed = performance.now() - t0;
      if (elapsed >= batchTargetMs || count >= MAX_UNITS) break;
      const factor = Math.min(4, Math.max(1.35, batchTargetMs / Math.max(elapsed, 0.05)));
      count = Math.min(MAX_UNITS, Math.max(count + 1, Math.round(count * factor)));
    }
    // Warm-up pass: lets the JIT settle before the timed run.
    runner.run(count);
    units[info.id] = Math.max(1, Math.round(count));
    ctx.postMessage({ type: 'calibrating', workload: info.id, units: units[info.id], elapsed });
  }
  return units;
}

interface WorkloadMeasurement {
  id: WorkloadId;
  ops: number;
  elapsed: number;
  wallMs: number;
  batches: Array<{ ops: number; ms: number }>;
}

function measureWorkload(
  id: WorkloadId,
  units: number,
  targetMs: number,
  trial: number,
  index: number,
  total: number,
): WorkloadMeasurement {
  const runner = runnerFor(id);
  const batches: Array<{ ops: number; ms: number }> = [];
  let ops = 0;
  let elapsed = 0;
  const wallStart = performance.now();
  let lastReport = 0;

  while (performance.now() - wallStart < targetMs && !aborted) {
    const t0 = performance.now();
    const result = runner.run(units);
    const ms = performance.now() - t0;
    ops += result.ops;
    elapsed += ms;
    batches.push({ ops: result.ops, ms });
    const now = performance.now();
    if (now - lastReport > 120 || now - wallStart >= targetMs) {
      lastReport = now;
      ctx.postMessage({
        type: 'progress',
        trial,
        workload: id,
        index,
        total,
        fraction: Math.min(1, (now - wallStart) / targetMs),
        opsPerSecond: elapsed > 0 ? ops / (elapsed / 1000) : 0,
      });
    }
  }

  return {
    id,
    ops,
    elapsed,
    wallMs: performance.now() - wallStart,
    batches,
  };
}

ctx.onmessage = (event: MessageEvent<InMessage>) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === 'abort') {
    aborted = true;
    return;
  }

  if (message.type === 'calibrate') {
    aborted = false;
    try {
      const units = calibrate(message.batchTargetMs);
      ctx.postMessage({ type: 'calibrated', units });
    } catch (error) {
      ctx.postMessage({ type: 'error', message: String(error) });
    }
    return;
  }

  if (message.type === 'measure') {
    aborted = false;
    try {
      const results: WorkloadMeasurement[] = [];
      message.workloads.forEach((id, index) => {
        if (aborted) return;
        results.push(
          measureWorkload(
            id,
            message.units[id] ?? 1,
            message.targetMs,
            message.trial,
            index,
            message.workloads.length,
          ),
        );
      });
      ctx.postMessage({ type: 'result', trial: message.trial, results });
    } catch (error) {
      ctx.postMessage({ type: 'error', message: String(error) });
    }
  }
};

