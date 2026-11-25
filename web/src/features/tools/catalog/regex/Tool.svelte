<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Field, Input, TextArea } from '../../../../ui';
  import {
    executeRegexMatches,
    segmentTextByMatches,
    type RegexExecResult,
  } from './logic';
  import type { RegexWorkerResponse } from './worker';

  const NS = 'tool:regex';
  const TIMEOUT_MS = 800;
  const MAX_MATCHES = 500;
  const FLAG_LIST = ['g', 'i', 'm', 's', 'u'] as const;

  let pattern = $state('(?<proto>https?)://(?<host>[\\w.-]+)(?::(?<port>\\d+))?');
  let activeFlags = $state<Record<string, boolean>>({
    g: true,
    i: false,
    m: true,
    s: false,
    u: true,
  });
  let sample = $state(
    'upstream https://media.example.ts.net:8443/healthz\nbackup   http://nas.example.ts.net:9000/status'
  );

  const flagsString = $derived(FLAG_LIST.filter((f) => activeFlags[f]).join(''));

  let execState = $state<RegexExecResult>({
    ok: true,
    matches: [],
    elapsedMs: 0,
    truncated: false,
  });
  let timedOut = $state(false);

  let workerRef: Worker | null = null;
  let seq = 0;

  function ensureWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    if (!workerRef) {
      workerRef = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    }
    return workerRef;
  }

  function resetWorker() {
    if (workerRef) {
      workerRef.terminate();
      workerRef = null;
    }
  }

  $effect(() => {
    const p = pattern;
    const f = flagsString;
    const txt = sample;

    timedOut = false;

    if (!p) {
      execState = { ok: true, matches: [], elapsedMs: 0, truncated: false };
      return;
    }

    const w = ensureWorker();
    if (!w) {
      execState = executeRegexMatches(p, f, txt, MAX_MATCHES);
      return;
    }

    const reqId = ++seq;
    let settled = false;

    const timer = window.setTimeout(() => {
      if (settled || reqId !== seq) return;
      settled = true;
      resetWorker();
      timedOut = true;
    }, TIMEOUT_MS);

    const onMessage = (ev: MessageEvent<RegexWorkerResponse>) => {
      if (ev.data.id !== reqId || settled) return;
      settled = true;
      window.clearTimeout(timer);
      execState = ev.data.result;
    };

    w.onmessage = onMessage;
    w.postMessage({ id: reqId, pattern: p, flags: f, text: txt });

    return () => {
      window.clearTimeout(timer);
    };
  });

  $effect(() => {
    return () => {
      resetWorker();
    };
  });

  const segments = $derived(
    execState.ok && !timedOut ? segmentTextByMatches(sample, execState.matches) : []
  );

  function toggleFlag(flag: string) {
    activeFlags = { ...activeFlags, [flag]: !activeFlags[flag] };
  }
</script>

