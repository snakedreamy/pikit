<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Button, Field, Segmented, TextArea } from '../../../../ui';
  import { buildQrCode, type QrEccLevel } from './logic';

  const NS = 'tool:qrcode';

  let text = $state('https://pikbay.example.ts.net');
  let ecc = $state<QrEccLevel>('M');
  let borderStr = $state<'1' | '2' | '4'>('2');

  const qr = $derived(buildQrCode(text, ecc, Number(borderStr)));

  function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadSvg() {
    if (!qr.ok) return;
    const blob = new Blob([qr.data.svgDocument], {
      type: 'image/svg+xml;charset=utf-8',
    });
    triggerBlobDownload(blob, 'pikbay-qrcode.svg');
  }

  function downloadPng() {
    if (!qr.ok) return;
    const scale = 12;
    const dim = qr.data.size * scale;
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#090b0d';

    for (let y = 0; y < qr.data.size; y++) {
      const row = qr.data.modules[y];
      for (let x = 0; x < qr.data.size; x++) {
        if (row[x]) {
          ctx.fillRect(x * scale, y * scale, scale, scale);
        }
      }
    }

    canvas.toBlob((blob) => {
      if (blob) triggerBlobDownload(blob, 'pikbay-qrcode.png');
    }, 'image/png');
  }
</script>

<div class="qr-bench">
  <div class="qr-left">
    <Field
      label={t('inputLabel', undefined, NS)}
      forId="pk-qr-input"
      error={!qr.ok && !qr.empty ? t('tooLong', undefined, NS) : undefined}
    >
      <TextArea
        id="pk-qr-input"
        bind:value={text}
        rows={5}
        mono
        invalid={!qr.ok && !qr.empty}
      />
    </Field>

    <div class="qr-controls">
      <div class="qr-ctrl">
        <span class="qr-label">{t('eccLabel', undefined, NS)}</span>
        <Segmented
          size="sm"
          ariaLabel={t('eccLabel', undefined, NS)}
          bind:value={ecc}
          options={[
            { value: 'L', label: 'L (7%)' },
            { value: 'M', label: 'M (15%)' },
            { value: 'Q', label: 'Q (25%)' },
            { value: 'H', label: 'H (30%)' },
          ]}
        />
      </div>

      <div class="qr-ctrl">
        <span class="qr-label">{t('borderLabel', undefined, NS)}</span>
        <Segmented
          size="sm"
          ariaLabel={t('borderLabel', undefined, NS)}
          bind:value={borderStr}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '4', label: '4' },
          ]}
        />
      </div>
    </div>

    {#if qr.ok}
      <div class="qr-footer">
        <span class="qr-meta mono">
          {t(
            'metaInfo',
            {
              version: qr.data.version,
              size: qr.data.size,
              bytes: qr.data.utf8Bytes,
            },
            NS
          )}
        </span>

        <div class="qr-actions">
          <Button variant="secondary" size="sm" onclick={downloadSvg}>
            {t('downloadSvg', undefined, NS)}
          </Button>
          <Button variant="primary" size="sm" onclick={downloadPng}>
            {t('downloadPng', undefined, NS)}
          </Button>
        </div>
      </div>
    {/if}
  </div>

  <div class="glass qr-stage">
    {#if qr.ok}
      <div class="qr-plate">
        <svg
          class="qr-svg"
          viewBox="0 0 {qr.data.size} {qr.data.size}"
          shape-rendering="crispEdges"
          role="img"
          aria-label={t('previewLabel', undefined, NS)}
        >
          <rect width={qr.data.size} height={qr.data.size} fill="#ffffff" />
          <path d={qr.data.svgPath} fill="#090b0d" />
        </svg>
      </div>
    {:else}
      <p class="qr-empty">{t('emptyHint', undefined, NS)}</p>
    {/if}
  </div>
</div>

<style>
  .qr-bench {
    display: grid;
    grid-template-columns: minmax(0, 1.35fr) minmax(14rem, 1fr);
    gap: 1.25rem;
    align-items: stretch;
  }

  .qr-left {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .qr-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .qr-ctrl {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .qr-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .qr-footer {
    margin-top: auto;
    padding-top: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .qr-meta {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .qr-actions {
    display: flex;
    gap: 0.5rem;
  }

  .qr-stage {
    padding: 1.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 15.5rem;
  }

  .qr-plate {
    width: min(100%, 14rem);
    aspect-ratio: 1 / 1;
    padding: 0.5rem;
    border-radius: 0.5rem;
    background: #ffffff;
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.32);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .qr-svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .qr-empty {
    font-size: 0.8125rem;
    color: var(--ink-3);
    text-align: center;
  }

  @media (max-width: 820px) {
    .qr-bench {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
