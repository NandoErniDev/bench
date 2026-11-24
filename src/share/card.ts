/**
 * Share graphic: a self-contained benchmark report rendered to canvas, so it
 * can go through the native share sheet (WhatsApp, AirDrop, Messages, …),
 * be saved as PNG, or fall back to a text summary.
 */

import { fmtInt, fmtNum, fmtDuration, download } from '../core/util';
import { SUITE, type RunResult } from '../core/suite';

const W = 1200;
const H = 1500;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", system-ui, sans-serif';

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

function fitFont(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, min: number): number {
  let size = start;
  while (size > min) {
    ctx.font = font(600, size);
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  }
  return size;
}

const WHITE = '#f5f5f7';
const MUTED = 'rgba(245,245,247,0.5)';
const DIM = 'rgba(245,245,247,0.32)';
const HAIR = 'rgba(255,255,255,0.09)';
const ACCENT = '#0a84ff';

export function renderShareCard(run: RunResult): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const gradient = ctx.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, '#0a0a0c');
  gradient.addColorStop(0.55, '#0c0c10');
  gradient.addColorStop(1, '#111117');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  // header
  ctx.fillStyle = WHITE;
  roundRect(ctx, 72, 62, 34, 34, 9);
  ctx.fill();
  ctx.fillStyle = '#0a0a0c';
  ctx.font = font(700, 20);
  ctx.textAlign = 'center';
  ctx.fillText('B', 89, 86);

  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.font = font(600, 20);
  ctx.fillText('B E N C H', 120, 86);

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = font(400, 18);
  ctx.fillText('bench.naerdev.ch', W - 72, 86);

  ctx.strokeStyle = HAIR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(72, 126);
  ctx.lineTo(W - 72, 126);
  ctx.stroke();

  // eyebrow + mode pill
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 15);
  ctx.fillText('BENCHMARK REPORT', 72, 182);

  const modeText = run.mode === 'quick' ? 'QUICK TEST' : 'FULL TEST';
  ctx.font = font(650, 15);
  const pillWidth = ctx.measureText(modeText).width + 34;
  ctx.fillStyle = run.mode === 'quick' ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.1)';
  roundRect(ctx, W - 72 - pillWidth, 158, pillWidth, 32, 16);
  ctx.fill();
  ctx.fillStyle = run.mode === 'quick' ? '#6cb6ff' : WHITE;
  ctx.textAlign = 'center';
  ctx.fillText(modeText, W - 72 - pillWidth / 2, 180);

  // device
  ctx.textAlign = 'left';
  const deviceName = run.device.model || run.device.label;
  const deviceSize = fitFont(ctx, deviceName, W - 200, 54, 30);
  ctx.fillStyle = WHITE;
  ctx.font = font(600, deviceSize);
  ctx.fillText(deviceName, 72, 256);

  const platformName = run.device.platform ?? 'Plattform nicht verfügbar';
  const osText = run.device.platformVersion ? `${platformName} ${run.device.platformVersion}` : platformName;
  const browserText = run.device.browserVersion
    ? `${run.device.browser} ${run.device.browserVersion}`
    : run.device.browser;
  ctx.fillStyle = MUTED;
  ctx.font = font(400, 21);
  ctx.fillText(`${osText}  ·  ${browserText}`, 72, 292);

  // score band
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  roundRect(ctx, 72, 330, W - 144, 296, 22);
  ctx.fill();
  ctx.strokeStyle = HAIR;
  roundRect(ctx, 72, 330, W - 144, 296, 22);
  ctx.stroke();

  const columns = [
    { label: 'CPU', value: run.cpu.score, foot: `Single ${fmtInt(run.cpu.singleScore)} · Multi ${fmtInt(run.cpu.multiScore)}` },
    {
      label: 'GPU',
      value: run.gpu?.score ?? null,
      foot: run.gpu ? `WebGL2 · ${run.gpu.resolution.w}×${run.gpu.resolution.h}` : 'nicht verfügbar',
    },
    { label: 'OVERALL', value: run.overall, foot: '√(CPU × GPU)' },
  ];

  columns.forEach((column, index) => {
    const x = 108 + index * 352;
    ctx.textAlign = 'left';
    ctx.fillStyle = index === 2 ? 'rgba(10,132,255,0.85)' : MUTED;
    ctx.font = font(600, 14);
    ctx.fillText(column.label, x, 388);

    ctx.fillStyle = index === 2 ? ACCENT : WHITE;
    ctx.font = font(600, 96);
    ctx.fillText(column.value === null ? '—' : fmtInt(column.value), x, 480);

    ctx.fillStyle = DIM;
    ctx.font = font(400, 17);
    ctx.fillText(column.foot, x, 516);

    if (index < 2) {
      ctx.strokeStyle = HAIR;
      ctx.beginPath();
      ctx.moveTo(x + 306, 362);
      ctx.lineTo(x + 306, 594);
      ctx.stroke();
    }
  });

  // breakdown columns
  const cpu = run.cpu;
  const gpu = run.gpu;
  const leftRows: Array<[string, string, string]> = [
    ['Single-Core', fmtInt(cpu.singleScore), 'Score'],
    ['Multi-Core', fmtInt(cpu.multiScore), 'Score'],
    ['Kerne getestet', String(cpu.workersUsed), 'Worker'],
  ];
  for (const workload of cpu.workloads.slice(0, 3)) {
    leftRows.push([workload.label, fmtNum(workload.singleValue / 1e6, 0), workload.unit]);
  }

  const rightRows: Array<[string, string, string]> = gpu
    ? gpu.tests.map((test) => [test.label, fmtNum(test.value / 1e6, 1), test.unit])
    : [['GPU-Test', 'nicht verfügbar', '']];

  const sectionTop = 694;
  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 14);
  ctx.fillText('CPU-DETAILS', 72, sectionTop);
  ctx.fillText('GPU-DETAILS', 640, sectionTop);

  const drawRows = (rows: Array<[string, string, string]>, x: number, rightEdge: number) => {
    rows.forEach((row, index) => {
      const y = sectionTop + 36 + index * 42;
      ctx.fillStyle = 'rgba(245,245,247,0.62)';
      ctx.font = font(400, 19);
      ctx.textAlign = 'left';
      ctx.fillText(row[0], x, y);

      ctx.textAlign = 'right';
      ctx.fillStyle = WHITE;
      ctx.font = font(550, 19);
      const unitWidth = row[2] ? 54 : 0;
      ctx.fillText(row[1], rightEdge - unitWidth, y);
      if (row[2]) {
        ctx.fillStyle = DIM;
        ctx.font = font(400, 15);
        ctx.fillText(row[2], rightEdge, y);
      }

      ctx.strokeStyle = HAIR;
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.lineTo(rightEdge, y + 14);
      ctx.stroke();
    });
  };

  drawRows(leftRows, 72, 576);
  drawRows(rightRows, 640, 1128);

  // efficiency
  const eff = run.efficiency;
  ctx.strokeStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(72, 980);
  ctx.lineTo(W - 72, 980);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = MUTED;
  ctx.font = font(600, 14);
  ctx.fillText('EFFIZIENZ & STABILITÄT', 72, 1024);

  const effItems = [
    { label: 'Stabilität unter Last', value: eff.stability === null ? '—' : `${fmtNum(eff.stability, 1)} %`, note: eff.stability === null ? 'nur im Full Test' : 'gemessen' },
    {
      label: 'Parallelskalierung',
      value: eff.parallelScaling === null ? '—' : `${fmtNum(eff.parallelScaling, 1)} %`,
      note: `${cpu.workersUsed} Worker`,
    },
    {
      label: 'Effizienz-Proxy',
      value: eff.proxy === null ? '—' : `${fmtNum(eff.proxy, 1)} %`,
      note: eff.proxy === null ? 'nicht berechenbar' : 'berechnet',
    },
  ];

  effItems.forEach((item, index) => {
    const x = 72 + index * 352;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(245,245,247,0.55)';
    ctx.font = font(400, 17);
    ctx.fillText(item.label, x, 1066);
    ctx.fillStyle = WHITE;
    ctx.font = font(600, 42);
    ctx.fillText(item.value, x, 1116);
    ctx.fillStyle = DIM;
    ctx.font = font(400, 15);
    ctx.fillText(item.note, x, 1144);
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = DIM;
  ctx.font = font(400, 15);
  ctx.fillText('Leistungsaufnahme in Watt: nicht verfügbar — Browser liefern keine Energiemessung.', 72, 1190);

  // footer
  ctx.strokeStyle = HAIR;
  ctx.beginPath();
  ctx.moveTo(72, 1240);
  ctx.lineTo(W - 72, 1240);
  ctx.stroke();

  ctx.fillStyle = 'rgba(245,245,247,0.55)';
  ctx.font = font(400, 17);
  ctx.fillText(`Suite ${SUITE.version} · CPU ${SUITE.cpuVersion} · GPU ${SUITE.gpuVersion}`, 72, 1284);
  ctx.fillText(
    new Date(run.createdAt).toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    72,
    1312,
  );

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(245,245,247,0.55)';
  ctx.fillText(`Messdauer ${fmtDuration(run.durationMs)}`, W - 72, 1284);
  ctx.fillStyle = DIM;
  ctx.fillText('Lokal im Browser gemessen · keine Uploads', W - 72, 1312);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.font = font(600, 92);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '10px';
  ctx.fillText('BENCH', 72, 1440);
  if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';

  return canvas;
}

export function cardBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Grafik konnte nicht erzeugt werden'));
    }, 'image/png');
  });
}

