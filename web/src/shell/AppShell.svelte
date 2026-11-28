<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { IconName } from '../icons/names';
  import { logoutSession, type AppMeta } from '../lib/api';
  import {
    buildLocalizedRecord,
    collectLocalizedKeywords,
    getLocale,
    LOCALE_DEFINITIONS,
    setLocale,
    t,
    translateWithLocale,
    type Locale,
  } from '../lib/i18n/index.svelte';
  import {
    DEV_UI_ENABLED,
    getRoute,
    navigate,
    type RouteMatch,
  } from '../lib/router.svelte';
  import { getAllSearchEntries, type SearchEntry } from '../lib/search';
  import {
    getThemeMode,
    setThemeMode,
    THEME_DEFINITIONS,
    type ThemeMode,
  } from '../lib/theme.svelte';
  import { BrandMark, Button, Icon, pushToast, Select } from '../ui';
  import CommandPalette from './CommandPalette.svelte';

  interface Props {
    meta: AppMeta | null;
    authenticated?: boolean;
    paletteOpen?: boolean;
    onloggedout?: () => void;
    telemetryStrip?: Snippet;
    children: Snippet;
  }

  let {
    meta,
    authenticated = true,
    paletteOpen = $bindable(false),
    onloggedout,
    telemetryStrip,
    children,
  }: Props = $props();

  const route = $derived<RouteMatch>(getRoute());
  const siteTitle = $derived(meta?.title || 'pikbay');
  const speedEnabled = $derived(meta ? meta.features.speedtest : true);
  const dropEnabled = $derived(meta ? meta.features.drop : true);

  const previewTab = $derived.by(() => {
    if (route.name !== 'dev-ui' || typeof window === 'undefined') return null;
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'tools' || v === 'speedtest' || v === 'drop' || v === 'login') return v;
    return 'dashboard';
  });

  const effectiveAuthed = $derived(authenticated && previewTab !== 'login');

  // Declarative primary workspace navigation anchored with 1.5px Lucide icons
  const navItems = $derived.by(() => {
    const items: Array<{
      id: string;
      href: string;
      icon: IconName;
      label: string;
      active: boolean;
    }> = [
      {
        id: 'dashboard',
        href: '/',
        icon: 'compass',
        label: t('nav.dashboard'),
        active: route.name === 'dashboard' || previewTab === 'dashboard',
      },
      {
        id: 'tools',
        href: '/tools',
        icon: 'wrench',
        label: t('nav.tools'),
        active: route.name === 'tools' || route.name === 'tool' || previewTab === 'tools',
      },
    ];
    if (speedEnabled) {
      items.push({
        id: 'speedtest',
        href: '/speedtest',
        icon: 'gauge',
        label: t('nav.speedtest'),
        active: route.name === 'speedtest' || previewTab === 'speedtest',
      });
    }
    if (dropEnabled) {
      items.push({
        id: 'drop',
        href: '/drop',
        icon: 'send',
        label: t('nav.drop'),
        active: route.name === 'drop' || previewTab === 'drop',
      });
    }
    return items;
  });

  // Theme and locale options are derived dynamically from their single-source registries
  const themeOptions = $derived(
    THEME_DEFINITIONS.map((def) => ({
      value: def.id,
      label: t(def.labelKey),
    }))
  );

  const localeOptions = LOCALE_DEFINITIONS.map((def) => ({
    value: def.code,
    label: def.label,
  }));

  const searchEntries = $derived.by<SearchEntry[]>(() => {
    if (!authenticated) return [];
    const list = getAllSearchEntries({ speedtestEnabled: speedEnabled, dropEnabled });
    if (DEV_UI_ENABLED) {
      list.push({
        id: 'nav:dev-ui',
        group: 'nav',
        href: '/dev/ui',
        labels: buildLocalizedRecord(
          (loc) => `${translateWithLocale(loc, 'nav.devUi')} (/dev/ui)`
        ),
        keywords: collectLocalizedKeywords('navKeywords.devUi'),
      });
    }
    return list;
  });

  function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      target.isContentEditable
    );
  }

  function handleGlobalKeydown(e: KeyboardEvent) {
    if (!authenticated) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isEditableTarget(e.target)) {
      e.preventDefault();
      paletteOpen = true;
    }
  }

  async function handleLogout() {
    try {
      await logoutSession();
    } catch {
      pushToast(t('topbar.logoutError'), 'danger');
    } finally {
      onloggedout?.();
    }
  }
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<a class="sr-only" href="#pk-main-content">{t('app.skipToContent')}</a>

