<script lang="ts">
  import { onMount } from 'svelte';
  import UiShowcasePage from './dev/UiShowcasePage.svelte';
  import LoginGate from './features/auth/LoginGate.svelte';
  import {
    clearDashboardBookmarksCache,
    ensureDashboardBookmarksLoaded,
  } from './features/dashboard/api';
  import DashboardPage from './features/dashboard/DashboardPage.svelte';
  import SystemTelemetryBar from './features/dashboard/SystemTelemetryBar.svelte';
  import DropPage from './features/drop/DropPage.svelte';
  import SpeedtestPage from './features/speedtest/SpeedtestPage.svelte';
  import './features/tools/registry';
  import ToolWorkbenchPage from './features/tools/ToolWorkbenchPage.svelte';
  import ToolsIndexPage from './features/tools/ToolsIndexPage.svelte';
  import { fetchAppMeta, type AppMeta } from './lib/api';
  import { t } from './lib/i18n/index.svelte';
  import { DEV_UI_ENABLED, getRoute, navigate } from './lib/router.svelte';
  import AppShell from './shell/AppShell.svelte';
  import { Button, EmptyState, ToastViewport } from './ui';

  let meta = $state<AppMeta | null>(null);
  let paletteOpen = $state(false);
  let authBootstrapped = $state(false);

  const route = $derived(getRoute());

  const requiresLogin = $derived(
    Boolean(meta?.auth.enabled) && !meta?.auth.authenticated
  );

  async function refreshMeta(signal?: AbortSignal) {
    try {
      const data = await fetchAppMeta(signal);
      meta = data;
      if (data.title) {
        document.title = data.title;
      }
    } catch {
      // Keep current state during offline or static preview debugging
    } finally {
      authBootstrapped = true;
    }
  }

  /**
   * Immediately locks the UI and wipes cached private bookmarks upon logout or HTTP 401.
   * Deliberately avoids firing an immediate `/api/meta` follow-up request so a failed logout
   * (where the server never received `POST /api/auth/logout` and the cookie is still valid)
   * cannot silently re-unlock the protected UI behind the user's back.
   */
  function handleSessionInvalidated() {
    paletteOpen = false;
    clearDashboardBookmarksCache();
    meta = meta
      ? {
          ...meta,
          auth: {
            enabled: true,
            authenticated: false,
          },
        }
      : {
          version: '0.2.0',
          commit: '',
          title: 'pikbay',
          auth: { enabled: true, authenticated: false },
          features: { system: false, perCore: false, speedtest: false, drop: false },
        };
  }

  onMount(() => {
    const ctrl = new AbortController();
    refreshMeta(ctrl.signal);
    return () => ctrl.abort();
  });

  // Warm the bookmark search index once authenticated so pressing `/` from `/tools` or `/speedtest`
  // searches all bookmarks globally; clear the in-memory cache immediately upon logout.
  $effect(() => {
    if (!authBootstrapped) return;
    if (requiresLogin) {
      clearDashboardBookmarksCache();
      return;
    }
    const ctrl = new AbortController();
    ensureDashboardBookmarksLoaded(ctrl.signal).catch(() => {});
    return () => ctrl.abort();
  });
</script>

<AppShell
  {meta}
  authenticated={!requiresLogin}
  bind:paletteOpen
  onloggedout={handleSessionInvalidated}
>
  {#snippet telemetryStrip()}
    {#if route.name !== 'dev-ui'}
      <SystemTelemetryBar
        systemEnabled={meta?.features.system ?? true}
        perCoreEnabled={meta?.features.perCore ?? true}
        onunauthorized={handleSessionInvalidated}
      />
    {/if}
  {/snippet}

  {#if !authBootstrapped && meta === null}
    <div aria-busy="true"></div>
  {:else if requiresLogin}
    <LoginGate
      siteTitle={meta?.title ?? 'pikbay'}
      onsuccess={() => refreshMeta()}
    />
  {:else if route.name === 'dashboard'}
    <DashboardPage onunauthorized={handleSessionInvalidated} />
  {:else if route.name === 'tools'}
    <ToolsIndexPage />
  {:else if route.name === 'tool'}
    <ToolWorkbenchPage toolId={route.id} />
  {:else if route.name === 'speedtest' && (meta?.features.speedtest ?? true)}
    <SpeedtestPage
      speedtestLimits={meta?.speedtestLimits}
      onunauthorized={handleSessionInvalidated}
    />
  {:else if route.name === 'drop' && (meta?.features.drop ?? true)}
    <DropPage
      dropLimits={meta?.dropLimits}
      onunauthorized={handleSessionInvalidated}
    />
  {:else if route.name === 'dev-ui' && DEV_UI_ENABLED}
    <UiShowcasePage />
  {:else}
    <EmptyState
      title={t('placeholders.notFoundTitle')}
      reason={t('placeholders.notFoundReason', {
        path:
          route.name === 'not-found'
            ? route.path
            : route.name === 'drop'
              ? '/drop'
              : '/speedtest',
      })}
    >
      {#snippet actions()}
        <Button variant="primary" size="sm" onclick={() => navigate('/')}>
          {t('common.backHome')}
        </Button>
      {/snippet}
    </EmptyState>
  {/if}
</AppShell>

<ToastViewport />
