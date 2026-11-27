// Pure parsing, math, and report-serialization helpers for the local Device & Browser Inspector.
// Strictly 100% client-side with zero network calls.

export interface HighEntropyHintsInput {
  architecture?: string;
  bitness?: string;
  model?: string;
  platform?: string;
  platformVersion?: string;
  wow64?: boolean;
  mobile?: boolean;
  brands?: Array<{ brand: string; version: string }>;
  fullVersionList?: Array<{ brand: string; version: string }>;
}

export interface ParsedUaSummary {
  osName: string;
  osVersion: string;
  arch: string;
  bitness: string;
  browserName: string;
  browserVersion: string;
  engineName: string;
  deviceModel: string;
  isMobile: boolean;
}

export interface RefreshRateSample {
  hz: number;
  frameMs: number;
  sampleCount: number;
}

export type CodecSupportTier = 'hardware' | 'software' | 'unsupported';

export interface CodecProbeEntry {
  id: string;
  label: string;
  mime: string;
  tier: CodecSupportTier;
  canPlay: string;
  smooth: boolean | null;
  powerEfficient: boolean | null;
}

export interface GpuProbeSnapshot {
  available: boolean;
  webglVersion: 'WebGL 2.0' | 'WebGL 1.0' | 'none';
  vendor: string;
  renderer: string;
  unmasked: boolean;
  isSoftwareRasterizer: boolean;
  shadingLanguage: string;
  maxTextureSize: number | null;
  maxViewport: string;
  maxSamples: number | null;
  webgpuStatus: 'adapter' | 'no_adapter' | 'unsupported' | 'insecure_context';
  webgpuSummary: string;
}

export interface DeviceDiagnosticReport {
  capturedAtIso: string;
  summary: ParsedUaSummary;
  userAgent: string;
  display: {
    screenCss: string;
    physicalPixels: string;
    aspectRatio: string;
    availCss: string;
    viewportCss: string;
    dpr: number;
    effectiveDpi: number;
    refreshHz: number | null;
    frameMs: number | null;
    colorDepthBits: number;
    colorGamut: 'rec2020' | 'p3' | 'srgb' | 'unknown';
    hdr: boolean;
    orientation: string;
    isExtended: boolean | null;
  };
  system: {
    hardwareConcurrency: number | null;
    deviceMemoryGb: number | null;
    isSecureContext: boolean;
    crossOriginIsolated: boolean;
    cookiesEnabled: boolean;
    pdfViewerEnabled: boolean | null;
    webdriver: boolean;
  };
  gpu: GpuProbeSnapshot;
  codecs: CodecProbeEntry[];
  environment: {
    timezone: string;
    utcOffset: string;
    languages: string[];
    colorScheme: 'dark' | 'light';
    reducedMotion: boolean;
    highContrast: boolean;
    pointer: 'fine' | 'coarse' | 'none';
    hover: boolean;
    maxTouchPoints: number;
    online: boolean;
    connectionSummary: string | null;
    storageUsedBytes: number | null;
    storageQuotaBytes: number | null;
    batterySummary: string | null;
  };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y !== 0) {
    const rem = x % y;
    x = y;
    y = rem;
  }
  return x || 1;
}

/**
 * Computes reduced integer aspect ratio (e.g. `1920x1080 -> "16:9"`, `3440x1440 -> "43:18"`).
 */
export function computeAspectRatio(width: number, height: number): string {
  if (width <= 0 || height <= 0) return '—';
  const d = gcd(width, height);
  return `${Math.round(width / d)}:${Math.round(height / d)}`;
}

/**
 * Formats a `Date.getTimezoneOffset()` value (minutes west of UTC) into `UTC+HH:MM` / `UTC-HH:MM`.
 */
