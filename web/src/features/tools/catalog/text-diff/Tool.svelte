<script lang="ts">
  import { formatBytes, t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Button, Icon, Segmented, Switch, TextArea } from '../../../../ui';
  import {
    buildSplitDisplayRows,
    buildUnifiedDisplayRows,
    diffTexts,
    inspectDiffFileBytes,
    type InspectedDiffFile,
  } from './logic';

  const NS = 'tool:text-diff';

  let left = $state('listen = "0.0.0.0:8080"\nmax_upload_mb = 32\nenabled = true');
  let right = $state('listen = "127.0.0.1:8080"\nmax_upload_mb = 64\nenabled = true\nper_core = true');

  let leftFile = $state<InspectedDiffFile | null>(null);
  let rightFile = $state<InspectedDiffFile | null>(null);
  let leftDrag = $state(false);
  let rightDrag = $state(false);

  let viewMode = $state<'unified' | 'split'>('unified');
  let collapseUnchanged = $state(false);
  let ignoreTrailingWhitespace = $state(false);

  let leftPickerEl: HTMLInputElement | undefined = $state();
  let rightPickerEl: HTMLInputElement | undefined = $state();

  async function loadSideFile(side: 'left' | 'right', file: File) {
    const ab = await file.arrayBuffer();
    const inspected = await inspectDiffFileBytes(file.name, ab);
    if (side === 'left') {
      leftFile = inspected;
      if (!inspected.isBinary) left = inspected.text;
    } else {
      rightFile = inspected;
      if (!inspected.isBinary) right = inspected.text;
    }
  }

  function clearSideFile(side: 'left' | 'right') {
    if (side === 'left') {
      leftFile = null;
    } else {
      rightFile = null;
    }
  }

  function onFileInputChange(side: 'left' | 'right', e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const f = el.files?.[0];
    if (f) void loadSideFile(side, f);
    el.value = '';
  }

  function onSideDrop(side: 'left' | 'right', e: DragEvent) {
    e.preventDefault();
    if (side === 'left') leftDrag = false;
    else rightDrag = false;
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadSideFile(side, f);
  }

  const binaryMode = $derived(Boolean(leftFile?.isBinary || rightFile?.isBinary));
  const binaryEqual = $derived(
    Boolean(
      leftFile &&
        rightFile &&
        leftFile.byteLength === rightFile.byteLength &&
        leftFile.sha256Hex === rightFile.sha256Hex
    )
  );

  const diff = $derived(diffTexts(left, right, { ignoreTrailingWhitespace }));
  const unifiedRows = $derived(buildUnifiedDisplayRows(diff.lines, collapseUnchanged));
  const splitRows = $derived(buildSplitDisplayRows(diff.lines, collapseUnchanged));
</script>

<input
  bind:this={leftPickerEl}
  type="file"
  class="sr-only"
  data-testid="diff-left-file"
  onchange={(e) => onFileInputChange('left', e)}
/>
<input
  bind:this={rightPickerEl}
  type="file"
  class="sr-only"
  data-testid="diff-right-file"
  onchange={(e) => onFileInputChange('right', e)}
/>

