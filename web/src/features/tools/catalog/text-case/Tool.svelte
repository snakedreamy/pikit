<script lang="ts">
  import { formatBytes, t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Button, CopyButton, Icon, TextArea } from '../../../../ui';
  import {
    computeTextStats,
    convertAllCases,
    inspectTextFileBytes,
    type InspectedTextFile,
  } from './logic';

  const NS = 'tool:text-case';

  let raw = $state('parseHttpHeader_v2Config');
  let loadedFile = $state<InspectedTextFile | null>(null);
  let fileError = $state('');
  let dragging = $state(false);
  let fileInputEl: HTMLInputElement | undefined = $state();
  let fileReadSeq = 0;

  async function handleFile(file: File) {
    const seq = ++fileReadSeq;
    fileError = '';
    try {
      const ab = await file.arrayBuffer();
      if (seq !== fileReadSeq) return;
      const inspected = inspectTextFileBytes(file.name, ab);
      loadedFile = inspected;
      if (!inspected.isBinary) {
        raw = inspected.text;
      }
    } catch {
      if (seq !== fileReadSeq) return;
      loadedFile = null;
      fileError = t('fileReadError', { name: file.name }, NS);
    }
  }

  function onFilePick(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const f = el.files?.[0];
    if (f) void handleFile(f);
    el.value = '';
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void handleFile(f);
  }

  function clearAll() {
    fileReadSeq += 1;
    fileError = '';
    raw = '';
    loadedFile = null;
  }

  const stats = $derived(computeTextStats(raw));
  const cases = $derived(convertAllCases(raw));
  const caseEntries = $derived(Object.entries(cases));

  const eolText = $derived.by(() => {
    if (stats.lineEnding === 'none') return t('eolNone', undefined, NS);
    if (stats.lineEnding === 'mixed') return t('eolMixed', undefined, NS);
    return stats.lineEnding;
  });

  const readingText = $derived.by(() => {
    if (stats.readingSeconds <= 0) return t('readZero', undefined, NS);
    if (stats.readingSeconds < 60) {
      return t('readSec', { sec: stats.readingSeconds }, NS);
    }
    const min = Math.floor(stats.readingSeconds / 60);
    const sec = stats.readingSeconds % 60;
    return t('readMinSec', { min, sec }, NS);
  });
</script>

<input
  bind:this={fileInputEl}
  type="file"
  class="sr-only"
  data-testid="tc-file-input"
  onchange={onFilePick}
/>