export function formatUtcOffset(timezoneOffsetMinutes: number): string {
  const totalMinutesEast = -timezoneOffsetMinutes;
  const sign = totalMinutesEast >= 0 ? '+' : '-';
  const abs = Math.abs(totalMinutesEast);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/**
 * Computes refresh rate (Hz) from consecutive `requestAnimationFrame` high-resolution timestamps,
 * trimming outliers caused by single dropped frames.
 */
export function computeRefreshRateFromTimestamps(
  timestampsMs: readonly number[]
): RefreshRateSample | null {
  if (timestampsMs.length < 6) return null;
  const deltas: number[] = [];
  for (let i = 1; i < timestampsMs.length; i += 1) {
    const dt = timestampsMs[i] - timestampsMs[i - 1];
    if (dt > 1.5 && dt < 120) {
      deltas.push(dt);
    }
  }
  if (deltas.length < 4) return null;

  deltas.sort((a, b) => a - b);
  const trim = Math.floor(deltas.length * 0.15);
  const core = deltas.length - trim * 2 >= 3 ? deltas.slice(trim, deltas.length - trim) : deltas;
  const meanMs = core.reduce((acc, v) => acc + v, 0) / core.length;
  if (meanMs <= 0) return null;

  const rawHz = 1000 / meanMs;
  return {
    hz: Math.round(rawHz * 10) / 10,
    frameMs: Math.round(meanMs * 100) / 100,
    sampleCount: deltas.length,
  };
}

function isNoiseBrand(brand: string): boolean {
  const lower = brand.toLowerCase();
  return lower.includes('not') && lower.includes('brand');
}

/**
 * Parses User-Agent + optional Chromium High-Entropy Client Hints into structured OS, CPU arch, and browser fields.
 */
export function parseUaAndHints(
  ua: string,
  legacyPlatform = '',
  hints?: HighEntropyHintsInput | null
): ParsedUaSummary {
  let osName = 'Unknown OS';
  let osVersion = '';

  const hintPlatform = hints?.platform?.trim() || '';
  const hintPlatformVer = hints?.platformVersion?.trim() || '';

  if (hintPlatform === 'Windows' || /Windows NT/i.test(ua)) {
    osName = 'Windows';
    if (hintPlatformVer) {
      const major = Number.parseInt(hintPlatformVer.split('.')[0] ?? '0', 10);
      if (major >= 13) osVersion = '11';
      else if (major >= 1) osVersion = '10';
    } else {
      const m = ua.match(/Windows NT (\d+\.\d+)/i);
      if (m?.[1] === '10.0') osVersion = '10 / 11';
      else if (m?.[1]) osVersion = m[1];
    }
  } else if (hintPlatform === 'macOS' || /Mac OS X/i.test(ua)) {
    if (/iPhone|iPad|iPod/i.test(ua)) {
      osName = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
      const m = ua.match(/OS (\d+[._]\d+(?:[._]\d+)?)/i);
      osVersion = m?.[1]?.replace(/_/g, '.') ?? '';
    } else {
      osName = 'macOS';
      if (hintPlatformVer) {
        osVersion = hintPlatformVer;
      } else {
        const m = ua.match(/Mac OS X (\d+[._]\d+(?:[._]\d+)?)/i);
        osVersion = m?.[1]?.replace(/_/g, '.') ?? '';
      }
    }
  } else if (hintPlatform === 'Android' || /Android/i.test(ua)) {
    osName = 'Android';
    osVersion = hintPlatformVer || ua.match(/Android (\d+(?:\.\d+)*)/i)?.[1] || '';
  } else if (hintPlatform === 'Chrome OS' || /CrOS/i.test(ua)) {
    osName = 'ChromeOS';
    osVersion = hintPlatformVer;
  } else if (/iPhone|iPad|iPod/i.test(ua)) {
    osName = /iPad/i.test(ua) ? 'iPadOS' : 'iOS';
    osVersion = ua.match(/OS (\d+[._]\d+(?:[._]\d+)?)/i)?.[1]?.replace(/_/g, '.') ?? '';
  } else if (hintPlatform === 'Linux' || /Linux/i.test(ua)) {
    osName = 'Linux';
    osVersion = hintPlatformVer && hintPlatformVer !== '0.0.0' ? hintPlatformVer : '';
  } else if (/FreeBSD|OpenBSD|NetBSD/i.test(ua)) {
    osName = ua.match(/(FreeBSD|OpenBSD|NetBSD)/i)?.[1] ?? 'BSD';
  }

  // Architecture & bitness
  let arch = hints?.architecture?.trim() || '';
  let bitness = hints?.bitness?.trim() || '';
  const combinedArchSource = `${ua} ${legacyPlatform}`;

  if (!arch) {
    if (/aarch64|arm64|armv8/i.test(combinedArchSource)) {
      arch = 'arm64';
      bitness = bitness || '64';
    } else if (/x86_64|Win64|x64|amd64/i.test(combinedArchSource)) {
      arch = 'x86_64';
      bitness = bitness || '64';
    } else if (/armv7|arm/i.test(combinedArchSource)) {
      arch = 'arm';
      bitness = bitness || '32';
    } else if (/i686|i386|WOW64/i.test(combinedArchSource)) {
      arch = 'x86';
      bitness = bitness || '32';
    }
  } else if (arch === 'x86' && bitness === '64') {
    arch = 'x86_64';
  } else if (arch === 'arm' && bitness === '64') {
    arch = 'arm64';
  }

  // Browser & rendering engine
  let browserName = 'Unknown Browser';
  let browserVersion = '';
  const brandList = hints?.fullVersionList?.length ? hints.fullVersionList : hints?.brands;

  if (brandList && brandList.length > 0) {
    const preferredOrder = [
      'Microsoft Edge',
      'Brave',
      'Vivaldi',
      'Opera',
      'Arc',
      'Google Chrome',
      'Chromium',
    ];
    let picked: { brand: string; version: string } | undefined;
    for (const p of preferredOrder) {
      picked = brandList.find((b) => b.brand.toLowerCase() === p.toLowerCase());
      if (picked) break;
    }
    if (!picked) {
      picked = brandList.find((b) => !isNoiseBrand(b.brand) && b.brand !== 'Chromium');
    }
    if (!picked) {
      picked = brandList.find((b) => !isNoiseBrand(b.brand));
    }
    if (picked) {
      browserName = picked.brand.replace(/^Google /, '').replace(/^Microsoft /, '');
      browserVersion = picked.version;
    }
  }

  if (browserName === 'Unknown Browser') {
    const rules: Array<[string, RegExp]> = [
      ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
      ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
      ['Vivaldi', /Vivaldi\/([\d.]+)/],
      ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
      ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
      ['Safari', /Version\/([\d.]+).*Safari\//],
    ];
    for (const [label, re] of rules) {
      const m = ua.match(re);
      if (m) {
        browserName = label;
        browserVersion = m[1] ?? '';
        break;
      }
    }
  }

  let engineName = 'Unknown';
  if (/Gecko\/\d+/i.test(ua) && /Firefox\//i.test(ua)) {
    engineName = 'Gecko';
  } else if (/AppleWebKit\//i.test(ua) && /(?:Chrome|Chromium|Edg|OPR)\//i.test(ua)) {
    engineName = 'Blink';
  } else if (/AppleWebKit\//i.test(ua)) {
    engineName = 'WebKit';
  }

  const deviceModel = hints?.model?.trim() || '';
  const isMobile =
    typeof hints?.mobile === 'boolean'
      ? hints.mobile
      : /Mobile|Android|iPhone|iPod/i.test(ua);

  return {
    osName,
    osVersion,
    arch,
    bitness,
    browserName,
    browserVersion,
    engineName,
    deviceModel,
    isMobile,
  };
}

export function detectSoftwareRasterizer(renderer: string): boolean {
  return /SwiftShader|llvmpipe|softpipe|Software Rasterizer|Microsoft Basic Render/i.test(renderer);
}

export function formatDeviceReportJson(report: DeviceDiagnosticReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatDeviceReportMarkdown(report: DeviceDiagnosticReport): string {
  const osLine = [report.summary.osName, report.summary.osVersion].filter(Boolean).join(' ');
  const archLine = [
    report.summary.arch,
    report.summary.bitness ? `${report.summary.bitness}-bit` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const browserLine = [
    report.summary.browserName,
    report.summary.browserVersion,
    report.summary.engineName ? `(${report.summary.engineName})` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const hzText =
    report.display.refreshHz !== null
      ? `${report.display.refreshHz} Hz (${report.display.frameMs} ms)`
      : 'Not measured';

  const codecRows = report.codecs
    .map((c) => `| ${c.label} | \`${c.mime}\` | ${c.tier} |`)
    .join('\n');

  return [
    `## Client Device Diagnostic Report (${report.capturedAtIso})`,
    '',
    `- **OS & Arch**: ${osLine}${archLine ? ` (${archLine})` : ''}`,
    `- **Browser**: ${browserLine}`,
    `- **Display**: ${report.display.physicalPixels} physical (${report.display.screenCss} CSS @ ${report.display.dpr}x, ${report.display.aspectRatio})`,
    `- **Viewport & Refresh**: ${report.display.viewportCss} CSS · ${hzText} · ${report.display.colorDepthBits}-bit · ${report.display.colorGamut.toUpperCase()}${report.display.hdr ? ' · HDR' : ''}`,
    `- **CPU & Memory**: ${report.system.hardwareConcurrency ?? 'Hidden'} threads · ${report.system.deviceMemoryGb !== null ? `~${report.system.deviceMemoryGb} GiB` : 'Hidden'} · SecureContext=${report.system.isSecureContext}`,
    `- **GPU**: ${report.gpu.available ? `${report.gpu.renderer} (${report.gpu.webglVersion})` : 'Unavailable'} · WebGPU=${report.gpu.webgpuSummary}`,
    `- **Locale & Input**: ${report.environment.timezone} (${report.environment.utcOffset}) · [${report.environment.languages.join(', ')}] · pointer=${report.environment.pointer} · touch=${report.environment.maxTouchPoints}`,
    '',
    '| Media Codec | MIME | Support |',
    '|---|---|---|',
    codecRows,
    '',
  ].join('\n');
}
