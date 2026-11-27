import { describe, expect, it } from 'vitest';
import {
  computeAspectRatio,
  computeRefreshRateFromTimestamps,
  detectSoftwareRasterizer,
  formatDeviceReportMarkdown,
  formatUtcOffset,
  parseUaAndHints,
  type DeviceDiagnosticReport,
} from './logic';

describe('device-info logic', () => {
  it('reduces common and ultrawide display aspect ratios cleanly', () => {
    expect(computeAspectRatio(1920, 1080)).toBe('16:9');
    expect(computeAspectRatio(2560, 1600)).toBe('8:5');
    expect(computeAspectRatio(3440, 1440)).toBe('43:18');
    expect(computeAspectRatio(0, 1080)).toBe('—');
  });

  it('formats positive, negative, and half-hour UTC offsets accurately', () => {
    // getTimezoneOffset() returns -480 for UTC+08:00, +300 for UTC-05:00, -330 for UTC+05:30
    expect(formatUtcOffset(-480)).toBe('UTC+08:00');
    expect(formatUtcOffset(300)).toBe('UTC-05:00');
    expect(formatUtcOffset(-330)).toBe('UTC+05:30');
    expect(formatUtcOffset(0)).toBe('UTC+00:00');
  });

  it('parses Windows 11 + Edge high-entropy hints and Linux ARM64 Firefox User-Agents', () => {
    const winEdge = parseUaAndHints(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0',
      'Win32',
      {
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        bitness: '64',
        fullVersionList: [
          { brand: 'Not.A/Brand', version: '24.0.0.0' },
          { brand: 'Chromium', version: '158.0.7200.12' },
          { brand: 'Microsoft Edge', version: '158.0.3100.5' },
        ],
      }
    );
    expect(winEdge.osName).toBe('Windows');
    expect(winEdge.osVersion).toBe('11');
    expect(winEdge.arch).toBe('x86_64');
    expect(winEdge.bitness).toBe('64');
    expect(winEdge.browserName).toBe('Edge');
    expect(winEdge.browserVersion).toBe('158.0.3100.5');
    expect(winEdge.engineName).toBe('Blink');

    const linuxFf = parseUaAndHints(
      'Mozilla/5.0 (X11; Linux aarch64; rv:138.0) Gecko/20100101 Firefox/138.0',
      'Linux aarch64',
      null
    );
    expect(linuxFf.osName).toBe('Linux');
    expect(linuxFf.arch).toBe('arm64');
    expect(linuxFf.browserName).toBe('Firefox');
    expect(linuxFf.engineName).toBe('Gecko');
  });

  it('computes trimmed refresh rate from rAF frame timestamps and rejects single-frame spikes', () => {
    // 20 frames at 120 Hz (8.333ms) with one 33ms GC hitch
    const stamps = [0];
    for (let i = 1; i <= 20; i += 1) {
      const prev = stamps[stamps.length - 1];
      stamps.push(prev + (i === 9 ? 33.3 : 1000 / 120));
    }
    const sample = computeRefreshRateFromTimestamps(stamps);
    expect(sample).not.toBeNull();
    expect(sample!.hz).toBeCloseTo(120, 0);
  });

  it('flags software WebGL rasterizers and formats Markdown diagnostic reports', () => {
    expect(detectSoftwareRasterizer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))')).toBe(
      true
    );
    expect(detectSoftwareRasterizer('ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)')).toBe(
      false
    );

    const sampleReport: DeviceDiagnosticReport = {
      capturedAtIso: '2026-11-27T01:00:00.000Z',
      summary: {
        osName: 'Linux',
        osVersion: '',
        arch: 'arm64',
        bitness: '64',
        browserName: 'Chrome',
        browserVersion: '157.0.0.0',
        engineName: 'Blink',
        deviceModel: '',
        isMobile: false,
      },
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64)',
      display: {
        screenCss: '1920 × 1080',
        physicalPixels: '3840 × 2160',
        aspectRatio: '16:9',
        availCss: '1920 × 1040',
        viewportCss: '1520 × 900',
        dpr: 2,
        effectiveDpi: 192,
        refreshHz: 60,
        frameMs: 16.67,
        colorDepthBits: 24,
        colorGamut: 'p3',
        hdr: false,
        orientation: 'landscape-primary',
        isExtended: false,
      },
      system: {
        hardwareConcurrency: 8,
        deviceMemoryGb: 8,
        isSecureContext: true,
        crossOriginIsolated: false,
        cookiesEnabled: true,
        pdfViewerEnabled: true,
        webdriver: false,
      },
      gpu: {
        available: true,
        webglVersion: 'WebGL 2.0',
        vendor: 'Mesa',
        renderer: 'Panfrost Mali-G610',
        unmasked: true,
        isSoftwareRasterizer: false,
        shadingLanguage: 'WebGL GLSL ES 3.00',
        maxTextureSize: 16384,
        maxViewport: '16384 × 16384',
        maxSamples: 4,
        webgpuStatus: 'adapter',
        webgpuSummary: 'Supported',
      },
      codecs: [
        {
          id: 'av1',
          label: 'AV1',
          mime: 'video/mp4; codecs="av01.0.08M.08"',
          tier: 'hardware',
          canPlay: 'probably',
          smooth: true,
          powerEfficient: true,
        },
      ],
      environment: {
        timezone: 'Asia/Shanghai',
        utcOffset: 'UTC+08:00',
        languages: ['zh-CN', 'en-US'],
        colorScheme: 'dark',
        reducedMotion: false,
        highContrast: false,
        pointer: 'fine',
        hover: true,
        maxTouchPoints: 0,
        online: true,
        connectionSummary: null,
        storageUsedBytes: 1024,
        storageQuotaBytes: 1048576,
        batterySummary: null,
      },
    };

    const md = formatDeviceReportMarkdown(sampleReport);
    expect(md).toContain('Linux (arm64 · 64-bit)');
    expect(md).toContain('3840 × 2160 physical');
    expect(md).toContain('Panfrost Mali-G610');
    expect(md).toContain('| AV1 |');
  });
});