<div class="tc-bench">
  <div
    class="tc-input-pane"
    data-drag={dragging ? 'true' : undefined}
    role="region"
    aria-label={t('inputLabel', undefined, NS)}
    ondragover={(e) => {
      e.preventDefault();
      dragging = true;
    }}
    ondragleave={() => (dragging = false)}
    ondrop={onDrop}
  >
    <div class="tc-bar">
      <div class="tc-bar__left">
        <label class="tc-bar__label" for="pk-tc-input">{t('inputLabel', undefined, NS)}</label>
        <span class="tc-bar__hint">{t('dropHint', undefined, NS)}</span>
      </div>
      <div class="tc-bar__actions">
        {#if loadedFile && !loadedFile.isBinary}
          <span class="glass tc-file-pill mono">
            {loadedFile.fileName} · {formatBytes(loadedFile.byteLength)}
          </span>
        {/if}
        <Button variant="secondary" size="sm" icon="upload" onclick={() => fileInputEl?.click()}>
          {t('importFile', undefined, NS)}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!raw && !loadedFile && !fileError}
          onclick={clearAll}
        >
          <Icon name="x" size="xs" />
          <span>{t('common.clear')}</span>
        </Button>
      </div>
    </div>

    {#if fileError}
      <div class="glass tc-binary-alert" role="alert">
        <Badge tone="danger" dot mono>ERR</Badge>
        <span>{fileError}</span>
      </div>
    {:else if loadedFile?.isBinary}
      <div class="glass tc-binary-alert" role="status">
        <Badge tone="warning" dot mono>BIN</Badge>
        <span>
          {t(
            'binaryWarning',
            { name: loadedFile.fileName, size: formatBytes(loadedFile.byteLength) },
            NS
          )}
        </span>
      </div>
    {/if}

    <TextArea
      id="pk-tc-input"
      bind:value={raw}
      rows={5}
      mono
      oninput={() => {
        fileReadSeq += 1;
        fileError = '';
        if (loadedFile) loadedFile = null;
      }}
    />
  </div>

  <!-- Primary 4-column readout deck -->
  <div class="tc-primary-grid" data-testid="tc-primary-stats">
    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statGraphemes', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.graphemes}</strong>
      <span class="tc-stat__sub mono">{t('subCodePoints', { count: stats.chars }, NS)}</span>
    </div>

    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statBytes', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.utf8Bytes}</strong>
      <span class="tc-stat__sub mono">{t('subUtf16', { count: stats.utf16Units }, NS)}</span>
    </div>

    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statWords', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.words}</strong>
      <span class="tc-stat__sub mono">
        {t('subWordsBreakdown', { latin: stats.latinWords, cjk: stats.cjkChars }, NS)}
      </span>
    </div>

    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statLines', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.lines}</strong>
      <span class="tc-stat__sub mono">
        {t('subLinesBreakdown', { nonEmpty: stats.nonEmptyLines, eol: eolText }, NS)}
      </span>
    </div>
  </div>

  <!-- Secondary 4x2 structural & reading breakdown -->
  <div class="tc-section">
    <span class="tc-heading">{t('compositionHeading', undefined, NS)}</span>
    <div class="tc-detail-grid">
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statNoSpace', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.charsNoSpaces}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statWhitespace', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.whitespace}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statDigits', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.digits}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statPunctuation', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.punctuation}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statParagraphs', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.paragraphs}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statSentences', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.sentences}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statLineSpan', undefined, NS)}</span>
        <strong class="tc-kv__val mono">{stats.maxLineLength} / {stats.avgLineLength}</strong>
      </div>
      <div class="glass tc-kv">
        <span class="tc-kv__key">{t('statReadingTime', undefined, NS)}</span>
        <strong class="tc-kv__val tc-kv__val--mint mono">{readingText}</strong>
      </div>
    </div>
  </div>

  {#if stats.topTokens.length > 0}
    <div class="tc-section">
      <span class="tc-heading">{t('freqHeading', undefined, NS)}</span>
      <div class="tc-freq-grid">
        {#each stats.topTokens as item, idx (item.token)}
          <div class="glass tc-freq-chip">
            <span class="tc-freq-chip__rank mono">#{idx + 1}</span>
            <code class="tc-freq-chip__token mono">{item.token}</code>
            <span class="tc-freq-chip__meta mono">{item.count}× · {item.percent}%</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="tc-section">
    <span class="tc-heading">{t('casesLabel', undefined, NS)}</span>
    <div class="tc-grid">
      {#each caseEntries as [label, val] (label)}
        <div class="glass tc-row">
          <span class="tc-row__key mono">{label}</span>
          <code class="tc-row__val mono">{val || '∅'}</code>
          <CopyButton text={val} />
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .tc-bench {
    display: flex;
    flex-direction: column;
    gap: 1.125rem;
  }

  .tc-input-pane {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-radius: var(--r-panel);
    transition: box-shadow 0.14s;
  }

  .tc-input-pane[data-drag='true'] {
    box-shadow: 0 0 0 2px var(--amber);
  }

  .tc-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .tc-bar__left {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.625rem;
  }

  .tc-bar__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink);
  }

  .tc-bar__hint {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .tc-bar__actions {
    display: flex;
    align-items: center;
    gap: 0.4375rem;
  }

  .tc-file-pill {
    padding: 0.25rem 0.5625rem;
    font-size: 0.75rem;
    color: var(--mint);
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tc-binary-alert {
    padding: 0.5rem 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.5625rem;
    font-size: 0.78125rem;
    color: var(--amber);
  }

  .tc-primary-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .tc-stat {
    padding: 0.75rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tc-stat__label {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .tc-stat__val {
    font-size: 1.25rem;
    font-weight: 700;
    color: var(--amber);
    font-variant-numeric: tabular-nums;
  }

  .tc-stat__sub {
    font-size: 0.6875rem;
    color: var(--ink-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tc-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .tc-heading {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .tc-detail-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .tc-kv {
    padding: 0.5625rem 0.75rem;
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .tc-kv__key {
    font-size: 0.75rem;
    color: var(--ink-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tc-kv__val {
    font-size: 0.84375rem;
    font-weight: 650;
    color: var(--ink);
    font-variant-numeric: tabular-nums;
    flex: none;
  }

  .tc-kv__val--mint {
    color: var(--mint);
  }

  .tc-freq-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .tc-freq-chip {
    padding: 0.4375rem 0.6875rem;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.5rem;
  }

  .tc-freq-chip__rank {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .tc-freq-chip__token {
    font-size: 0.78125rem;
    color: var(--mint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tc-freq-chip__meta {
    font-size: 0.6875rem;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }

  .tc-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .tc-row {
    padding: 0.5rem 0.75rem;
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.625rem;
  }

  .tc-row__key {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .tc-row__val {
    font-size: 0.8125rem;
    color: var(--mint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 920px) {
    .tc-primary-grid,
    .tc-detail-grid,
    .tc-freq-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .tc-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 520px) {
    .tc-primary-grid,
    .tc-detail-grid,
    .tc-freq-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
