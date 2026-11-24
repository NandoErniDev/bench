/**
 * Deterministic CPU workloads.
 *
 * These functions are shared by the benchmark worker and by the offline
 * calibration script, so every score is derived from the same arithmetic.
 * Each workload reports the number of primitive operations it actually
 * performed; the benchmark divides that by the measured wall time.
 */

export type WorkloadId = 'int' | 'float' | 'math' | 'fft';

export interface WorkloadRun {
  ops: number;
  checksum: number;
}

export interface WorkloadRunner {
  run(units: number): WorkloadRun;
}

export interface WorkloadInfo {
  id: WorkloadId;
  label: string;
  detail: string;
  /** Short unit for tables, values are always divided by 1e6. */
  unit: string;
  /** What one reported operation is, shown in the methodology view. */
  opDefinition: string;
  /** Initial unit count used by the calibration step. */
  calibrateStart: number;
}

export const WORKLOAD_INFO: Record<WorkloadId, WorkloadInfo> = {
  int: {
    id: 'int',
    label: 'Integer',
    detail: 'Xorshift-Bitmix, verschachtelte 32-Bit-Arithmetik',
    unit: 'Mops/s',
    opDefinition: '9 primitive 32-Bit-Operationen pro Iteration',
    calibrateStart: 1 << 15,
  },
  float: {
    id: 'float',
    label: 'Gleitkomma',
    detail: 'Transzendente Funktionen, Wurzel, Division, Akkumulation',
    unit: 'Mops/s',
    opDefinition: '12 Gleitkomma-Operationen (inkl. sin/cos/sqrt) pro Iteration',
    calibrateStart: 1 << 13,
  },
  math: {
    id: 'math',
    label: 'Komplexe Mathematik',
    detail: 'Julia-Menge, 192 Iterationen, Divergenzabbruch',
    unit: 'MIt/s',
    opDefinition: '1 gezählte komplexe Iteration (≈ 6 Fließkomma-Operationen)',
    calibrateStart: 1 << 10,
  },
  fft: {
    id: 'fft',
    label: 'FFT',
    detail: 'Radix-2-FFT, 1024 komplexe Punkte, in-place',
    unit: 'MButt/s',
    opDefinition: '1 Butterfly (N/2 · log₂N pro Transformation)',
    calibrateStart: 1,
  },
};

const FFT_SIZE = 1024;
const FFT_BUTTERFLIES = (FFT_SIZE / 2) * Math.log2(FFT_SIZE);

function intRunner(seed: number): WorkloadRunner {
  let x = (seed ^ 0x9e3779b9) >>> 0;
  let y = (seed + 0x6d2b79f5) >>> 0;
  return {
    run(units: number): WorkloadRun {
      let acc = 0;
      const n = units | 0;
      for (let i = 0; i < n; i++) {
        x ^= x << 13;
        x >>>= 0;
        x ^= x >>> 17;
        x ^= x << 5;
        x >>>= 0;
        y = (y + 0x6d2b79f5) >>> 0;
        let t = Math.imul(y ^ (y >>> 15), y | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        acc ^= (t ^ (t >>> 14)) >>> 0;
      }
      return { ops: n * 9, checksum: (acc ^ x ^ y) >>> 0 };
    },
  };
}

function floatRunner(seed: number): WorkloadRunner {
  let a = 1.25 + (seed % 13) * 0.031;
  let b = 0.7;
  let c = 0.25 + (seed % 7) * 0.011;
  return {
    run(units: number): WorkloadRun {
      let s = 0;
      const n = units | 0;
      for (let i = 0; i < n; i++) {
        a = Math.sin(a) * 0.931 + Math.cos(b) * 0.069;
        b = Math.sqrt(Math.abs(a)) + 0.5;
        c = c * 0.5 + a / (1 + b * b);
        s += a - b + c;
      }
      return { ops: n * 12, checksum: s };
    },
  };
}

/**
 * Julia set instead of a Mandelbrot sweep: most sample points stay bounded, so
 * each sample performs the full iteration depth and the workload measures real
 * complex arithmetic instead of fast escapes.
 */
function mathRunner(seed: number): WorkloadRunner {
  let rng = seed >>> 0;
  const maxIter = 192;
  const cx = -0.7269;
  const cy = 0.1889;
  const next = () => {
    rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
    return rng / 4294967296;
  };
  return {
    run(units: number): WorkloadRun {
      let iterations = 0;
      let acc = 0;
      const n = units | 0;
      for (let i = 0; i < n; i++) {
        let x = next() * 2.6 - 1.3;
        let y = next() * 2.6 - 1.3;
        let k = 0;
        while (k < maxIter) {
          const xx = x * x;
          const yy = y * y;
          if (xx + yy > 4) break;
          y = 2 * x * y + cy;
          x = xx - yy + cx;
          k++;
        }
        iterations += k;
        acc += k;
      }
      return { ops: iterations, checksum: (acc % 1000003) | 0 };
    },
  };
}

function fftRunner(seed: number): WorkloadRunner {
  const n = FFT_SIZE;
  const half = n >> 1;
  const cosTable = new Float64Array(half);
  const sinTable = new Float64Array(half);
  for (let i = 0; i < half; i++) {
    cosTable[i] = Math.cos((2 * Math.PI * i) / n);
    sinTable[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  let rng = seed >>> 0;

  return {
    run(units: number): WorkloadRun {
      let acc = 0;
      const count = Math.max(1, units | 0);
      for (let u = 0; u < count; u++) {
        for (let i = 0; i < n; i++) {
          rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
          re[i] = rng / 2147483648 - 1;
          rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
          im[i] = rng / 2147483648 - 1;
        }
        // bit reversal
        for (let i = 1, j = 0; i < n; i++) {
          let bit = n >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) {
            const tr = re[i];
            re[i] = re[j];
            re[j] = tr;
            const ti = im[i];
            im[i] = im[j];
            im[j] = ti;
          }
        }
        // butterflies
        for (let len = 2; len <= n; len <<= 1) {
          const h = len >> 1;
          const step = n / len;
          for (let i = 0; i < n; i += len) {
            for (let k = 0; k < h; k++) {
              const wr = cosTable[k * step];
              const wi = -sinTable[k * step];
              const ur = re[i + k];
              const ui = im[i + k];
              const vr0 = re[i + k + h];
              const vi0 = im[i + k + h];
              const vr = vr0 * wr - vi0 * wi;
              const vi = vr0 * wi + vi0 * wr;
              re[i + k] = ur + vr;
              im[i + k] = ui + vi;
              re[i + k + h] = ur - vr;
              im[i + k + h] = ui - vi;
            }
          }
        }
        acc += re[1] + im[n - 1];
      }
      return { ops: count * FFT_BUTTERFLIES, checksum: Math.round(acc * 1000) };
    },
  };
}

export function createRunner(id: WorkloadId, seed: number): WorkloadRunner {
  switch (id) {
    case 'int':
      return intRunner(seed);
    case 'float':
      return floatRunner(seed);
    case 'math':
      return mathRunner(seed);
    case 'fft':
      return fftRunner(seed);
  }
}