<div class="bench">
  <header class="bench__header-wrap">
    <!-- Symmetric left / center / right top bar -->
    <div class="top">
      <div class="top__left">
        <a
          href="/"
          class="top__brand"
          onclick={(e) => {
            e.preventDefault();
            navigate('/');
          }}
        >
          <BrandMark size="md" />
          <h1>{siteTitle}</h1>
        </a>
      </div>

      <div class="top__center">
        {#if effectiveAuthed}
          <nav class="well top__nav" aria-label={t('nav.primary')}>
            {#each navItems as item (item.id)}
              <a
                href={item.href}
                class="top__nav-item"
                aria-current={item.active ? 'page' : undefined}
                onclick={(e) => {
                  e.preventDefault();
                  navigate(item.href);
                }}
              >
                <span class="top__nav-icon" aria-hidden="true">
                  <Icon name={item.icon} size="xs" />
                </span>
                <span>{item.label}</span>
              </a>
            {/each}
          </nav>
        {/if}
      </div>

      <div class="top__right">
        {#if effectiveAuthed}
          <button
            type="button"
            class="top__search"
            aria-label={t('topbar.searchTrigger')}
            onclick={() => (paletteOpen = true)}
          >
            <Icon name="search" size="xs" />
            <span>{t('topbar.searchShort')}</span>
            <kbd class="mono">/</kbd>
          </button>
        {/if}

        <Select
          inline
          name="theme-mode"
          ariaLabel={t('topbar.themeAria')}
          value={getThemeMode()}
          options={themeOptions}
          onchange={(next) => setThemeMode(next as ThemeMode)}
        />

        <Select
          inline
          name="ui-locale"
          ariaLabel={t('topbar.language')}
          value={getLocale()}
          options={localeOptions}
          onchange={(next) => setLocale(next as Locale)}
        />

        {#if authenticated && meta?.auth.enabled}
          <Button variant="ghost" size="sm" onclick={handleLogout}>
            <Icon name="log-out" size="xs" />
            <span>{t('topbar.logout')}</span>
          </Button>
        {/if}
      </div>
    </div>

    {#if telemetryStrip && effectiveAuthed}
      {@render telemetryStrip()}
    {/if}
  </header>

  <main
    id="pk-main-content"
    class="bench__main"
    data-recessed={paletteOpen ? 'true' : undefined}
  >
    {@render children()}
  </main>

  <footer class="bench__foot mono">
    {#if meta}
      <span>
        {meta.title} v{meta.version}{meta.commit ? ` · ${meta.commit}` : ''}
      </span>
    {:else}
      <span>pikbay v0.3.1</span>
    {/if}
  </footer>
</div>

{#if authenticated}
  <CommandPalette bind:open={paletteOpen} entries={searchEntries} />
{/if}

<style>
  .bench {
    min-height: 100dvh;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .bench__header-wrap {
    max-width: var(--layout-max, 88rem);
    width: 100%;
    margin: 0 auto;
    padding: 0 1.5rem;
  }

  .top {
    min-height: var(--topbar-h);
    padding: 0.625rem 0;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
  }

  .top__left {
    justify-self: start;
    display: flex;
    align-items: center;
  }

  .top__brand {
    display: inline-flex;
    align-items: center;
    gap: 0.625rem;
    white-space: nowrap;
  }

  .top__brand h1 {
    font-family: var(--font-mono);
    font-stretch: 94%;
    font-size: 1.0625rem;
    font-weight: 650;
    letter-spacing: 0.01em;
  }

  .top__center {
    justify-self: center;
  }

  .top__nav {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(5.375rem, 1fr);
    gap: 0.1875rem;
    padding: 0.25rem;
    border-radius: 0.75rem;
  }

  .top__nav-item {
    height: 2.0625rem;
    padding: 0 0.9375rem;
    gap: 0.4375rem;
    border-radius: 0.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 0.90625rem;
    font-weight: 500;
    color: var(--ink-2);
    white-space: nowrap;
    transition:
      background-color 0.14s,
      color 0.14s,
      box-shadow 0.14s,
      transform 0.1s;
  }

  .top__nav-icon {
    display: inline-flex;
    color: var(--ink-3);
    transition: color 0.14s;
  }

  .top__nav-item:hover {
    color: var(--ink);
  }

  .top__nav-item:hover .top__nav-icon {
    color: var(--ink-2);
  }

  .top__nav-item[aria-current='page'] {
    background: var(--plate-raised);
    color: var(--ink);
    font-weight: 650;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo),
      0 3px 8px -3px rgb(0 0 0 / 0.35);
  }

  .top__nav-item[aria-current='page'] .top__nav-icon {
    color: var(--amber);
  }

  .top__right {
    justify-self: end;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .top__search {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    height: 2.25rem;
    padding: 0 0.625rem 0 0.75rem;
    border: 0;
    border-radius: var(--r-key);
    background: var(--plate);
    color: var(--ink-2);
    font-size: 0.84375rem;
    font-weight: 500;
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim),
      0 1px 0 var(--plate-lo);
    transition:
      color 0.14s,
      background-color 0.14s,
      transform 0.1s,
      box-shadow 0.1s;
  }

  .top__search:hover {
    color: var(--ink);
    background: var(--plate-raised);
  }

  .top__search:active {
    transform: translateY(1px);
    box-shadow:
      inset 0 1px 0 var(--plate-hi),
      inset 0 0 0 1px var(--plate-rim);
  }

  .top__search kbd {
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    background: var(--well);
    color: var(--ink-3);
    font-size: 0.6875rem;
    font-weight: 500;
  }

  .bench__main {
    width: 100%;
    max-width: var(--layout-max, 88rem);
    margin: 0 auto;
    padding: 1.75rem 1.5rem 3rem;
    transition:
      transform 0.18s var(--ease-out),
      filter 0.18s var(--ease-out);
  }

  /* Recess and dim the main stage while the global command palette overlay is open */
  .bench__main[data-recessed='true'] {
    transform: scale(0.992);
    filter: brightness(0.75);
  }

  .bench__foot {
    max-width: var(--layout-max, 88rem);
    width: 100%;
    margin: 0 auto;
    padding: 0.5rem 1.5rem 1.5rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  @media (max-width: 920px) {
    .bench__header-wrap,
    .bench__main,
    .bench__foot {
      padding-left: 1rem;
      padding-right: 1rem;
    }
    .top {
      grid-template-columns: 1fr auto;
      row-gap: 0.5rem;
    }
    .top__center {
      grid-column: 1 / -1;
      order: 3;
      width: 100%;
    }
    .top__nav {
      width: 100%;
      grid-auto-columns: minmax(0, 1fr);
    }
  }
</style>
