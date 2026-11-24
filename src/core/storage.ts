/** Local persistence: theme + benchmark history. No network, no identifiers. */

import type { RunResult } from './suite';

const RUNS_KEY = 'bench.runs.v1';
const THEME_KEY = 'bench.theme';
const MAX_RUNS = 30;

export type ThemeMode = 'auto' | 'light' | 'dark';

export function getThemeMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch {
    /* storage may be blocked */
  }
  return 'auto';
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* ignore */
  }
  applyTheme(mode);
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(mode: ThemeMode): void {
  const resolved = resolveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
}

export function loadRuns(): RunResult[] {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRunResult).sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

function isRunResult(value: unknown): value is RunResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<RunResult>;
  return typeof r.id === 'string' && typeof r.createdAt === 'number' && typeof r.mode === 'string' && !!r.device && !!r.cpu;
}

export function saveRun(run: RunResult): void {
  try {
    const existing = loadRuns().filter((r) => r.id !== run.id);
    const next = [run, ...existing].slice(0, MAX_RUNS);
    localStorage.setItem(RUNS_KEY, JSON.stringify(next));
  } catch {
    /* Quota exceeded: keep the run in memory only. */
  }
}

export function getRun(id: string): RunResult | null {
  return loadRuns().find((r) => r.id === id) ?? null;
}

export function deleteRun(id: string): void {
  try {
    const next = loadRuns().filter((r) => r.id !== id);
    localStorage.setItem(RUNS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
