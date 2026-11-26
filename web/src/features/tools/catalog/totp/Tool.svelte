<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Badge, CopyButton, Field, Input, Meter, Segmented, Select } from '../../../../ui';
  import {
    computeTotpWindow,
    formatOtpDisplay,
    parseOtpInput,
    type TotpAlgorithm,
    type TotpDigits,
  } from './logic';

  const NS = 'tool:totp';

  // Sample test key (never persisted to localStorage)
  let rawInput = $state(
    'otpauth://totp/Homelab:admin@pikbay.example.ts.net?secret=JBSWY3DPEHPK3PXP&issuer=Homelab'
  );
  let algorithm = $state<TotpAlgorithm>('SHA-1');
  let digitsStr = $state<'6' | '8'>('6');
  let periodStr = $state('30');
  let nowMs = $state(Date.now());

  $effect(() => {
    const id = window.setInterval(() => {
      nowMs = Date.now();
    }, 500);
    return () => window.clearInterval(id);
  });

  const hasUriOverrides = $derived.by(() => {
    try {
      const p = parseOtpInput(rawInput);
      return Boolean(p.algorithm || p.digits || p.period);
    } catch {
      return false;
    }
  });

  const periodNum = $derived.by(() => {
    const n = Number(periodStr);
    return Number.isFinite(n) && n >= 5 && n <= 3600 ? Math.floor(n) : 30;
  });

  const result = $derived(
    computeTotpWindow({
      rawInput,
      algorithm,
      digits: (digitsStr === '8' ? 8 : 6) as TotpDigits,
      period: periodNum,
      nowMs,
    })
  );
</script>

<div class="totp-bench">
  <Field
    label={t('secretLabel', undefined, NS)}
    forId="pk-totp-secret"
    error={!result.ok ? result.error : undefined}
  >
    <Input
      id="pk-totp-secret"
      bind:value={rawInput}
      placeholder={t('secretPlaceholder', undefined, NS)}
      mono
      clearable
      invalid={!result.ok}
    />
  </Field>

  <div class="totp-controls">
    <div class="totp-controls__item">
      <Field label={t('algorithmLabel', undefined, NS)} forId="pk-totp-alg">
        <Select
          name="totp-alg"
          ariaLabel={t('algorithmLabel', undefined, NS)}
          bind:value={algorithm}
          options={[
            { value: 'SHA-1', label: 'SHA-1 (Default)' },
            { value: 'SHA-256', label: 'SHA-256' },
            { value: 'SHA-512', label: 'SHA-512' },
          ]}
        />
      </Field>
    </div>

    <div class="totp-controls__item">
      <span class="totp-controls__lbl">{t('digitsLabel', undefined, NS)}</span>
      <Segmented
        size="sm"
        ariaLabel={t('digitsLabel', undefined, NS)}
        bind:value={digitsStr}
        options={[
          { value: '6', label: '6' },
          { value: '8', label: '8' },
        ]}
      />
    </div>

    <div class="totp-controls__period">
      <Field label={t('periodLabel', undefined, NS)} forId="pk-totp-period">
        <Input id="pk-totp-period" type="number" bind:value={periodStr} mono />
      </Field>
    </div>

    {#if hasUriOverrides}
      <div class="totp-controls__badge">
        <Badge tone="info">{t('uriOverrideNote', undefined, NS)}</Badge>
      </div>
    {/if}
  </div>

  {#if result.ok}
    {#if result.issuer || result.account}
      <div class="totp-identity">
        {#if result.issuer}
          <Badge tone="accent">{result.issuer}</Badge>
        {/if}
        {#if result.account}
          <span class="mono totp-identity__acct">{result.account}</span>
        {/if}
      </div>
    {/if}

    <div class="totp-cards">
      <div class="glass totp-card totp-card--side">
        <div class="totp-card__head">
          <span>{t('prevWindow', undefined, NS)}</span>
          <CopyButton text={result.previous} />
        </div>
        <div class="totp-card__code mono" data-testid="totp-prev-code">
          {formatOtpDisplay(result.previous)}
        </div>
      </div>

      <div class="glass totp-card totp-card--current">
        <div class="totp-card__head">
          <span>{t('currentWindow', undefined, NS)}</span>
          <CopyButton text={result.current} />
        </div>
        <div class="totp-card__code totp-card__code--primary mono" data-testid="totp-current-code">
          {formatOtpDisplay(result.current)}
        </div>
      </div>

      <div class="glass totp-card totp-card--side">
        <div class="totp-card__head">
          <span>{t('nextWindow', undefined, NS)}</span>
          <CopyButton text={result.next} />
        </div>
        <div class="totp-card__code mono" data-testid="totp-next-code">
          {formatOtpDisplay(result.next)}
        </div>
      </div>
    </div>

    <div class="glass totp-meter-wrap">
      <Meter
        label={t('countdownLabel', undefined, NS)}
        percent={(result.remainingSeconds / result.period) * 100}
        tone={result.remainingSeconds <= 5 ? 'danger' : 'success'}
        valueText={t(
          'countdownValue',
          { seconds: result.remainingSeconds, counter: String(result.counter) },
          NS
        )}
      />
    </div>
  {/if}
</div>

<style>
  .totp-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .totp-controls {
    display: flex;
    align-items: flex-end;
    gap: 0.875rem;
    flex-wrap: wrap;
  }

  .totp-controls__item {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 9.5rem;
  }

  .totp-controls__period {
    width: 7.5rem;
  }

  .totp-controls__lbl {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .totp-controls__badge {
    padding-bottom: 0.25rem;
  }

  .totp-identity {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .totp-identity__acct {
    font-size: 0.8125rem;
    color: var(--ink-2);
  }

  .totp-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.875rem;
    align-items: stretch;
  }

  .totp-card {
    padding: 0.875rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .totp-card--current {
    box-shadow:
      inset 0 0 0 1px var(--amber),
      inset 0 2px 6px var(--glass-shadow);
  }

  .totp-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
  }

  .totp-card__code {
    font-size: 1.5rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-align: center;
    color: var(--ink-2);
    padding: 0.375rem 0;
  }

  .totp-card__code--primary {
    font-size: 2rem;
    color: var(--amber);
  }

  .totp-meter-wrap {
    padding: 0.8125rem 1rem;
  }

  @media (max-width: 760px) {
    .totp-cards {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