<div class="df-bench">
  <div class="df-inputs">
    <!-- Left pane -->
    <div
      class="df-pane"
      data-drag={leftDrag ? 'true' : undefined}
      role="region"
      aria-label={t('leftLabel', undefined, NS)}
      ondragover={(e) => {
        e.preventDefault();
        leftDrag = true;
      }}
      ondragleave={() => (leftDrag = false)}
      ondrop={(e) => onSideDrop('left', e)}
    >
      <div class="df-pane__bar">
        <label class="df-pane__label" for="pk-df-left">{t('leftLabel', undefined, NS)}</label>
        <div class="df-pane__actions">
          {#if leftFile}
            <span class="glass df-file-pill mono">
              {leftFile.fileName} · {formatBytes(leftFile.byteLength)}
            </span>
            <Button variant="ghost" size="sm" onclick={() => clearSideFile('left')}>
              <Icon name="x" size="xs" />
              <span>{t('common.clear')}</span>
            </Button>
          {:else}
            <span class="df-pane__hint">{t('dropHint', undefined, NS)}</span>
          {/if}
          <Button variant="secondary" size="sm" onclick={() => leftPickerEl?.click()}>
            <Icon name="upload" size="xs" />
            <span>{t('pickFile', undefined, NS)}</span>
          </Button>
        </div>
      </div>

      {#if !leftFile?.isBinary}
        <TextArea
          id="pk-df-left"
          bind:value={left}
          rows={6}
          mono
          oninput={() => {
            if (leftFile) leftFile = null;
          }}
        />
      {/if}
    </div>

    <!-- Right pane -->
    <div
      class="df-pane"
      data-drag={rightDrag ? 'true' : undefined}
      role="region"
      aria-label={t('rightLabel', undefined, NS)}
      ondragover={(e) => {
        e.preventDefault();
        rightDrag = true;
      }}
      ondragleave={() => (rightDrag = false)}
      ondrop={(e) => onSideDrop('right', e)}
    >
      <div class="df-pane__bar">
        <label class="df-pane__label" for="pk-df-right">{t('rightLabel', undefined, NS)}</label>
        <div class="df-pane__actions">
          {#if rightFile}
            <span class="glass df-file-pill mono">
              {rightFile.fileName} · {formatBytes(rightFile.byteLength)}
            </span>
            <Button variant="ghost" size="sm" onclick={() => clearSideFile('right')}>
              <Icon name="x" size="xs" />
              <span>{t('common.clear')}</span>
            </Button>
          {:else}
            <span class="df-pane__hint">{t('dropHint', undefined, NS)}</span>
          {/if}
          <Button variant="secondary" size="sm" onclick={() => rightPickerEl?.click()}>
            <Icon name="upload" size="xs" />
            <span>{t('pickFile', undefined, NS)}</span>
          </Button>
        </div>
      </div>

      {#if !rightFile?.isBinary}
        <TextArea
          id="pk-df-right"
          bind:value={right}
          rows={6}
          mono
          oninput={() => {
            if (rightFile) rightFile = null;
          }}
        />
      {/if}
    </div>
  </div>

  {#if binaryMode}
    <div class="glass df-binary" data-testid="diff-binary-panel">
      <div class="df-binary__head">
        <span class="df-head__label">{t('binaryTitle', undefined, NS)}</span>
        {#if leftFile && rightFile}
          {#if binaryEqual}
            <Badge tone="success" dot>{t('binaryIdentical', undefined, NS)}</Badge>
          {:else}
            <Badge tone="warning" dot>{t('binaryDifferent', undefined, NS)}</Badge>
          {/if}
        {/if}
      </div>
      <p class="df-binary__hint">{t('binaryHint', undefined, NS)}</p>

      {#if leftFile && rightFile}
        <div class="df-binary__grid mono">
          <div class="plate df-binary__card">
            <strong>{leftFile.fileName}</strong>
            <span>{t('sizeLabel', undefined, NS)}: {formatBytes(leftFile.byteLength)} ({leftFile.byteLength} B)</span>
            <span>{t('sha256Label', undefined, NS)}: {leftFile.sha256Hex}</span>
          </div>
          <div class="plate df-binary__card">
            <strong>{rightFile.fileName}</strong>
            <span>{t('sizeLabel', undefined, NS)}: {formatBytes(rightFile.byteLength)} ({rightFile.byteLength} B)</span>
            <span>{t('sha256Label', undefined, NS)}: {rightFile.sha256Hex}</span>
          </div>
        </div>
      {:else}
        <p class="df-binary__hint">{t('binaryMissingPeer', undefined, NS)}</p>
      {/if}
    </div>
  {:else}
    <div class="df-controls">
      <div class="df-controls__left">
        <Segmented
          size="sm"
          ariaLabel={t('resultLabel', undefined, NS)}
          bind:value={viewMode}
          options={[
            { value: 'unified', label: t('viewUnified', undefined, NS) },
            { value: 'split', label: t('viewSplit', undefined, NS) },
          ]}
        />
        <Switch bind:checked={collapseUnchanged} label={t('collapseUnchanged', undefined, NS)} />
        <Switch
          bind:checked={ignoreTrailingWhitespace}
          label={t('ignoreTrailingWs', undefined, NS)}
        />
      </div>

      <div class="df-head__badges">
        {#if diff.approximated}
          <Badge tone="warning">{t('approximatedNotice', undefined, NS)}</Badge>
        {/if}
        {#if diff.added === 0 && diff.removed === 0}
          <Badge tone="success" dot>{t('identical', undefined, NS)}</Badge>
        {:else}
          <Badge tone="warning">
            {t('stats', { added: diff.added, removed: diff.removed }, NS)}
          </Badge>
        {/if}
      </div>
    </div>

    {#if viewMode === 'unified'}
      <div class="glass df-view mono" data-testid="diff-unified-view">
        {#each unifiedRows as row, idx (idx)}
          {#if row.type === 'collapsed'}
            <div class="df-collapsed">
              {t('collapsedLines', { count: row.hiddenCount }, NS)}
            </div>
          {:else}
            <div class="df-line" data-kind={row.line.kind}>
              <span class="df-line__num">{row.line.oldLineNo ?? ''}</span>
              <span class="df-line__num">{row.line.newLineNo ?? ''}</span>
              <span class="df-line__sig">
                {row.line.kind === 'insert' ? '+' : row.line.kind === 'delete' ? '-' : ' '}
              </span>
              <span class="df-line__code">
                {#if row.line.inline}
                  {#each row.line.inline as seg, sIdx (sIdx)}
                    <span class="df-seg" data-seg={seg.kind}>{seg.text}</span>
                  {/each}
                {:else}
                  {row.line.text}
                {/if}
              </span>
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="glass df-view df-view--split mono" data-testid="diff-split-view">
        {#each splitRows as row, idx (idx)}
          {#if row.type === 'collapsed'}
            <div class="df-collapsed">
              {t('collapsedLines', { count: row.hiddenCount }, NS)}
            </div>
          {:else}
            <div class="df-split-row">
              <div class="df-split-cell" data-kind={row.left?.kind ?? 'empty'}>
                <span class="df-line__num">{row.left?.oldLineNo ?? ''}</span>
                <span class="df-line__sig">
                  {row.left?.kind === 'delete' ? '-' : ' '}
                </span>
                <span class="df-line__code">
                  {#if row.left?.inline}
                    {#each row.left.inline as seg, sIdx (sIdx)}
                      <span class="df-seg" data-seg={seg.kind}>{seg.text}</span>
                    {/each}
                  {:else}
                    {row.left?.text ?? ''}
                  {/if}
                </span>
              </div>

              <div class="df-split-cell df-split-cell--right" data-kind={row.right?.kind ?? 'empty'}>
                <span class="df-line__num">{row.right?.newLineNo ?? ''}</span>
                <span class="df-line__sig">
                  {row.right?.kind === 'insert' ? '+' : ' '}
                </span>
                <span class="df-line__code">
                  {#if row.right?.inline}
                    {#each row.right.inline as seg, sIdx (sIdx)}
                      <span class="df-seg" data-seg={seg.kind}>{seg.text}</span>
                    {/each}
                  {:else}
                    {row.right?.text ?? ''}
                  {/if}
                </span>
              </div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .df-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .df-inputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }

  .df-pane {
    display: flex;
    flex-direction: column;
    gap: 0.4375rem;
    border-radius: var(--r-glass);
    transition: box-shadow 0.14s;
  }

  .df-pane[data-drag='true'] {
    box-shadow: 0 0 0 2px var(--mint);
  }

  .df-pane__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .df-pane__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .df-pane__actions {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .df-pane__hint {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .df-file-pill {
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    color: var(--amber);
    max-width: 15rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .df-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .df-controls__left {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .df-head__label {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .df-head__badges {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .df-view {
    padding: 0.375rem 0;
    overflow-x: auto;
    font-size: 0.8125rem;
    line-height: 1.55;
  }

  .df-collapsed {
    padding: 0.25rem 0.75rem;
    text-align: center;
    font-size: 0.75rem;
    color: var(--ink-3);
    background: var(--groove);
    user-select: none;
  }

  .df-line {
    display: grid;
    grid-template-columns: 2.5rem 2.5rem 1.25rem minmax(0, 1fr);
    padding: 0.0625rem 0.75rem;
    white-space: pre;
  }

  .df-split-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .df-split-cell {
    display: grid;
    grid-template-columns: 2.5rem 1.25rem minmax(0, 1fr);
    padding: 0.0625rem 0.625rem;
    white-space: pre;
    overflow-x: auto;
  }

  .df-split-cell--right {
    border-left: 1px solid var(--hairline);
  }

  .df-line[data-kind='insert'],
  .df-split-cell[data-kind='insert'] {
    background: var(--mint-soft);
    color: var(--mint);
  }

  .df-line[data-kind='delete'],
  .df-split-cell[data-kind='delete'] {
    background: var(--fault-soft);
    color: var(--fault);
  }

  .df-split-cell[data-kind='empty'] {
    background: var(--groove);
  }

  .df-line__num {
    color: var(--ink-3);
    font-size: 0.6875rem;
    text-align: right;
    padding-right: 0.5rem;
    user-select: none;
  }

  .df-line__sig {
    user-select: none;
    font-weight: 700;
  }

  .df-seg[data-seg='insert'] {
    background: rgb(114 230 201 / 0.28);
    border-radius: 2px;
  }

  .df-seg[data-seg='delete'] {
    background: rgb(242 111 89 / 0.3);
    border-radius: 2px;
  }

  .df-binary {
    padding: 1rem 1.125rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .df-binary__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .df-binary__hint {
    font-size: 0.78125rem;
    color: var(--ink-3);
  }

  .df-binary__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .df-binary__card {
    padding: 0.75rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.75rem;
    word-break: break-all;
  }

  .df-binary__card strong {
    color: var(--ink);
    font-size: 0.8125rem;
  }

  .df-binary__card span {
    color: var(--ink-2);
  }

  @media (max-width: 860px) {
    .df-inputs,
    .df-binary__grid,
    .df-split-row {
      grid-template-columns: minmax(0, 1fr);
    }
    .df-split-cell--right {
      border-left: 0;
      border-top: 1px solid var(--hairline);
    }
  }
</style>
