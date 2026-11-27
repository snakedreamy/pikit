<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Button, CodeBlock, Field, Input, Select } from '../../../../ui';
  import {
    formatBasicAuthSnippets,
    generateBcryptHashSync,
    verifyBcryptHashSync,
    type BcryptGenerateOutput,
    type BcryptVerifyOutput,
  } from './logic';
  import type { BcryptWorkerResponse } from './worker';

  const NS = 'tool:bcrypt';

  let username = $state('admin');
  let password = $state('');
  let roundsStr = $state('10');
  let computingGen = $state(false);
  let genResult = $state<BcryptGenerateOutput | null>(null);

  let verifyHash = $state('');
  let verifyPassword = $state('');
  let verifyResult = $state<BcryptVerifyOutput | null>(null);

  let workerRef: Worker | null = null;
  let reqSeq = 0;
  let latestGenId = 0;
  let latestVerifyId = 0;

  function getWorker(): Worker | null {
    if (typeof Worker === 'undefined') return null;
    if (!workerRef) {
      workerRef = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      workerRef.onmessage = (ev: MessageEvent<BcryptWorkerResponse>) => {
        const data = ev.data;
        if (data.op === 'generate' && data.id === latestGenId) {
          computingGen = false;
          genResult = data.result;
          if (!verifyHash) {
            verifyHash = data.result.hash;
            runVerify(verifyPassword, data.result.hash);
          }
        } else if (data.op === 'verify' && data.id === latestVerifyId) {
          verifyResult = data.result;
        }
      };
    }
    return workerRef;
  }

  function runGenerate() {
    if (!password) {
      genResult = null;
      return;
    }
    const rounds = Number(roundsStr) || 10;
    const w = getWorker();
    if (!w) {
      genResult = generateBcryptHashSync(password, rounds, username);
      if (!verifyHash) verifyHash = genResult.hash;
      return;
    }
    computingGen = true;
    latestGenId = ++reqSeq;
    w.postMessage({
      id: latestGenId,
      op: 'generate',
      password,
      rounds,
      username,
    });
  }

  function runVerify(candPass: string, target: string) {
    if (!target.trim()) {
      verifyResult = null;
      return;
    }
    const w = getWorker();
    if (!w) {
      verifyResult = verifyBcryptHashSync(candPass, target);
      return;
    }
    latestVerifyId = ++reqSeq;
    w.postMessage({
      id: latestVerifyId,
      op: 'verify',
      password: candPass,
      hash: target,
    });
  }

  onMount(() => {
    return () => {
      workerRef?.terminate();
      workerRef = null;
    };
  });

  const liveSnippets = $derived(
    genResult ? formatBasicAuthSnippets(username, genResult.hash) : null
  );
</script>

<div class="bc-bench">
  <!-- Generate Hash & Basic Auth section -->
  <section class="bc-section">
    <div class="bc-section__head">
      <h3>{t('genSection', undefined, NS)}</h3>
      {#if genResult?.truncated72Bytes}
        <Badge tone="warning">{t('truncateWarn', undefined, NS)}</Badge>
      {/if}
    </div>

    <div class="bc-gen-row">
      <div class="bc-gen-row__user">
        <Field label={t('userLabel', undefined, NS)} forId="pk-bc-user">
          <Input id="pk-bc-user" bind:value={username} mono />
        </Field>
      </div>

      <div class="bc-gen-row__pass">
        <Field label={t('passLabel', undefined, NS)} forId="pk-bc-pass">
          <Input
            id="pk-bc-pass"
            bind:value={password}
            placeholder={t('passPlaceholder', undefined, NS)}
            mono
          />
        </Field>
      </div>

      <div class="bc-gen-row__rounds">
        <Field label={t('roundsLabel', undefined, NS)} forId="pk-bc-rounds">
          <Select
            name="bc-rounds"
            ariaLabel={t('roundsLabel', undefined, NS)}
            bind:value={roundsStr}
            options={[
              { value: '8', label: '8 (Fast)' },
              { value: '10', label: '10 (Standard)' },
              { value: '12', label: '12 (Recommended)' },
              { value: '13', label: '13 (High)' },
              { value: '14', label: '14 (Paranoid)' },
            ]}
          />
        </Field>
      </div>

      <div class="bc-gen-row__btn">
        <Button variant="primary" onclick={runGenerate} disabled={computingGen || !password}>
          {computingGen ? t('computing', undefined, NS) : t('generateBtn', undefined, NS)}
        </Button>
      </div>
    </div>

    {#if genResult && liveSnippets}
      <CodeBlock
        label={t('hashLabel', undefined, NS)}
        meta={t('computedMeta', { ms: genResult.elapsedMs, rounds: roundsStr }, NS)}
        code={genResult.hash}
      />

      <div class="bc-snippets">
        <CodeBlock label={t('htpasswdLabel', undefined, NS)} code={liveSnippets.htpasswdLine} />
        <CodeBlock label={t('caddyLabel', undefined, NS)} code={liveSnippets.caddySnippet} />
      </div>
    {/if}
  </section>

  <!-- Verify section -->
  <section class="bc-section bc-section--verify">
    <div class="bc-section__head">
      <h3>{t('verifySection', undefined, NS)}</h3>
      {#if verifyResult}
        {#if !verifyResult.validFormat}
          <Badge tone="danger">{t('invalidHash', undefined, NS)}</Badge>
        {:else if verifyResult.matched}
          <Badge tone="success" dot>
            {t('matchOk', { rounds: verifyResult.rounds ?? 0, ms: verifyResult.elapsedMs }, NS)}
          </Badge>
        {:else}
          <Badge tone="warning" dot>
            {t('matchFail', { rounds: verifyResult.rounds ?? 0, ms: verifyResult.elapsedMs }, NS)}
          </Badge>
        {/if}
      {/if}
    </div>

    <div class="bc-verify-grid">
      <Field label={t('verifyHashLabel', undefined, NS)} forId="pk-bc-vhash">
        <Input
          id="pk-bc-vhash"
          bind:value={verifyHash}
          mono
          invalid={Boolean(verifyResult && !verifyResult.validFormat)}
          oninput={() => runVerify(verifyPassword, verifyHash)}
        />
      </Field>
      <Field label={t('verifyPassLabel', undefined, NS)} forId="pk-bc-vpass">
        <Input
          id="pk-bc-vpass"
          bind:value={verifyPassword}
          mono
          oninput={() => runVerify(verifyPassword, verifyHash)}
        />
      </Field>
    </div>
  </section>
</div>

<style>
  .bc-bench {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .bc-section {
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .bc-section--verify {
    padding-top: 1.125rem;
    border-top: 1px solid var(--hairline);
  }

  .bc-section__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .bc-section__head h3 {
    font-size: 0.875rem;
    font-weight: 650;
    color: var(--ink);
  }

  .bc-gen-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .bc-gen-row__user {
    width: 11rem;
  }

  .bc-gen-row__pass {
    flex: 1;
    min-width: 14rem;
  }

  .bc-gen-row__rounds {
    width: 11rem;
  }

  .bc-gen-row__btn {
    display: flex;
  }

  .bc-snippets,
  .bc-verify-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.875rem;
  }

  @media (max-width: 860px) {
    .bc-snippets,
    .bc-verify-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
