<script lang="ts">
  import LoginGate from '../features/auth/LoginGate.svelte';
  import DashboardPage from '../features/dashboard/DashboardPage.svelte';
  import SystemTelemetryBar from '../features/dashboard/SystemTelemetryBar.svelte';
  import type { DashboardGroup, SystemTelemetrySnapshot } from '../features/dashboard/types';
  import DropPage from '../features/drop/DropPage.svelte';
  import SpeedtestPage from '../features/speedtest/SpeedtestPage.svelte';
  import ToolsIndexPage from '../features/tools/ToolsIndexPage.svelte';
  import { registerLocaleGlob, t, type MessageTree } from '../lib/i18n/index.svelte';
  import { Segmented } from '../ui';

  registerLocaleGlob(
    'devSpec',
    import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
  );

  type SpecView = 'dashboard' | 'tools' | 'speedtest' | 'drop' | 'login';

  function readInitialView(): { view: SpecView; clean: boolean } {
    if (typeof window === 'undefined') return { view: 'dashboard', clean: false };
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('view');
    const view: SpecView =
      raw === 'tools' || raw === 'speedtest' || raw === 'drop' || raw === 'login'
        ? raw
        : 'dashboard';
    return { view, clean: params.get('clean') === '1' };
  }

  const init = readInitialView();
  let activeView = $state<SpecView>(init.view);
  const cleanMode = init.clean;

  const sampleTelemetry = $derived<SystemTelemetrySnapshot>({
    cpu: {
      percent: 21.8,
      usedCoresText: '1.7',
      totalCores: 8,
      perCore: [48.2, 16.5, 12.0, 78.4, 14.2, 9.5, 18.0, 8.6],
      source: 'host',
    },
    memory: {
      usedBytes: 4.6 * 1024 ** 3,
      totalBytes: 16 * 1024 ** 3,
      percent: 28.8,
      source: 'host',
    },
    disks: [
      {
        label: t('diskSystem', undefined, 'devSpec'),
        path: '/',
        usedBytes: 42 * 1024 ** 3,
        totalBytes: 128 * 1024 ** 3,
        percent: 32.8,
      },
      {
        label: 'NVMe',
        path: '/mnt/nvme',
        usedBytes: 610 * 1024 ** 3,
        totalBytes: 1000 * 1024 ** 3,
        percent: 61.0,
      },
      {
        label: t('diskZfs', undefined, 'devSpec'),
        path: '/mnt/tank',
        usedBytes: 6280 * 1024 ** 3,
        totalBytes: 8000 * 1024 ** 3,
        percent: 78.5,
      },
    ],
  });

  const sampleGroups = $derived<DashboardGroup[]>([
    {
      name: t('groupCore', undefined, 'devSpec'),
      items: [
        {
          name: 'Jellyfin',
          url: 'https://media.example.ts.net',
          host: 'media.ts.net',
          description: t('descJellyfin', undefined, 'devSpec'),
          iconText: 'JF',
        },
        {
          name: 'Gitea',
          url: 'https://git.example.ts.net',
          host: 'git.ts.net',
          description: t('descGitea', undefined, 'devSpec'),
          iconText: 'GT',
        },
        {
          name: 'Proxmox VE',
          url: 'https://pve.example.ts.net',
          host: 'pve.ts.net',
          description: t('descProxmox', undefined, 'devSpec'),
        },
      ],
    },
    {
      name: t('groupInfra', undefined, 'devSpec'),
      items: [
        {
          name: 'Caddy Gateway',
          url: 'https://gw.example.ts.net',
          host: 'gw.ts.net',
          description: t('descCaddy', undefined, 'devSpec'),
          iconText: 'CG',
        },
        {
          name: 'TrueNAS Scale',
          url: 'https://nas.example.ts.net',
          host: 'nas.ts.net',
          description: t('descTruenas', undefined, 'devSpec'),
          iconText: 'NAS',
        },
        {
          name: t('nameRouter', undefined, 'devSpec'),
          url: 'https://router.example.ts.net',
          host: '10.0.0.1',
          description: t('descRouter', undefined, 'devSpec'),
          iconUrl: '/icons/not-uploaded-yet.svg',
        },
      ],
    },
  ]);

  // Unsmoothed 10-second (50 × 200ms) TCP slow-start, burst, and micro-jitter trace fixture
  const sampleSpeedtest = {
    downloadMbps: 942.6,
    uploadMbps: 884.2,
    pingMs: 1.42,
    jitterMs: 0.18,
    rxSeries: [
      180, 410, 685, 842, 915, 892, 948, 964, 931, 955,
      940, 912, 958, 971, 936, 944, 928, 962, 949, 905,
      938, 956, 968, 941, 933, 951, 945, 919, 960, 952,
      939, 947, 965, 930, 944, 957, 942, 926, 953, 948,
      937, 959, 946, 941, 954, 935, 949, 961, 940, 945,
    ],
    txSeries: [
      145, 330, 560, 748, 835, 876, 861, 895, 882, 854,
      890, 904, 872, 886, 898, 865, 879, 892, 881, 849,
      888, 901, 876, 885, 894, 871, 883, 899, 868, 887,
      893, 878, 862, 896, 884, 875, 891, 886, 870, 895,
      882, 889, 874, 892, 885, 879, 894, 881, 888, 884,
    ],
    history: [
      {
        id: 'run-3',
        timestamp: 1763814612000,
        downloadMbps: 942.6,
        uploadMbps: 884.2,
        pingMs: 1.42,
        jitterMs: 0.18,
      },
      {
        id: 'run-2',
        timestamp: 1763809204000,
        downloadMbps: 918.4,
        uploadMbps: 861.0,
        pingMs: 1.55,
        jitterMs: 0.21,
      },
      {
        id: 'run-1',
        timestamp: 1763798410000,
        downloadMbps: 486.2,
        uploadMbps: 412.8,
        pingMs: 8.34,
        jitterMs: 1.12,
      },
    ],
  };