<div class="rx-bench">
  <div class="rx-top">
    <div class="rx-top__pattern">
      <Field
        label={t('patternLabel', undefined, NS)}
        forId="pk-rx-pattern"
        error={!timedOut && !execState.ok ? execState.error : undefined}
      >
        <Input
          id="pk-rx-pattern"
          bind:value={pattern}
          placeholder={t('patternPlaceholder', undefined, NS)}
          mono
          invalid={Boolean(!timedOut && !execState.ok)}
        />
      </Field>
    </div>

    <div class="rx-top__flags">
      <span class="rx-label">{t('flagsLabel', undefined, NS)}</span>
      <div class="glass rx-flag-bar" role="group" aria-label={t('flagsLabel', undefined, NS)}>
        {#each FLAG_LIST as fl (fl)}
          <button
            type="button"
            class="rx-flag mono"
            data-active={activeFlags[fl] ? 'true' : undefined}
            aria-pressed={activeFlags[fl] ? 'true' : 'false'}
            onclick={() => toggleFlag(fl)}
          >
            {fl}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <Field label={t('sampleLabel', undefined, NS)} forId="pk-rx-sample">
    <TextArea id="pk-rx-sample" bind:value={sample} rows={5} mono />
  </Field>

  {#if timedOut}
    <div class="glass rx-alert" role="alert">
      {t('timeoutError', { ms: TIMEOUT_MS }, NS)}
    </div>
  {:else if execState.ok}
    <div class="rx-section">
      <div class="rx-head">
        <span class="rx-label">{t('highlightLabel', undefined, NS)}</span>
        {#if !pattern}
          <span class="rx-muted">{t('emptyPattern', undefined, NS)}</span>
        {:else if execState.matches.length === 0}
          <Badge tone="neutral">{t('noMatch', undefined, NS)}</Badge>
        {:else}
          <Badge tone="success" dot>
            {t('matchStats', { count: execState.matches.length, ms: execState.elapsedMs }, NS)}
            {execState.truncated ? ` ${t('truncatedNote', { max: MAX_MATCHES }, NS)}` : ''}
          </Badge>
        {/if}
      </div>

      <div class="glass rx-preview mono">
        {#each segments as seg, idx (idx)}
          {#if seg.matched}
            <mark class="rx-mark" title={`#${seg.matchOrder}`}>{seg.text}</mark>
          {:else}
            <span>{seg.text}</span>
          {/if}
        {/each}
      </div>
    </div>

    {#if execState.matches.length > 0}
      <div class="rx-section">
        <span class="rx-label">{t('matchesLabel', undefined, NS)}</span>
        <div class="glass rx-table-wrap">
          <table class="rx-table mono">
            <thead>
              <tr>
                <th>{t('colIndex', undefined, NS)}</th>
                <th>{t('colRange', undefined, NS)}</th>
                <th>{t('colMatch', undefined, NS)}</th>
                <th>{t('colGroups', undefined, NS)}</th>
              </tr>
            </thead>
            <tbody>
              {#each execState.matches as item, idx (idx)}
                <tr>
                  <td class="rx-muted">{idx + 1}</td>
                  <td class="rx-muted">[{item.index}..{item.index + item.length}]</td>
                  <td class="rx-val">{item.match || '""'}</td>
                  <td>
                    {#if item.groups}
                      <div class="rx-chips">
                        {#each Object.entries(item.groups) as [k, v] (k)}
                          <span class="rx-chip">
                            <span class="rx-chip__k">{k}:</span>
                            <span>{v}</span>
                          </span>
                        {/each}
                      </div>
                    {:else if item.captures.length > 0}
                      <div class="rx-chips">
                        {#each item.captures as cap, cIdx (cIdx)}
                          {#if cap !== null}
                            <span class="rx-chip">
                              <span class="rx-chip__k">${cIdx + 1}:</span>
                              <span>{cap}</span>
                            </span>
                          {/if}
                        {/each}
                      </div>
                    {:else}
                      <span class="rx-muted">∅</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .rx-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .rx-top {
    display: flex;
    align-items: flex-start;
    gap: 0.875rem;
    flex-wrap: wrap;
  }

  .rx-top__pattern {
    flex: 1;
    min-width: 15rem;
  }

  .rx-top__flags {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .rx-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .rx-muted {
    color: var(--ink-3);
    font-size: 0.75rem;
  }

  .rx-flag-bar {
    display: inline-flex;
    padding: 0.1875rem;
    gap: 0.1875rem;
    height: 2.25rem;
    align-items: center;
  }

  .rx-flag {
    width: 1.875rem;
    height: 1.875rem;
    border: 0;
    border-radius: 0.25rem;
    background: transparent;
    color: var(--ink-3);
    font-size: 0.8125rem;
    font-weight: 600;
    transition: background-color 0.12s, color 0.12s;
  }

  .rx-flag[data-active='true'] {
    background: var(--plate-raised);
    color: var(--amber);
    box-shadow: var(--shadow-key);
  }

  .rx-alert {
    padding: 0.75rem 0.9375rem;
    color: var(--fault);
    font-size: 0.8125rem;
    border-left: 3px solid var(--fault);
  }

  .rx-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .rx-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .rx-preview {
    padding: 0.75rem 0.875rem;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.8125rem;
    line-height: 1.6;
    color: var(--ink-2);
    min-height: 3.5rem;
  }

  .rx-mark {
    background: var(--amber-soft);
    color: var(--amber);
    padding: 0.0625rem 0.1875rem;
    border-radius: 0.1875rem;
    font-weight: 600;
  }

  .rx-table-wrap {
    overflow-x: auto;
  }

  .rx-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }

  .rx-table th,
  .rx-table td {
    padding: 0.5rem 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--hairline);
    vertical-align: top;
  }

  .rx-table th {
    color: var(--ink-3);
    font-weight: 600;
  }

  .rx-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .rx-val {
    color: var(--mint);
    word-break: break-all;
  }

  .rx-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .rx-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.125rem 0.4375rem;
    border-radius: 0.25rem;
    background: var(--plate);
    color: var(--ink);
  }

  .rx-chip__k {
    color: var(--amber);
  }
</style>
