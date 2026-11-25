<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { CopyButton, Field, TextArea } from '../../../../ui';
  import { computeTextStats, convertAllCases } from './logic';

  const NS = 'tool:text-case';

  let raw = $state('parseHttpHeader_v2Config');

  const stats = $derived(computeTextStats(raw));
  const cases = $derived(convertAllCases(raw));
  const caseEntries = $derived(Object.entries(cases));
</script>

<div class="tc-bench">
  <Field label={t('inputLabel', undefined, NS)} forId="pk-tc-input">
    <TextArea id="pk-tc-input" bind:value={raw} rows={4} mono />
  </Field>

  <div class="tc-stats">
    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statChars', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.chars}</strong>
    </div>
    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statNoSpace', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.charsNoSpaces}</strong>
    </div>
    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statBytes', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.utf8Bytes}</strong>
    </div>
    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statWords', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.words}</strong>
    </div>
    <div class="glass tc-stat">
      <span class="tc-stat__label">{t('statLines', undefined, NS)}</span>
      <strong class="tc-stat__val mono">{stats.lines}</strong>
    </div>
  </div>

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

  .tc-stats {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .tc-stat {
    padding: 0.6875rem 0.8125rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tc-stat__label {
    font-size: 0.6875rem;
    color: var(--ink-3);
  }

  .tc-stat__val {
    font-size: 1.125rem;
    font-weight: 700;
    color: var(--amber);
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

  @media (max-width: 820px) {
    .tc-stats {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .tc-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
