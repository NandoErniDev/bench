/**
 * Offline calibration helper.
 *
 * Runs the exact workload implementations used by the worker and prints the
 * resulting throughput. The reference constants in src/core/suite.ts correspond
 * to a score of 1000 on this basis.
 *
 * Usage: node --experimental-strip-types scripts/calibrate.ts
 */

import { createRunner, WORKLOAD_INFO, type WorkloadId } from '../src/core/workloads.ts';

const ids: WorkloadId[] = ['int', 'float', 'math', 'fft'];
const batchTarget = 32;
const targetMs = 1800;

for (const id of ids) {
  const info = WORKLOAD_INFO[id];
  const runner = createRunner(id, 0xbe11c4);
  let units = info.calibrateStart;
  let elapsed = 0;

  for (let attempt = 0; attempt < 24; attempt++) {
    const t0 = performance.now();
    runner.run(units);
    elapsed = performance.now() - t0;
    if (elapsed >= batchTarget) break;
    const factor = Math.min(4, Math.max(1.35, batchTarget / Math.max(elapsed, 0.05)));
    units = Math.max(1, Math.round(units * factor));
  }
  runner.run(units);

  let ops = 0;
  let wall = 0;
  const started = performance.now();
  while (performance.now() - started < targetMs) {
    const t0 = performance.now();
    const result = runner.run(units);
    ops += result.ops;
    wall += performance.now() - t0;
  }

  const perSecond = ops / (wall / 1000);
  console.log(
    `${id.padEnd(6)} units=${String(units).padEnd(8)} ${(perSecond / 1e6).toFixed(2).padStart(8)} M ops/s`,
  );
}
