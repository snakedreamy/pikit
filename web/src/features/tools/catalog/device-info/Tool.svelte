<script lang="ts">
  import { onMount } from 'svelte';
  import { formatBytes, t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Button, CopyButton, Meter } from '../../../../ui';
  import {
    computeAspectRatio,
    computeRefreshRateFromTimestamps,
    detectSoftwareRasterizer,
    formatDeviceReportJson,
    formatDeviceReportMarkdown,
    formatUtcOffset,
    parseUaAndHints,
    type CodecProbeEntry,
    type DeviceDiagnosticReport,
    type GpuProbeSnapshot,
    type HighEntropyHintsInput,
    type ParsedUaSummary,
  } from './logic';

  const NS = 'tool:device-info';

  interface NavigatorUADataLike {
    brands?: Array<{ brand: string; version: string }>;
    mobile?: boolean;
    platform?: string;
    getHighEntropyValues?: (keys: string[]) => Promise<HighEntropyHintsInput>;
  }

  interface NetworkInfoLike {
    effectiveType?: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  }

  interface BatteryManagerLike {
    charging: boolean;
    level: number;
  }

  interface WebGpuAdapterInfoLike {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  }

  interface WebGpuAdapterLike {
    info?: WebGpuAdapterInfoLike;
    limits?: { maxBufferSize?: number };
  }

  interface ExtendedNavigator extends Omit<Navigator, 'gpu'> {
    userAgentData?: NavigatorUADataLike;
    deviceMemory?: number;
    connection?: NetworkInfoLike;
    getBattery?: () => Promise<BatteryManagerLike>;
    gpu?: {
      requestAdapter?: () => Promise<WebGpuAdapterLike | null>;
    };
  }

  interface ExtendedScreen extends Screen {
    isExtended?: boolean;
  }

  const CODEC_TARGETS: Array<{
    id: string;
    label: string;
    kind: 'video' | 'audio';
    mimes: string[];
  }> = [
    {
      id: 'h264',
      label: 'H.264 / AVC (High L4.1)',
      kind: 'video',
      mimes: ['video/mp4; codecs="avc1.640029"', 'video/mp4; codecs="avc1.42E01E"'],
    },
    {
      id: 'hevc',
      label: 'HEVC / H.265 (Main 10)',
      kind: 'video',
      mimes: ['video/mp4; codecs="hvc1.2.4.L120.B0"', 'video/mp4; codecs="hev1.1.6.L93.B0"'],
    },
    {
      id: 'av1',
      label: 'AV1 (Main Profile)',
      kind: 'video',
      mimes: ['video/mp4; codecs="av01.0.08M.08"', 'video/webm; codecs="av01.0.08M.08"'],
    },
    {
      id: 'vp9',
      label: 'VP9 (Profile 0)',
      kind: 'video',
      mimes: ['video/webm; codecs="vp09.00.41.08"', 'video/webm; codecs="vp9"'],
    },
    {
      id: 'opus',
      label: 'Opus Audio',
      kind: 'audio',
      mimes: ['audio/webm; codecs="opus"', 'audio/ogg; codecs="opus"'],
    },
    {
      id: 'flac',
      label: 'FLAC Lossless',
      kind: 'audio',
      mimes: ['audio/mp4; codecs="flac"', 'audio/ogg; codecs="flac"'],
    },
    {
      id: 'aac',
      label: 'AAC-LC Audio',
      kind: 'audio',
      mimes: ['audio/mp4; codecs="mp4a.40.2"'],
    },
    {
      id: 'vorbis',
      label: 'Vorbis Audio',
      kind: 'audio',
      mimes: ['audio/ogg; codecs="vorbis"'],
    },
  ];

  // Live reactive state
  let userAgent = $state(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  let legacyPlatform = $state(typeof navigator !== 'undefined' ? navigator.platform || '' : '');
  let hints = $state<HighEntropyHintsInput | null>(null);

  let screenW = $state(typeof screen !== 'undefined' ? screen.width : 0);
  let screenH = $state(typeof screen !== 'undefined' ? screen.height : 0);
  let availW = $state(typeof screen !== 'undefined' ? screen.availWidth : 0);
  let availH = $state(typeof screen !== 'undefined' ? screen.availHeight : 0);
  let viewportW = $state(typeof window !== 'undefined' ? window.innerWidth : 0);
  let viewportH = $state(typeof window !== 'undefined' ? window.innerHeight : 0);
  let dpr = $state(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  let colorDepth = $state(typeof screen !== 'undefined' ? screen.colorDepth || 24 : 24);
  let colorGamut = $state<'rec2020' | 'p3' | 'srgb' | 'unknown'>('srgb');
  let hdrCapable = $state(false);
  let orientationType = $state('landscape-primary');
  let isExtended = $state<boolean | null>(null);

  let measuringHz = $state(false);
  let refreshHz = $state<number | null>(null);
  let frameMs = $state<number | null>(null);

  let hardwareConcurrency = $state<number | null>(
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? navigator.hardwareConcurrency
      : null
  );
  let deviceMemoryGb = $state<number | null>(null);
  let isSecureCtx = $state(typeof window !== 'undefined' ? Boolean(window.isSecureContext) : false);
  let crossOriginIso = $state(
    typeof window !== 'undefined' ? Boolean(window.crossOriginIsolated) : false
  );
  let cookiesEnabled = $state(
    typeof navigator !== 'undefined' ? Boolean(navigator.cookieEnabled) : false
  );
  let pdfViewerEnabled = $state<boolean | null>(
    typeof navigator !== 'undefined' && typeof navigator.pdfViewerEnabled === 'boolean'
      ? navigator.pdfViewerEnabled
      : null
  );
  let webdriverFlag = $state(
    typeof navigator !== 'undefined' ? Boolean(navigator.webdriver) : false
  );

  let gpu = $state<GpuProbeSnapshot>({
    available: false,
    webglVersion: 'none',
    vendor: '',
    renderer: '',
    unmasked: false,
    isSoftwareRasterizer: false,
    shadingLanguage: '',
    maxTextureSize: null,
    maxViewport: '',
    maxSamples: null,
    webgpuStatus: 'unsupported',
    webgpuSummary: '',
  });

  let codecs = $state<CodecProbeEntry[]>([]);

  let timezone = $state(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  let utcOffset = $state(formatUtcOffset(new Date().getTimezoneOffset()));
  let languages = $state<string[]>(
    typeof navigator !== 'undefined' && navigator.languages?.length
      ? [...navigator.languages]
      : []
  );
  let prefersDark = $state(true);
  let reducedMotion = $state(false);
  let highContrast = $state(false);
  let pointerKind = $state<'fine' | 'coarse' | 'none'>('fine');
  let hoverCapable = $state(true);
  let maxTouchPoints = $state(
    typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0
  );
  let onlineState = $state(typeof navigator !== 'undefined' ? navigator.onLine : true);
  let connectionInfo = $state<{
    effectiveType: string;
    downlink?: number;
    rtt?: number;
    saveData?: boolean;
  } | null>(null);
  let storageUsed = $state<number | null>(null);
  let storageQuota = $state<number | null>(null);
  let batteryInfo = $state<{ charging: boolean; percent: number } | null>(null);
  let capturedAtIso = $state(new Date().toISOString());

  let rafCancelId = 0;

  function qMedia(query: string): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  }

  function syncViewportAndMedia() {
    if (typeof window === 'undefined') return;
    screenW = screen.width;
    screenH = screen.height;
    availW = screen.availWidth;
    availH = screen.availHeight;
    viewportW = window.innerWidth;
    viewportH = window.innerHeight;
    dpr = Math.round((window.devicePixelRatio || 1) * 100) / 100;
    colorDepth = screen.colorDepth || 24;
    orientationType = screen.orientation?.type || (viewportW >= viewportH ? 'landscape' : 'portrait');
    const extScreen = screen as ExtendedScreen;
    isExtended = typeof extScreen.isExtended === 'boolean' ? extScreen.isExtended : null;

    if (qMedia('(color-gamut: rec2020)')) colorGamut = 'rec2020';
    else if (qMedia('(color-gamut: p3)')) colorGamut = 'p3';
    else if (qMedia('(color-gamut: srgb)')) colorGamut = 'srgb';
    else colorGamut = 'unknown';

    hdrCapable = qMedia('(dynamic-range: high)');
    prefersDark = qMedia('(prefers-color-scheme: dark)');
    reducedMotion = qMedia('(prefers-reduced-motion: reduce)');
    highContrast = qMedia('(prefers-contrast: more)');

    if (qMedia('(any-pointer: fine)')) pointerKind = 'fine';
    else if (qMedia('(any-pointer: coarse)')) pointerKind = 'coarse';
    else pointerKind = 'none';

    hoverCapable = qMedia('(any-hover: hover)');
  }

  function probeWebGl(): Omit<GpuProbeSnapshot, 'webgpuStatus' | 'webgpuSummary'> {
    if (typeof document === 'undefined') {
      return {
        available: false,
        webglVersion: 'none',
        vendor: '',
        renderer: '',
        unmasked: false,
        isSoftwareRasterizer: false,
        shadingLanguage: '',
        maxTextureSize: null,
        maxViewport: '',
        maxSamples: null,
      };
    }

    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2', { powerPreference: 'high-performance' });
    const gl =
      gl2 ||
      canvas.getContext('webgl', { powerPreference: 'high-performance' }) ||
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null);

    if (!gl) {
      return {
        available: false,
        webglVersion: 'none',
        vendor: '',
        renderer: '',
        unmasked: false,
        isSoftwareRasterizer: false,
        shadingLanguage: '',
        maxTextureSize: null,
        maxViewport: '',
        maxSamples: null,
      };
    }

    try {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const unmaskedVendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '') : '';
      const unmaskedRenderer = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '')
        : '';
      const vendor = unmaskedVendor || String(gl.getParameter(gl.VENDOR) || '');
      const renderer = unmaskedRenderer || String(gl.getParameter(gl.RENDERER) || '');
      const shadingLanguage = String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION) || '');
      const maxTextureSize = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || null;
      const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | number[] | null;
      const maxViewport = vp && vp.length >= 2 ? `${vp[0]} × ${vp[1]}` : '';
      const maxSamples =
        gl2 && typeof gl2.MAX_SAMPLES === 'number'
          ? Number(gl2.getParameter(gl2.MAX_SAMPLES)) || null
          : null;

      return {
        available: true,
        webglVersion: gl2 ? 'WebGL 2.0' : 'WebGL 1.0',
        vendor,
        renderer,
        unmasked: Boolean(unmaskedRenderer),
        isSoftwareRasterizer: detectSoftwareRasterizer(renderer),
        shadingLanguage,
        maxTextureSize,
        maxViewport,
        maxSamples,
      };
    } finally {
      // Immediately release the GPU context so probing leaves zero lingering WebGL contexts
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }

  async function probeWebGpu(): Promise<{
    status: GpuProbeSnapshot['webgpuStatus'];
    summary: string;
  }> {
    if (typeof window === 'undefined' || !window.isSecureContext) {
      return { status: 'insecure_context', summary: 'Requires HTTPS / localhost' };
    }
    const nav = navigator as ExtendedNavigator;
    if (!nav.gpu || typeof nav.gpu.requestAdapter !== 'function') {
      return { status: 'unsupported', summary: 'Unsupported' };
    }
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (!adapter) {
        return { status: 'no_adapter', summary: 'No GPU adapter' };
      }
      const parts = [
        adapter.info?.vendor,
        adapter.info?.architecture,
        adapter.info?.description || adapter.info?.device,
      ].filter((p): p is string => Boolean(p && p.trim()));
      const maxBufMb = adapter.limits?.maxBufferSize
        ? `${Math.round(adapter.limits.maxBufferSize / (1024 * 1024))} MiB max buffer`
        : '';
      const detail = [...parts, maxBufMb].filter(Boolean).join(' · ') || 'WebGPU ready';
      return { status: 'adapter', summary: detail };
    } catch {
      return { status: 'no_adapter', summary: 'No GPU adapter' };
    }
  }

  async function probeCodecs(): Promise<CodecProbeEntry[]> {
    if (typeof document === 'undefined') return [];
    const videoEl = document.createElement('video');
    const audioEl = document.createElement('audio');
    const hasMc =
      typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo);

    const results = await Promise.all(
      CODEC_TARGETS.map(async (target): Promise<CodecProbeEntry> => {
        let chosenMime = target.mimes[0];
        let canPlay = '';
        for (const m of target.mimes) {
          const res = (target.kind === 'video' ? videoEl : audioEl).canPlayType(m);
          if (res === 'probably' || (res === 'maybe' && !canPlay)) {
            chosenMime = m;
            canPlay = res;
            if (res === 'probably') break;
          }
        }

        let smooth: boolean | null = null;
        let powerEfficient: boolean | null = null;
        let mcSupported = false;

        if (hasMc) {
          try {
            const info = await navigator.mediaCapabilities.decodingInfo(
              target.kind === 'video'
                ? {
                    type: 'file',
                    video: {
                      contentType: chosenMime,
                      width: 1920,
                      height: 1080,
                      bitrate: 12_000_000,
                      framerate: 60,
                    },
                  }
                : {
                    type: 'file',
                    audio: {
                      contentType: chosenMime,
                      channels: '2',
                      bitrate: 256_000,
                      samplerate: 48_000,
                    },
                  }
            );
            mcSupported = Boolean(info.supported);
            smooth = Boolean(info.smooth);
            powerEfficient = Boolean(info.powerEfficient);
          } catch {
            // Ignore engines that reject unknown MIME parameters
          }
        }

        const supported = mcSupported || canPlay === 'probably' || canPlay === 'maybe';
        const tier = !supported
          ? 'unsupported'
          : powerEfficient
            ? 'hardware'
            : 'software';

        return {
          id: target.id,
          label: target.label,
          mime: chosenMime,
          tier,
          canPlay: canPlay || 'none',
          smooth,
          powerEfficient,
        };
      })
    );

    return results;
  }

  function measureRefreshRate() {
    if (typeof window === 'undefined' || typeof requestAnimationFrame !== 'function') return;
    if (rafCancelId) cancelAnimationFrame(rafCancelId);

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      measuringHz = false;
      return;
    }

    measuringHz = true;
    const stamps: number[] = [];
    const targetFrames = 24;

    const step = (ts: number) => {
      stamps.push(ts);
      if (stamps.length < targetFrames) {
        rafCancelId = requestAnimationFrame(step);
        return;
      }
      measuringHz = false;
      rafCancelId = 0;
      const sample = computeRefreshRateFromTimestamps(stamps);
      if (sample) {
        refreshHz = sample.hz;
        frameMs = sample.frameMs;
      }
    };

    rafCancelId = requestAnimationFrame(step);
  }

  async function runFullProbe() {
    if (typeof window === 'undefined') return;
    capturedAtIso = new Date().toISOString();
    const nav = navigator as ExtendedNavigator;

    userAgent = nav.userAgent || '';
    legacyPlatform = nav.platform || '';
    hardwareConcurrency =
      typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null;
    deviceMemoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;
    isSecureCtx = Boolean(window.isSecureContext);
    crossOriginIso = Boolean(window.crossOriginIsolated);
    cookiesEnabled = Boolean(nav.cookieEnabled);
    pdfViewerEnabled = typeof nav.pdfViewerEnabled === 'boolean' ? nav.pdfViewerEnabled : null;
    webdriverFlag = Boolean(nav.webdriver);
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    utcOffset = formatUtcOffset(new Date().getTimezoneOffset());
    languages = nav.languages?.length ? [...nav.languages] : nav.language ? [nav.language] : [];
    maxTouchPoints = nav.maxTouchPoints || 0;
    onlineState = nav.onLine;

    if (nav.connection && nav.connection.effectiveType) {
      connectionInfo = {
        effectiveType: nav.connection.effectiveType,
        downlink: nav.connection.downlink,
        rtt: nav.connection.rtt,
        saveData: nav.connection.saveData,
      };
    } else {
      connectionInfo = null;
    }

    syncViewportAndMedia();
    measureRefreshRate();

    // WebGL sync probe + async WebGPU / Client Hints / Codecs / Storage / Battery in parallel
    const glSnapshot = probeWebGl();
    gpu = {
      ...glSnapshot,
      webgpuStatus: gpu.webgpuStatus,
      webgpuSummary: gpu.webgpuSummary,
    };

    const hintsPromise = (async () => {
      if (nav.userAgentData?.getHighEntropyValues) {
        try {
          const he = await nav.userAgentData.getHighEntropyValues([
            'architecture',
            'bitness',
            'model',
            'platform',
            'platformVersion',
            'fullVersionList',
            'wow64',
          ]);
          hints = {
            ...he,
            brands: nav.userAgentData.brands,
            mobile: nav.userAgentData.mobile,
          };
          return;
        } catch {
          // Fall back to low-entropy brands
        }
      }
      if (nav.userAgentData) {
        hints = {
          brands: nav.userAgentData.brands,
          mobile: nav.userAgentData.mobile,
          platform: nav.userAgentData.platform,
        };
      }
    })();

    const webgpuPromise = probeWebGpu().then((res) => {
      gpu = {
        ...glSnapshot,
        webgpuStatus: res.status,
        webgpuSummary: res.summary,
      };
    });

    const codecsPromise = probeCodecs().then((list) => {
      codecs = list;
    });

    const storagePromise = (async () => {
      if (window.isSecureContext && nav.storage?.estimate) {
        try {
          const est = await nav.storage.estimate();
          storageUsed = typeof est.usage === 'number' ? est.usage : null;
          storageQuota = typeof est.quota === 'number' ? est.quota : null;
        } catch {
          storageUsed = null;
          storageQuota = null;
        }
      }
    })();

    const batteryPromise = (async () => {
      if (typeof nav.getBattery === 'function') {
        try {
          const bat = await nav.getBattery();
          batteryInfo = {
            charging: Boolean(bat.charging),
            percent: Math.round((bat.level || 0) * 100),
          };
        } catch {
          batteryInfo = null;
        }
      }
    })();

    await Promise.all([
      hintsPromise,
      webgpuPromise,
      codecsPromise,
      storagePromise,
      batteryPromise,
    ]);
  }

  onMount(() => {
    void runFullProbe();
    const onResize = () => syncViewportAndMedia();
    const onOnline = () => (onlineState = navigator.onLine);
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOnline);
    return () => {
      if (rafCancelId) cancelAnimationFrame(rafCancelId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOnline);
    };
  });

  const parsedSummary = $derived<ParsedUaSummary>(
    parseUaAndHints(userAgent, legacyPlatform, hints)
  );

  const physicalW = $derived(Math.round(screenW * dpr));
  const physicalH = $derived(Math.round(screenH * dpr));
  const aspectRatio = $derived(computeAspectRatio(screenW, screenH));
  const effectiveDpi = $derived(Math.round(96 * dpr));

  const osHeadline = $derived(
    [parsedSummary.osName, parsedSummary.osVersion].filter(Boolean).join(' ')
  );
  const archSubline = $derived.by(() => {
    const parts = [
      parsedSummary.arch,
      parsedSummary.bitness ? `${parsedSummary.bitness}-bit` : '',
      parsedSummary.isMobile ? t('mobileTag', undefined, NS) : t('desktopTag', undefined, NS),
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : t('archHidden', undefined, NS);
  });

  const browserHeadline = $derived(
    [parsedSummary.browserName, parsedSummary.browserVersion.split('.')[0]]
      .filter(Boolean)
      .join(' ')
  );
  const browserSubline = $derived(
    [parsedSummary.browserVersion, parsedSummary.engineName].filter(Boolean).join(' · ')
  );

  const gamutText = $derived.by(() => {
    if (colorGamut === 'rec2020') return t('gamutRec2020', undefined, NS);
    if (colorGamut === 'p3') return t('gamutP3', undefined, NS);
    if (colorGamut === 'srgb') return t('gamutSrgb', undefined, NS);
    return t('gamutUnknown', undefined, NS);
  });

  const orientationDisplay = $derived.by(() => {
    const ext =
      isExtended === null
        ? t('multiUnexposed', undefined, NS)
        : isExtended
          ? t('multiExtended', undefined, NS)
          : t('multiSingle', undefined, NS);
    return `${orientationType} · ${ext}`;
  });

  const ramDisplay = $derived.by(() => {
    if (deviceMemoryGb !== null) {
      return deviceMemoryGb >= 8
        ? t('ramCapped8', undefined, NS)
        : t('ramApprox', { gb: deviceMemoryGb }, NS);
    }
    if (!isSecureCtx) return t('reasonHttpsRequired', undefined, NS);
    return t('reasonBrowserHidden', undefined, NS);
  });

  const cpuArchDisplay = $derived.by(() => {
    if (parsedSummary.arch) {
      return [
        parsedSummary.arch,
        parsedSummary.bitness ? `${parsedSummary.bitness}-bit` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    }
    return t('reasonBrowserHidden', undefined, NS);
  });

  const webgpuDisplay = $derived.by(() => {
    if (gpu.webgpuStatus === 'adapter') {
      return t('webgpuSupported', { detail: gpu.webgpuSummary }, NS);
    }
    if (gpu.webgpuStatus === 'insecure_context') {
      return t('reasonHttpsRequired', undefined, NS);
    }
    if (gpu.webgpuStatus === 'no_adapter') {
      return t('webgpuNoAdapter', undefined, NS);
    }
    return t('webgpuUnsupported', undefined, NS);
  });

  const connectionDisplay = $derived.by(() => {
    const status = onlineState ? t('onlineTag', undefined, NS) : t('offlineTag', undefined, NS);
    if (!connectionInfo) {
      return `${status} · ${t('reasonClientHintsOnly', undefined, NS)}`;
    }
    const parts = [status, connectionInfo.effectiveType.toUpperCase()];
    if (typeof connectionInfo.downlink === 'number' && connectionInfo.downlink > 0) {
      parts.push(`~${connectionInfo.downlink} Mbps`);
    }
    if (typeof connectionInfo.rtt === 'number' && connectionInfo.rtt > 0) {
      parts.push(`RTT ~${connectionInfo.rtt} ms`);
    }
    if (connectionInfo.saveData) {
      parts.push(t('dataSaverOn', undefined, NS));
    }
    return parts.join(' · ');
  });

  const batteryDisplay = $derived.by(() => {
    if (!batteryInfo) return t('reasonBrowserHidden', undefined, NS);
    return batteryInfo.charging
      ? t('batteryCharging', { pct: batteryInfo.percent }, NS)
      : t('batteryDischarging', { pct: batteryInfo.percent }, NS);
  });

  const storagePercent = $derived(
    storageUsed !== null && storageQuota && storageQuota > 0
      ? (storageUsed / storageQuota) * 100
      : 0
  );

  const reportSnapshot = $derived<DeviceDiagnosticReport>({
    capturedAtIso,
    summary: parsedSummary,
    userAgent,
    display: {
      screenCss: `${screenW} × ${screenH}`,
      physicalPixels: `${physicalW} × ${physicalH}`,
      aspectRatio,
      availCss: `${availW} × ${availH}`,
      viewportCss: `${viewportW} × ${viewportH}`,
      dpr,
      effectiveDpi,
      refreshHz,
      frameMs,
      colorDepthBits: colorDepth,
      colorGamut,
      hdr: hdrCapable,
      orientation: orientationType,
      isExtended,
    },
    system: {
      hardwareConcurrency,
      deviceMemoryGb,
      isSecureContext: isSecureCtx,
      crossOriginIsolated: crossOriginIso,
      cookiesEnabled,
      pdfViewerEnabled,
      webdriver: webdriverFlag,
    },
    gpu,
    codecs,
    environment: {
      timezone,
      utcOffset,
      languages,
      colorScheme: prefersDark ? 'dark' : 'light',
      reducedMotion,
      highContrast,
      pointer: pointerKind,
      hover: hoverCapable,
      maxTouchPoints,
      online: onlineState,
      connectionSummary: connectionInfo ? connectionDisplay : null,
      storageUsedBytes: storageUsed,
      storageQuotaBytes: storageQuota,
      batterySummary: batteryInfo ? `${batteryInfo.percent}%` : null,
    },
  });

  const reportMarkdown = $derived(formatDeviceReportMarkdown(reportSnapshot));
  const reportJson = $derived(formatDeviceReportJson(reportSnapshot));
</script>

<div class="di-bench" data-testid="device-info-bench">
  <!-- Top action bar -->
  <div class="di-toolbar">
    <div class="di-toolbar__left">
      <Badge tone="success" dot>{t('localBadge', undefined, NS)}</Badge>
      <Button
        variant="secondary"
        size="sm"
        icon="refresh-cw"
        loading={measuringHz}
        onclick={() => void runFullProbe()}
      >
        {measuringHz ? t('measuring', undefined, NS) : t('reprobe', undefined, NS)}
      </Button>
    </div>

    <div class="di-toolbar__right">
      <CopyButton text={reportMarkdown} label={t('copyMarkdown', undefined, NS)} />
      <CopyButton text={reportJson} label={t('copyJson', undefined, NS)} />
    </div>
  </div>

  <!-- 4 Primary KPI Cards -->
  <div class="di-kpi-grid">
    <div class="glass di-kpi">
      <span class="di-kpi__label">{t('kpiOs', undefined, NS)}</span>
      <strong class="di-kpi__val mono">{osHeadline}</strong>
      <span class="di-kpi__sub mono">{archSubline}</span>
    </div>

    <div class="glass di-kpi">
      <span class="di-kpi__label">{t('kpiBrowser', undefined, NS)}</span>
      <strong class="di-kpi__val mono">{browserHeadline}</strong>
      <span class="di-kpi__sub mono">{browserSubline}</span>
    </div>

    <div class="glass di-kpi">
      <span class="di-kpi__label">{t('kpiDisplay', undefined, NS)}</span>
      <strong class="di-kpi__val mono">{physicalW} × {physicalH}</strong>
      <span class="di-kpi__sub mono">{screenW} × {screenH} CSS @ {dpr}× · {aspectRatio}</span>
    </div>

    <div class="glass di-kpi">
      <span class="di-kpi__label">{t('kpiRefresh', undefined, NS)}</span>
      <strong class="di-kpi__val di-kpi__val--mint mono">
        {#if refreshHz !== null}
          {refreshHz} Hz
        {:else if measuringHz}
          {t('hzMeasuring', undefined, NS)}
        {:else}
          {t('hzBackgrounded', undefined, NS)}
        {/if}
      </strong>
      <span class="di-kpi__sub mono">
        {frameMs !== null ? `${frameMs} ms / frame` : `${colorDepth}-bit · ${gamutText}`}
      </span>
    </div>
  </div>

  <!-- Bay 1 & Bay 2 side-by-side -->
  <div class="di-bays">
    <section class="di-bay">
      <h3 class="di-bay__title">{t('secDisplay', undefined, NS)}</h3>
      <div class="glass di-list">
        <div class="di-row">
          <span class="di-row__key">{t('lblScreenCss', undefined, NS)}</span>
          <span class="di-row__val mono">{screenW} × {screenH} px ({aspectRatio})</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblPhysicalPx', undefined, NS)}</span>
          <span class="di-row__val mono">{physicalW} × {physicalH} px</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblAvailCss', undefined, NS)}</span>
          <span class="di-row__val mono">{availW} × {availH} px</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblViewportCss', undefined, NS)}</span>
          <span class="di-row__val di-row__val--mint mono">{viewportW} × {viewportH} px</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblDpr', undefined, NS)}</span>
          <span class="di-row__val mono">{dpr}× (~{effectiveDpi} DPI)</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblFramePacing', undefined, NS)}</span>
          <span class="di-row__val mono">
            {refreshHz !== null ? `${refreshHz} Hz (${frameMs} ms)` : t('hzMeasuring', undefined, NS)}
          </span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblColorDepth', undefined, NS)}</span>
          <span class="di-row__val mono">{colorDepth}-bit ({Math.floor(colorDepth / 3)} bpc)</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblColorGamut', undefined, NS)}</span>
          <span class="di-row__val mono">{gamutText}</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblHdr', undefined, NS)}</span>
          <span class="di-row__val mono">
            {hdrCapable ? t('hdrHigh', undefined, NS) : t('hdrSdr', undefined, NS)}
          </span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblOrientation', undefined, NS)}</span>
          <span class="di-row__val mono">{orientationDisplay}</span>
        </div>
      </div>
    </section>

    <section class="di-bay">
      <h3 class="di-bay__title">{t('secSystem', undefined, NS)}</h3>
      <div class="glass di-list">
        <div class="di-row">
          <span class="di-row__key">{t('lblOsDetail', undefined, NS)}</span>
          <span class="di-row__val mono">
            {[osHeadline, parsedSummary.deviceModel].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblCpuArch', undefined, NS)}</span>
          <span class="di-row__val mono">{cpuArchDisplay}</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblCpuThreads', undefined, NS)}</span>
          <span class="di-row__val mono">
            {hardwareConcurrency !== null
              ? t('threadsUnit', { count: hardwareConcurrency }, NS)
              : t('reasonBrowserHidden', undefined, NS)}
          </span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblDeviceRam', undefined, NS)}</span>
          <span class="di-row__val mono">{ramDisplay}</span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblSecureCtx', undefined, NS)}</span>
          <span class="di-row__val mono">
            <Badge tone={isSecureCtx ? 'success' : 'warning'} dot>
              {isSecureCtx
                ? t('secureActive', undefined, NS)
                : t('securePlainHttp', undefined, NS)}
            </Badge>
          </span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblCrossOrigin', undefined, NS)}</span>
          <span class="di-row__val mono">
            {crossOriginIso
              ? t('coiIsolated', undefined, NS)
              : t('coiStandard', undefined, NS)}
          </span>
        </div>
        <div class="di-row">
          <span class="di-row__key">{t('lblCapabilities', undefined, NS)}</span>
          <span class="di-row__val mono">
            {t(
              'capSummary',
              {
                cookies: cookiesEnabled ? t('yes', undefined, NS) : t('no', undefined, NS),
                pdf:
                  pdfViewerEnabled === null
                    ? t('unreported', undefined, NS)
                    : pdfViewerEnabled
                      ? t('yes', undefined, NS)
                      : t('no', undefined, NS),
                webdriver: webdriverFlag ? t('yes', undefined, NS) : t('no', undefined, NS),
              },
              NS
            )}
          </span>
        </div>
      </div>

      <div class="glass di-ua-box">
        <div class="di-ua-box__head">
          <span class="di-row__key">{t('lblUserAgent', undefined, NS)}</span>
          <CopyButton text={userAgent} />
        </div>
        <code class="di-ua-box__code mono">{userAgent}</code>
      </div>
    </section>
  </div>

  <!-- Bay 3: GPU & Graphics -->
  <section class="di-bay">
    <h3 class="di-bay__title">{t('secGpu', undefined, NS)}</h3>
    {#if gpu.isSoftwareRasterizer}
      <div class="glass di-soft-note" role="status">
        <Badge tone="warning" dot>SW</Badge>
        <span>{t('softwareWarn', undefined, NS)}</span>
      </div>
    {/if}

    <div class="glass di-list di-list--2col">
      <div class="di-row">
        <span class="di-row__key">{t('lblGpuRenderer', undefined, NS)}</span>
        <span class="di-row__val mono">
          {gpu.available ? gpu.renderer : t('webglUnavailable', undefined, NS)}
        </span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblGpuVendor', undefined, NS)}</span>
        <span class="di-row__val mono">
          {gpu.available ? gpu.vendor : t('webglUnavailable', undefined, NS)}
        </span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblWebglVer', undefined, NS)}</span>
        <span class="di-row__val mono">
          {gpu.available
            ? [gpu.webglVersion, gpu.shadingLanguage].filter(Boolean).join(' · ')
            : t('webglUnavailable', undefined, NS)}
        </span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblWebglLimits', undefined, NS)}</span>
        <span class="di-row__val mono">
          {gpu.available
            ? [
                gpu.maxTextureSize ? `${gpu.maxTextureSize} px` : '',
                gpu.maxViewport,
                gpu.maxSamples ? `${gpu.maxSamples}× MSAA` : '',
              ]
                .filter(Boolean)
                .join(' · ')
            : t('webglUnavailable', undefined, NS)}
        </span>
      </div>
      <div class="di-row di-row--full">
        <span class="di-row__key">{t('lblWebgpu', undefined, NS)}</span>
        <span class="di-row__val mono">{webgpuDisplay}</span>
      </div>
    </div>
  </section>

  <!-- Bay 4: Media & Hardware Codec Matrix -->
  <section class="di-bay">
    <h3 class="di-bay__title">{t('secCodecs', undefined, NS)}</h3>
    <div class="di-codec-grid">
      {#each codecs as c (c.id)}
        <div class="glass di-codec-card">
          <div class="di-codec-card__top">
            <strong class="di-codec-card__name">{c.label}</strong>
            <Badge
              tone={c.tier === 'hardware' ? 'success' : c.tier === 'software' ? 'info' : 'neutral'}
              dot={c.tier !== 'unsupported'}
            >
              {c.tier === 'hardware'
                ? t('tierHardware', undefined, NS)
                : c.tier === 'software'
                  ? t('tierSoftware', undefined, NS)
                  : t('tierUnsupported', undefined, NS)}
            </Badge>
          </div>
          <code class="di-codec-card__mime mono">{c.mime}</code>
        </div>
      {/each}
    </div>
  </section>

  <!-- Bay 5: Locale, Peripherals, Storage Quota & Power -->
  <section class="di-bay">
    <h3 class="di-bay__title">{t('secEnv', undefined, NS)}</h3>
    <div class="glass di-list di-list--2col">
      <div class="di-row">
        <span class="di-row__key">{t('lblTimezone', undefined, NS)}</span>
        <span class="di-row__val mono">{timezone} ({utcOffset})</span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblLanguages', undefined, NS)}</span>
        <span class="di-row__val mono">{languages.join(', ') || t('unreported', undefined, NS)}</span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblUiPrefs', undefined, NS)}</span>
        <span class="di-row__val mono">
          {t(
            'prefSummary',
            {
              scheme: prefersDark ? t('schemeDark', undefined, NS) : t('schemeLight', undefined, NS),
              motion: reducedMotion
                ? t('motionReduced', undefined, NS)
                : t('motionStandard', undefined, NS),
              contrast: highContrast
                ? t('contrastHigh', undefined, NS)
                : t('contrastStandard', undefined, NS),
            },
            NS
          )}
        </span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblInput', undefined, NS)}</span>
        <span class="di-row__val mono">
          {[
            pointerKind === 'fine'
              ? t('pointerFine', undefined, NS)
              : pointerKind === 'coarse'
                ? t('pointerCoarse', undefined, NS)
                : t('pointerNone', undefined, NS),
            hoverCapable ? t('hoverYes', undefined, NS) : t('hoverNo', undefined, NS),
            t('touchPoints', { count: maxTouchPoints }, NS),
          ].join(' · ')}
        </span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblLink', undefined, NS)}</span>
        <span class="di-row__val mono">{connectionDisplay}</span>
      </div>
      <div class="di-row">
        <span class="di-row__key">{t('lblBattery', undefined, NS)}</span>
        <span class="di-row__val mono">{batteryDisplay}</span>
      </div>
      <div class="di-row di-row--full">
        {#if storageUsed !== null && storageQuota && storageQuota > 0}
          <div class="di-storage-meter">
            <Meter
              label={t('lblStorage', undefined, NS)}
              valueText={t(
                'storageUsedOf',
                { used: formatBytes(storageUsed), quota: formatBytes(storageQuota) },
                NS
              )}
              percent={storagePercent}
              tone="success"
            />
          </div>
        {:else}
          <span class="di-row__key">{t('lblStorage', undefined, NS)}</span>
          <span class="di-row__val mono">
            {!isSecureCtx
              ? t('reasonHttpsRequired', undefined, NS)
              : t('reasonBrowserHidden', undefined, NS)}
          </span>
        {/if}
      </div>
    </div>
  </section>
</div>

<style>
  .di-bench {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .di-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.625rem;
  }

  .di-toolbar__left,
  .di-toolbar__right {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .di-kpi-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .di-kpi {
    padding: 0.75rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }

  .di-kpi__label {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .di-kpi__val {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--amber);
    font-variant-numeric: tabular-nums;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .di-kpi__val--mint {
    color: var(--mint);
  }

  .di-kpi__sub {
    font-size: 0.6875rem;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .di-bays {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
    align-items: start;
  }

  .di-bay {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  .di-bay__title {
    margin: 0;
    font-size: 0.78125rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .di-soft-note {
    padding: 0.5rem 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78125rem;
    color: var(--amber);
  }

  .di-list {
    padding: 0.375rem 0.75rem;
    display: flex;
    flex-direction: column;
  }

  .di-list--2col {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 1.25rem;
  }

  .di-row {
    padding: 0.5rem 0;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    border-bottom: 1px solid rgb(255 255 255 / 0.04);
    min-width: 0;
  }

  .di-list > .di-row:last-child {
    border-bottom: 0;
  }

  .di-row--full {
    grid-column: 1 / -1;
  }

  .di-row__key {
    font-size: 0.75rem;
    color: var(--ink-3);
    flex: none;
  }

  .di-row__val {
    font-size: 0.78125rem;
    color: var(--ink);
    text-align: right;
    overflow-wrap: anywhere;
    min-width: 0;
  }

  .di-row__val--mint {
    color: var(--mint);
    font-weight: 600;
  }

  .di-ua-box {
    padding: 0.625rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .di-ua-box__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .di-ua-box__code {
    font-size: 0.75rem;
    line-height: 1.45;
    color: var(--ink-2);
    word-break: break-all;
  }

  .di-codec-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .di-codec-card {
    padding: 0.625rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 0;
  }

  .di-codec-card__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .di-codec-card__name {
    font-size: 0.78125rem;
    font-weight: 600;
    color: var(--ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .di-codec-card__mime {
    font-size: 0.6875rem;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .di-storage-meter {
    width: 100%;
    padding: 0.125rem 0;
  }

  @media (max-width: 960px) {
    .di-kpi-grid,
    .di-codec-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .di-bays,
    .di-list--2col {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 540px) {
    .di-kpi-grid,
    .di-codec-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