export function cardFilename(run: RunResult): string {
  return `bench-${run.mode}-${run.overall ?? 'cpu'}.png`;
}

export function summaryText(run: RunResult): string {
  const lines = [
    'BENCH — Device Performance Benchmark',
    `${run.device.model || run.device.label} · ${run.device.platform ?? 'Plattform unbekannt'} · ${run.device.browser}`,
    `CPU ${fmtInt(run.cpu.score)} · GPU ${run.gpu ? fmtInt(run.gpu.score) : 'nicht verfügbar'} · Overall ${run.overall ? fmtInt(run.overall) : 'nicht verfügbar'}`,
    `Single-Core ${fmtInt(run.cpu.singleScore)} · Multi-Core ${fmtInt(run.cpu.multiScore)} (${run.cpu.workersUsed} Worker)`,
    `Modus: ${run.mode === 'quick' ? 'Quick Test' : 'Full Test'} · Suite ${SUITE.version} (${SUITE.cpuVersion}/${SUITE.gpuVersion})`,
    'Lokal im Browser gemessen — bench.naerdev.ch',
  ];
  return lines.join('\n');
}

export type ShareOutcome =
  | { status: 'shared' | 'cancelled' | 'downloaded' | 'unsupported'; message: string };

export async function shareRun(run: RunResult): Promise<ShareOutcome> {
  const canvas = renderShareCard(run);
  let blob: Blob;
  try {
    blob = await cardBlob(canvas);
  } catch {
    return { status: 'unsupported', message: 'Grafik konnte nicht erzeugt werden.' };
  }

  const file = new File([blob], cardFilename(run), { type: 'image/png' });
  const text = summaryText(run);
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
    share?: (data: ShareData) => Promise<void>;
  };

  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: 'BENCH Ergebnis',
        text: `${text}\n\nMesswerte: ${fmtInt(run.cpu.score)} CPU · ${run.overall ? fmtInt(run.overall) : '—'} Overall`,
      });
      return { status: 'shared', message: 'Ergebnis geteilt.' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'cancelled', message: 'Teilen abgebrochen.' };
      }
      // Fall through to the file download.
    }
  }

  if (nav.share && !nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ title: 'BENCH Ergebnis', text });
      return { status: 'shared', message: 'Text geteilt — die Grafik wurde zusätzlich gespeichert.' };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { status: 'cancelled', message: 'Teilen abgebrochen.' };
      }
    }
  }

  download(blob, cardFilename(run));
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard is optional */
  }
  return {
    status: 'downloaded',
    message: 'Grafik gespeichert — Zusammenfassung in die Zwischenablage kopiert.',
  };
}

export function downloadCard(run: RunResult): Promise<void> {
  return cardBlob(renderShareCard(run)).then((blob) => download(blob, cardFilename(run)));
}
