/**
 * Optional WebGPU probe + compute micro-benchmark.
 *
 * This is supplementary information only: the GPU score is always derived from
 * the WebGL2 suite so that results stay comparable across browsers. If WebGPU
 * is unavailable or the device rejects the shader, nothing is invented — the
 * result is reported as unavailable.
 */

import { throwIfAborted } from './util';
import type { WebGpuResult } from './suite';

interface GpuLike {
  requestAdapter(options?: { powerPreference?: string }): Promise<AdapterLike | null>;
  getPreferredCanvasFormat?: () => string;
}

interface AdapterLike {
  info?: { vendor?: string; architecture?: string; device?: string; description?: string };
  requestDevice(): Promise<DeviceLike>;
}

interface DeviceLike {
  createBuffer(desc: { size: number; usage: number }): BufferLike;
  createShaderModule(desc: { code: string }): unknown;
  createComputePipeline(desc: unknown): PipelineLike;
  createBindGroup(desc: unknown): unknown;
  createCommandEncoder(): EncoderLike;
  queue: QueueLike;
  destroy?: () => void;
}

interface BufferLike {
  destroy(): void;
}

interface PipelineLike {
  getBindGroupLayout(index: number): unknown;
}

interface EncoderLike {
  beginComputePass(): {
    setPipeline(pipeline: unknown): void;
    setBindGroup(index: number, group: unknown): void;
    dispatchWorkgroups(x: number, y?: number, z?: number): void;
    end(): void;
  };
  finish(): unknown;
}

interface QueueLike {
  writeBuffer(buffer: unknown, offset: number, data: ArrayBufferView): void;
  submit(buffers: unknown[]): void;
  onSubmittedWorkDone(): Promise<void>;
}

const WORKGROUP = 64;
const ITERATIONS = 256;
const FLOPS_PER_ITERATION = 8;

const SHADER = `
@group(0) @binding(0) var<storage, read_write> data: array<f32>;

@compute @workgroup_size(${WORKGROUP})
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  var x = data[i];
  let c = f32(i) * 0.000001;
  for (var k: u32 = 0u; k < ${ITERATIONS}u; k = k + 1u) {
    x = x * 1.000002 + c * 0.5;
    x = x + sin(x) * 0.0001;
  }
  data[i] = x;
}
`;

const unavailable = (note: string): WebGpuResult => ({
  supported: false,
  adapter: null,
  vendor: null,
  computeValue: null,
  unit: 'GFLOP/s',
  durationMs: null,
  note,
});

export async function runWebGpuProbe(signal?: AbortSignal): Promise<WebGpuResult> {
  const gpu = (navigator as unknown as { gpu?: GpuLike }).gpu;
  if (!gpu) {
    return unavailable('WebGPU ist in diesem Browser nicht verfügbar. Der GPU-Score stammt aus WebGL2.');
  }

  let device: DeviceLike | null = null;
  try {
    throwIfAborted(signal);
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) {
      return unavailable('WebGPU meldet keinen Adapter — vermutlich deaktiviert oder blockiert.');
    }
    throwIfAborted(signal);
    device = await adapter.requestDevice();

    const count = 1 << 19; // 524 288 floats
    const bufferSize = count * 4;
    const buffer = device.createBuffer({ size: bufferSize, usage: 0x80 | 0x08 | 0x04 });
    const data = new Float32Array(count);
    for (let i = 0; i < count; i++) data[i] = 0.5;
    device.queue.writeBuffer(buffer, 0, data);

    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: 'main' },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });

    const start = performance.now();
    const frames = 5;
    for (let frame = 0; frame < frames; frame++) {
      throwIfAborted(signal);
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(count / WORKGROUP));
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    const elapsed = performance.now() - start;

    const flops = count * ITERATIONS * FLOPS_PER_ITERATION * frames;
    const gflops = flops / (elapsed / 1000) / 1e9;
    buffer.destroy();

    const info = adapter.info;
    return {
      supported: true,
      adapter: info?.description || info?.architecture || null,
      vendor: info?.vendor || null,
      computeValue: Number.isFinite(gflops) ? gflops : null,
      unit: 'GFLOP/s',
      durationMs: Math.round(elapsed),
      note: 'Optionaler Zusatztest. Fließt nicht in den GPU-Score ein, damit WebGL2- und WebGPU-Ergebnisse nicht vermischt werden.',
    };
  } catch (error) {
    return unavailable(
      `WebGPU-Messung nicht möglich: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    device?.destroy?.();
  }
}
