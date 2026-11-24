/**
 * Device detection.
 *
 * Every field is optional: browsers expose different amounts of hardware
 * information. Missing values stay null and are rendered as "nicht verfügbar"
 * instead of being guessed.
 */

export interface DeviceInfo {
  /** Model name where the browser exposes it (UA Client Hints on Android). */
  model: string | null;
  /** Human readable device class derived strictly from the platform. */
  label: string;
  platform: string | null;
  platformVersion: string | null;
  architecture: string | null;
  bitness: string | null;
  cores: number | null;
  memoryGb: number | null;
  gpuVendor: string | null;
  gpuRenderer: string | null;
  browser: string;
  browserVersion: string | null;
  screenW: number;
  screenH: number;
  pixelRatio: number;
  webgpu: boolean | null;
  userAgent: string;
  language: string;
}

interface UABrand {
  brand: string;
  version: string;
}

interface UAData {
  brands?: UABrand[];
  fullVersionList?: UABrand[];
  mobile?: boolean;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string;
    bitness?: string;
    model?: string;
    platform?: string;
    platformVersion?: string;
    fullVersionList?: UABrand[];
  }>;
}

const PLATFORM_NAMES: Record<string, string> = {
  macOS: 'macOS',
  'iOS': 'iOS',
  iPadOS: 'iPadOS',
  Android: 'Android',
  Windows: 'Windows',
  Chrome: 'Chrome OS',
  Linux: 'Linux',
};

function detectBrowser(ua: string, data: UAData | null): { name: string; version: string | null } {
  const brands = data?.fullVersionList ?? data?.brands;
  if (brands?.length) {
    const notable = brands.find((b) => /Microsoft Edge/i.test(b.brand));
    if (notable) return { name: 'Microsoft Edge', version: notable.version };
    const opera = brands.find((b) => /Opera|OPR/i.test(b.brand));
    if (opera) return { name: 'Opera', version: opera.version };
    const chrome = brands.find((b) => /Google Chrome|Chromium/i.test(b.brand));
    if (chrome && !/Chromium/i.test(chrome.brand)) return { name: 'Chrome', version: chrome.version };
  }
  const rules: Array<[RegExp, string]> = [
    [/Edg\/(\d+(?:\.\d+)?)/, 'Microsoft Edge'],
    [/OPR\/(\d+(?:\.\d+)?)/, 'Opera'],
    [/SamsungBrowser\/(\d+(?:\.\d+)?)/, 'Samsung Internet'],
    [/Firefox\/(\d+(?:\.\d+)?)/, 'Firefox'],
    [/Chrome\/(\d+(?:\.\d+)?)/, 'Chrome'],
    [/Version\/(\d+(?:\.\d+)?).*Safari/, 'Safari'],
  ];
  for (const [re, name] of rules) {
    const m = ua.match(re);
    if (m) return { name, version: m[1] ?? null };
  }
  return { name: 'Unbekannter Browser', version: null };
}