</script>

<div class="spec-page">
  {#if !cleanMode}
    <header class="plate spec-switcher">
      <Segmented
        size="sm"
        ariaLabel={t('title', undefined, 'devSpec')}
        bind:value={activeView}
        options={[
          { value: 'dashboard', label: t('tabDashboard', undefined, 'devSpec') },
          { value: 'tools', label: t('tabTools', undefined, 'devSpec') },
          { value: 'speedtest', label: t('tabSpeedtest', undefined, 'devSpec') },
          { value: 'drop', label: t('tabDrop', undefined, 'devSpec') },
          { value: 'login', label: t('tabLogin', undefined, 'devSpec') },
        ]}
      />
    </header>
  {/if}

  {#if activeView !== 'login'}
    <SystemTelemetryBar
      systemEnabled={true}
      perCoreEnabled={true}
      previewTelemetry={sampleTelemetry}
    />
  {/if}

  {#if activeView === 'dashboard'}
    <DashboardPage previewGroups={sampleGroups} />
  {:else if activeView === 'tools'}
    <ToolsIndexPage />
  {:else if activeView === 'speedtest'}
    <SpeedtestPage previewSample={sampleSpeedtest} />
  {:else if activeView === 'drop'}
    <DropPage
      previewSample={{
        code: '482910',
        ttlRemaining: 146,
        ttlTotal: 180,
        transport: 'p2p',
        fingerprint: '9F4C2A8E',
        fileName: 'caddy-edge-backup.tar.zst',
        fileBytes: 18_432_000,
        receivedText: '[Interface]\nAddress = 10.66.0.2/32\nDNS = 10.66.0.1\n\n[Peer]\nEndpoint = gw.example.ts.net:51820',
      }}
    />
  {:else}
    <LoginGate siteTitle="pikbay" />
  {/if}
</div>

<style>
  .spec-page {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .spec-switcher {
    padding: 0.625rem 0.875rem;
    display: flex;
    justify-content: center;
  }
</style>