/** Platform from UA Client Hints, falling back to user-agent parsing. */
function detectPlatform(ua: string, data: UAData | null): { platform: string | null; version: string | null } {
  const hinted = data?.platform;
  if (hinted) return { platform: PLATFORM_NAMES[hinted] ?? hinted, version: null };

  if (/iPhone|iPad|iPod/.test(ua)) {
    const isIpad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return { platform: isIpad ? 'iPadOS' : 'iOS', version: null };
  }
  if (/Android/.test(ua)) {
    const m = ua.match(/Android\s(\d+(?:\.\d+)?)/);
    return { platform: 'Android', version: m?.[1] ?? null };
  }
  if (/Mac OS X/.test(ua)) {
    const m = ua.match(/Mac OS X\s(\d+[._]\d+(?:[._]\d+)?)/);
    return { platform: 'macOS', version: m ? m[1].replace(/_/g, '.') : null };
  }
  if (/Windows/.test(ua)) {
    const m = ua.match(/Windows NT\s(\d+\.\d+)/);
    const map: Record<string, string> = { '10.0': '10 / 11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    return { platform: 'Windows', version: m ? (map[m[1]] ?? m[1]) : null };
  }
  if (/CrOS/.test(ua)) return { platform: 'Chrome OS', version: null };
  if (/Linux/.test(ua)) return { platform: 'Linux', version: null };
  return { platform: null, version: null };
}

function labelFor(platform: string | null, model: string | null, ua: string): string {
  if (model) return model;
  switch (platform) {
    case 'iOS':
      return 'iPhone';
    case 'iPadOS':
      return 'iPad';
    case 'macOS':
      return /Macintosh/.test(ua) ? 'Mac' : 'Apple-Gerät';
    case 'Windows':
      return 'Windows-PC';
    case 'Android':
      return 'Android-Gerät';
    case 'Chrome OS':
      return 'Chromebook';
    case 'Linux':
      return 'Linux-System';
    default:
      return 'Unbekanntes Gerät';
  }
}

function probeWebGl(): { vendor: string | null; renderer: string | null } {
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false }) as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return { vendor: null, renderer: null };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = debug ? (gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) as string | null) : null;
    const renderer = debug ? (gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) as string | null) : null;
    const info = gl.getExtension('WEBGL_lose_context');
    info?.loseContext();
    return { vendor: cleanGpu(vendor), renderer: cleanGpu(renderer) };
  } catch {
    return { vendor: null, renderer: null };
  }
}

/** Chrome reports ANGLE strings with a lot of driver noise — keep it readable. */
function cleanGpu(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'Google Inc. (Google)' || trimmed === 'WebKit WebGL') return null;
  return trimmed;
}

export async function detectDevice(): Promise<DeviceInfo> {
  const nav = navigator as unknown as { userAgentData?: UAData; deviceMemory?: number; hardwareConcurrency?: number };
  const data = nav.userAgentData ?? null;
  const ua = navigator.userAgent;

  let model: string | null = null;
  let architecture: string | null = null;
  let bitness: string | null = null;
  let hintedPlatform: string | null = null;
  let hintedVersion: string | null = null;
  let brands: UAData['brands'] | undefined;

  if (data?.getHighEntropyValues) {
    try {
      const values = await data.getHighEntropyValues([
        'model',
        'platform',
        'platformVersion',
        'architecture',
        'bitness',
        'fullVersionList',
      ]);
      model = values.model?.trim() || null;
      architecture = values.architecture?.trim() || null;
      bitness = values.bitness?.trim() || null;
      hintedPlatform = values.platform ?? null;
      hintedVersion = values.platformVersion ?? null;
      brands = values.fullVersionList ?? data.brands;
    } catch {
      /* Client Hints are optional and can be blocked. */
    }
  }

  const parsedPlatform = detectPlatform(ua, data);
  const platform = hintedPlatform ? (PLATFORM_NAMES[hintedPlatform] ?? hintedPlatform) : parsedPlatform.platform;
  const platformVersion = hintedVersion ?? parsedPlatform.version;
  const browser = detectBrowser(ua, data ? { ...data, brands, fullVersionList: brands } : null);
  const gpu = probeWebGl();

  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
  const memoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;

  let webgpu: boolean | null = null;
  if ('gpu' in navigator) {
    try {
      const adapter = await (navigator as unknown as { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter();
      webgpu = Boolean(adapter);
    } catch {
      webgpu = false;
    }
  }

  return {
    model,
    label: labelFor(platform, model, ua),
    platform,
    platformVersion,
    architecture,
    bitness,
    cores,
    memoryGb,
    gpuVendor: gpu.vendor,
    gpuRenderer: gpu.renderer,
    browser: browser.name,
    browserVersion: browser.version,
    screenW: window.screen?.width ?? window.innerWidth,
    screenH: window.screen?.height ?? window.innerHeight,
    pixelRatio: window.devicePixelRatio || 1,
    webgpu,
    userAgent: ua,
    language: navigator.language,
  };
}

export function osLabel(device: DeviceInfo): string {
  if (!device.platform) return 'Nicht verfügbar';
  return device.platformVersion ? `${device.platform} ${device.platformVersion}` : device.platform;
}

export function browserLabel(device: DeviceInfo): string {
  return device.browserVersion ? `${device.browser} ${device.browserVersion}` : device.browser;
}
