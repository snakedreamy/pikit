<script lang="ts">
  import type { DropLimitsMeta } from '../../lib/api';
  import { wipeBytes } from '../../lib/crypto';
  import { formatBytes, registerLocaleGlob, t, type MessageTree } from '../../lib/i18n/index.svelte';
  import {
    Badge,
    Button,
    CodeBlock,
    CopyButton,
    EmptyState,
    Field,
    Icon,
    Meter,
    TextArea,
  } from '../../ui';
  import {
    formatSixDigitCode,
    isValidSixDigitCode,
    normalizeSixDigitCode,
    sanitizeTransferFileName,
    type DropTransferMeta,
  } from './protocol';
  import {
    startDropReceiveSession,
    startDropSendSession,
    type DropErrorCode,
    type DropReceivePhase,
    type DropSendPhase,
    type DropSessionHandle,
    type ReceivedDropResult,
  } from './session';

  registerLocaleGlob(
    'drop',
    import.meta.glob<{ default: MessageTree }>('./locales/*.json', { eager: true })
  );

  const NS = 'drop';

  export interface DropPreviewSample {
    code: string;
    ttlRemaining: number;
    ttlTotal: number;
    transport: 'p2p' | 'relay';
    fingerprint: string;
    fileName: string;
    fileBytes: number;
    receivedText: string;
  }

  interface Props {
    dropLimits?: DropLimitsMeta;
    previewSample?: DropPreviewSample;
    onunauthorized?: () => void;
  }

  let { dropLimits, previewSample, onunauthorized }: Props = $props();

  const configuredTtl = $derived(dropLimits?.codeTtlSeconds ?? 180);
  const configuredMaxRelayMb = $derived(dropLimits?.maxRelayMb ?? 256);

  // --- Send Bay state ---
  let sendText = $state('');
  let sendFile = $state<{ blob: Blob; name: string; mime: string } | null>(null);
  let dragActive = $state(false);
  let fileInputEl: HTMLInputElement | undefined = $state();

  let sendPhase = $state<DropSendPhase>('waiting');
  let sendActive = $state(false);
  let issuedCode = $state('');
  let ttlTotal = $state(180);
  let ttlRemaining = $state(180);
  let sendTransport = $state<'p2p' | 'relay' | null>(null);
  let sendFingerprint = $state('');
  let sendProgressBytes = $state(0);
  let sendTotalBytes = $state(0);
  let sendError = $state<DropErrorCode | 'emptyPayload' | null>(null);
  let sendHandle: DropSessionHandle | null = null;
  let ttlInterval = 0;

  // --- Receive Bay state ---
  let joinInputRaw = $state('');
  let receivePhase = $state<DropReceivePhase>('connecting');
  let receiveActive = $state(false);
  let receiveTransport = $state<'p2p' | 'relay' | null>(null);
  let receiveFingerprint = $state('');
  let incomingMeta = $state<DropTransferMeta | null>(null);
  let receiveProgressBytes = $state(0);
  let receiveTotalBytes = $state(0);
  let receivedPayload = $state<ReceivedDropResult | null>(null);
  let receiveError = $state<DropErrorCode | null>(null);
  let receiveHandle: DropSessionHandle | null = null;

  // Hydrate deterministic non-network preview sample for `/dev/ui?view=drop`
  $effect(() => {
    if (!previewSample) return;
    sendActive = true;
    sendPhase = 'waiting';
    issuedCode = previewSample.code;
    ttlTotal = previewSample.ttlTotal;
    ttlRemaining = previewSample.ttlRemaining;
    sendTransport = previewSample.transport;
    sendFingerprint = previewSample.fingerprint;
    sendFile = {
      blob: new Blob([new Uint8Array(16)]),
      name: previewSample.fileName,
      mime: 'application/zstd',
    };
    sendTotalBytes = previewSample.fileBytes;
    receiveActive = true;
    receivePhase = 'completed';
    receiveTransport = previewSample.transport;
    receiveFingerprint = previewSample.fingerprint;
    receivedPayload = {
      kind: 'text',
      text: previewSample.receivedText,
      mimeType: 'text/plain;charset=utf-8',
      totalBytes: new TextEncoder().encode(previewSample.receivedText).byteLength,
      chunks: [],
    };
  });

  function stopTtlCountdown() {
    if (ttlInterval) {
      window.clearInterval(ttlInterval);
      ttlInterval = 0;
    }
  }

  function startTtlCountdown(seconds: number) {
    stopTtlCountdown();
    ttlTotal = seconds;
    ttlRemaining = seconds;
    const deadline = Date.now() + seconds * 1000;
    ttlInterval = window.setInterval(() => {
      const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      ttlRemaining = rem;
      if (rem <= 0) {
        stopTtlCountdown();
      }
    }, 250);
  }

  function wipeReceivedBuffers() {
    if (receivedPayload) {
      for (const c of receivedPayload.chunks) {
        wipeBytes(c);
      }
      receivedPayload = null;
    }
  }

  function resetSendBay() {
    stopTtlCountdown();
    sendHandle?.cancel();
    sendHandle = null;
    sendActive = false;
    issuedCode = '';
    sendTransport = null;
    sendFingerprint = '';
    sendProgressBytes = 0;
    sendTotalBytes = 0;
    sendError = null;
  }

  function resetReceiveBay() {
    receiveHandle?.cancel();
    receiveHandle = null;
    wipeReceivedBuffers();
    receiveActive = false;
    joinInputRaw = '';
    receiveTransport = null;
    receiveFingerprint = '';
    incomingMeta = null;
    receiveProgressBytes = 0;
    receiveTotalBytes = 0;
    receiveError = null;
  }

  $effect(() => {
    return () => {
      stopTtlCountdown();
      sendHandle?.cancel();
      receiveHandle?.cancel();
      wipeReceivedBuffers();
    };
  });

  function attachFile(file: File) {
    const safeName = sanitizeTransferFileName(file.name || 'clipboard-capture.png');
    sendFile = {
      blob: file,
      name: safeName,
      mime: file.type || 'application/octet-stream',
    };
    sendError = null;
  }

  function handleFilePickerChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    if (file) attachFile(file);
    target.value = '';
  }

  function handleWindowPaste(e: ClipboardEvent) {
    if (previewSample || (sendActive && sendPhase !== 'error' && sendPhase !== 'completed')) return;
    const files = e.clipboardData?.files;
    if (files && files.length > 0) {
      e.preventDefault();
      if (sendActive) resetSendBay();
      attachFile(files[0]);
    }
  }

  function handleDropOver(e: DragEvent) {
    e.preventDefault();
    if (!sendActive || sendPhase === 'error' || sendPhase === 'completed') {
      dragActive = true;
    }
  }

  function handleDropLeave() {
    dragActive = false;
  }

  function handleDropFile(e: DragEvent) {
    e.preventDefault();
    dragActive = false;
    if (sendActive && sendPhase !== 'error' && sendPhase !== 'completed') return;
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      if (sendActive) resetSendBay();
      attachFile(file);
    }
  }

  function startSend() {
    if (previewSample) return;
    resetSendBay();

    if (!sendFile && sendText.trim().length === 0) {
      sendError = 'emptyPayload';
      return;
    }

    const outgoing = sendFile
      ? {
          kind: 'file' as const,
          blob: sendFile.blob,
          fileName: sendFile.name,
          mimeType: sendFile.mime,
        }
      : {
          kind: 'text' as const,
          text: sendText,
        };

    sendActive = true;
    sendPhase = 'connecting';
    sendError = null;

    sendHandle = startDropSendSession(outgoing, {
      onPhaseChange(next) {
        sendPhase = next;
        if (next !== 'waiting') stopTtlCountdown();
      },
      onCodeIssued(code, ttlSeconds) {
        issuedCode = code;
        startTtlCountdown(ttlSeconds || configuredTtl);
      },
      onTransportSelected(mode, fp) {
        sendTransport = mode;
        sendFingerprint = fp;
      },
      onProgress(sent, total) {
        sendProgressBytes = sent;
        sendTotalBytes = total;
      },
      onError(errCode) {
        stopTtlCountdown();
        sendError = errCode;
      },
      onUnauthorized: onunauthorized,
    });
  }

  function triggerJoinWithCode(digits: string) {
    if (previewSample || !isValidSixDigitCode(digits)) return;
    receiveHandle?.cancel();
    wipeReceivedBuffers();

    joinInputRaw = formatSixDigitCode(digits);
    receiveActive = true;
    receivePhase = 'connecting';
    receiveError = null;
    receiveTransport = null;
    receiveFingerprint = '';
    incomingMeta = null;
    receiveProgressBytes = 0;
    receiveTotalBytes = 0;

    receiveHandle = startDropReceiveSession(digits, {
      onPhaseChange(next) {
        receivePhase = next;
      },
      onTransportSelected(mode, fp) {
        receiveTransport = mode;
        receiveFingerprint = fp;
      },
      onMeta(meta) {
        incomingMeta = meta;
        receiveTotalBytes = meta.totalBytes;
      },
      onProgress(rec, total) {
        receiveProgressBytes = rec;
        receiveTotalBytes = total;
      },
      onComplete(res) {
        receivedPayload = res;
      },
      onError(errCode) {
        receiveError = errCode;
      },
      onUnauthorized: onunauthorized,
    });
  }

  function handleJoinInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const digits = normalizeSixDigitCode(el.value);
    joinInputRaw = formatSixDigitCode(digits);
  }

  function handleJoinPaste(e: ClipboardEvent) {
    const pasted = e.clipboardData?.getData('text') ?? '';
    const digits = normalizeSixDigitCode(pasted);
    if (isValidSixDigitCode(digits)) {
      e.preventDefault();
      triggerJoinWithCode(digits);
    }
  }

  function handleJoinSubmit(e: SubmitEvent) {
    e.preventDefault();
    const digits = normalizeSixDigitCode(joinInputRaw);
    if (isValidSixDigitCode(digits)) {
      triggerJoinWithCode(digits);
    }
  }

  function downloadReceivedFile() {
    if (!receivedPayload || receivedPayload.kind !== 'file') return;
    // Force `application/octet-stream` download via `<a download>` so untrusted HTML/SVG is never rendered in DOM
    const parts: BlobPart[] = receivedPayload.chunks.map((c) => {
      const copy = new Uint8Array(c.byteLength);
      copy.set(c);
      return copy;
    });
    const blob = new Blob(parts, { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sanitizeTransferFileName(receivedPayload.fileName);
    a.rel = 'noopener';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const normalizedJoinDigits = $derived(normalizeSixDigitCode(joinInputRaw));
  const activeHeaderTransport = $derived(sendTransport ?? receiveTransport);

  const sendLampColor = $derived.by(() => {
    if (!sendActive) return 'dim';
    if (sendPhase === 'error') return 'fault';
    if (sendPhase === 'completed') return 'mint';
    return 'amber';
  });

  const receiveLampColor = $derived.by(() => {
    if (!receiveActive) return 'dim';
    if (receivePhase === 'error') return 'fault';
    if (receivePhase === 'completed') return 'mint';
    return 'amber';
  });

  const sendPercent = $derived(
    sendTotalBytes > 0 ? Math.min(100, (sendProgressBytes / sendTotalBytes) * 100) : sendPhase === 'completed' ? 100 : 0
  );
  const receivePercent = $derived(
    receiveTotalBytes > 0
      ? Math.min(100, (receiveProgressBytes / receiveTotalBytes) * 100)
      : receivePhase === 'completed'
        ? 100
        : 0
  );
  const ttlPercent = $derived(ttlTotal > 0 ? Math.max(0, (ttlRemaining / ttlTotal) * 100) : 0);

  function translateDropError(err: DropErrorCode | 'emptyPayload'): string {
    return t(`errors.${err}`, { mb: configuredMaxRelayMb }, NS);
  }
</script>

<svelte:window onpaste={handleWindowPaste} />

<input
  bind:this={fileInputEl}
  type="file"
  class="sr-only"
  data-testid="drop-file-input"
  onchange={handleFilePickerChange}
/>

<div class="drop-page">
  <header class="drop-bar">
    <div class="drop-bar__title">
      <h2>{t('title', undefined, NS)}</h2>
      <p>{t('subtitle', undefined, NS)}</p>
    </div>

    <div class="drop-bar__badges">
      {#if activeHeaderTransport === 'p2p'}
        <Badge tone="success" dot>{t('transportP2p', undefined, NS)}</Badge>
      {:else if activeHeaderTransport === 'relay'}
        <Badge tone="warning" dot>{t('transportRelay', undefined, NS)}</Badge>
      {/if}
      <Badge tone="neutral">{t('cipherBadge', undefined, NS)}</Badge>
    </div>
  </header>

  <div class="drop-grid">
    <!-- Left Bay: TX / Send -->
    <section
      class="plate drop-bay"
      data-drag={dragActive ? 'true' : undefined}
      aria-label={t('sendBayTitle', undefined, NS)}
      ondragover={handleDropOver}
      ondragleave={handleDropLeave}
      ondrop={handleDropFile}
    >
      <header class="drop-bay__head">
        <div class="legend">
          <span class="lamp" data-color={sendLampColor} aria-hidden="true"></span>
          <h3>{t('sendBayTitle', undefined, NS)}</h3>
          <span class="legend__note">{t('sendBayNote', undefined, NS)}</span>
        </div>

        <Badge tone={sendFile ? 'warning' : 'neutral'}>
          {sendFile ? t('modeFile', undefined, NS) : t('modeText', undefined, NS)}
        </Badge>
      </header>

      {#if !sendActive}
        <div class="drop-bay__composer">
          {#if sendFile}
            <div class="glass drop-file-card" data-testid="drop-attached-file">
              <div class="drop-file-card__meta">
                <span class="drop-file-card__icon" aria-hidden="true">
                  <Icon name="file-text" size="md" />
                </span>
                <div class="drop-file-card__text">
                  <strong class="mono">{sendFile.name}</strong>
                  <span class="mono">
                    {formatBytes(sendFile.blob.size)} · {sendFile.mime}
                  </span>
                </div>
              </div>
              <Button variant="ghost" size="sm" onclick={() => (sendFile = null)}>
                <Icon name="trash-2" size="xs" />
                <span>{t('removeFile', undefined, NS)}</span>
              </Button>
            </div>
          {:else}
            <Field label={t('textLabel', undefined, NS)} forId="pk-drop-send-text">
              <TextArea
                id="pk-drop-send-text"
                bind:value={sendText}
                rows={6}
                mono
                placeholder={t('textPlaceholder', undefined, NS)}
              />
            </Field>
          {/if}

          <div class="drop-bay__toolbar">
            <span class="drop-bay__hint">{t('dropHint', undefined, NS)}</span>
            <Button variant="secondary" size="sm" onclick={() => fileInputEl?.click()}>
              <Icon name="upload" size="xs" />
              <span>{t('pickFile', undefined, NS)}</span>
            </Button>
          </div>

          {#if sendError}
            <div class="glass drop-alert" role="alert">
              {translateDropError(sendError)}
            </div>
          {/if}

          <div class="drop-bay__cta">
            <Button
              variant="primary"
              onclick={startSend}
              disabled={!sendFile && sendText.trim().length === 0}
            >
              <Icon name="send" size="xs" />
              <span>{t('generateCode', undefined, NS)}</span>
            </Button>
          </div>
        </div>
      {:else}
        <div class="drop-bay__active">
          {#if issuedCode}
            <div class="glass drop-code-well">
              <div class="drop-code-well__top">
                <span class="drop-code-well__label">{t('codeLabel', undefined, NS)}</span>
                <CopyButton text={issuedCode} />
              </div>
              <div class="drop-code-well__digits mono" data-testid="drop-generated-code">
                {formatSixDigitCode(issuedCode)}
              </div>
              {#if sendPhase === 'waiting'}
                <Meter
                  percent={ttlPercent}
                  tone="warning"
                  label={t('ttlRemaining', { seconds: ttlRemaining }, NS)}
                  valueText={`${ttlRemaining}s`}
                />
              {/if}
            </div>
          {/if}

          <div class="glass drop-status-well">
            <div class="drop-status-well__row">
              <span class="drop-status-well__msg">{t(`sendStatus.${sendPhase}`, undefined, NS)}</span>
              <div class="drop-status-well__pills">
                {#if sendTransport === 'p2p'}
                  <Badge tone="success">{t('transportP2p', undefined, NS)}</Badge>
                {:else if sendTransport === 'relay'}
                  <Badge tone="warning">{t('transportRelay', undefined, NS)}</Badge>
                {/if}
                {#if sendFingerprint}
                  <span class="drop-fp mono">
                    {t('fingerprintLabel', { fp: sendFingerprint }, NS)}
                  </span>
                {/if}
              </div>
            </div>

            {#if sendPhase === 'streaming' || sendPhase === 'completed'}
              <Meter
                percent={sendPercent}
                tone="success"
                label={sendFile ? sendFile.name : t('modeText', undefined, NS)}
                valueText={`${formatBytes(sendPhase === 'completed' ? sendTotalBytes : sendProgressBytes)} / ${formatBytes(sendTotalBytes)}`}
              />
            {/if}
          </div>

          {#if sendError}
            <div class="glass drop-alert" role="alert" data-testid="drop-send-error">
              {translateDropError(sendError)}
            </div>
          {/if}

          <div class="drop-bay__cta">
            {#if sendPhase === 'completed' || sendPhase === 'error'}
              <Button variant="secondary" onclick={resetSendBay}>
                <Icon name="refresh-cw" size="xs" />
                <span>{t('resetSend', undefined, NS)}</span>
              </Button>
            {:else}
              <Button variant="danger" onclick={resetSendBay}>
                <Icon name="x" size="xs" />
                <span>{t('cancelSession', undefined, NS)}</span>
              </Button>
            {/if}
          </div>
        </div>
      {/if}
    </section>

    <!-- Right Bay: RX / Receive -->
    <section class="plate drop-bay" aria-label={t('receiveBayTitle', undefined, NS)}>
      <header class="drop-bay__head">
        <div class="legend">
          <span class="lamp" data-color={receiveLampColor} aria-hidden="true"></span>
          <h3>{t('receiveBayTitle', undefined, NS)}</h3>
          <span class="legend__note">{t('receiveBayNote', undefined, NS)}</span>
        </div>

        <Badge tone="neutral">
          <Icon name="shield-check" size="xs" />
          <span>E2EE</span>
        </Badge>
      </header>

      <form class="drop-join-form" onsubmit={handleJoinSubmit}>
        <label class="drop-join-form__label" for="pk-drop-join-code">
          {t('joinCodeLabel', undefined, NS)}
        </label>
        <div class="drop-join-form__row">
          <input
            id="pk-drop-join-code"
            data-testid="drop-join-input"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="7"
            class="glass drop-join-input mono"
            placeholder={t('joinCodePlaceholder', undefined, NS)}
            value={joinInputRaw}
            disabled={receiveActive && receivePhase !== 'completed' && receivePhase !== 'error'}
            oninput={handleJoinInput}
            onpaste={handleJoinPaste}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={
              !isValidSixDigitCode(normalizedJoinDigits) ||
              (receiveActive && receivePhase !== 'completed' && receivePhase !== 'error')
            }
          >
            <Icon name="download" size="xs" />
            <span>{t('joinAction', undefined, NS)}</span>
          </Button>
        </div>
      </form>

      {#if !receiveActive}
        <div class="drop-bay__idle">
          <EmptyState
            title={t('receiveIdleTitle', undefined, NS)}
            reason={t('receiveIdleReason', undefined, NS)}
          />
        </div>
      {:else}
        <div class="drop-bay__active">
          <div class="glass drop-status-well">
            <div class="drop-status-well__row">
              <span class="drop-status-well__msg">
                {t(`receiveStatus.${receivePhase}`, undefined, NS)}
              </span>
              <div class="drop-status-well__pills">
                {#if receiveTransport === 'p2p'}
                  <Badge tone="success">{t('transportP2p', undefined, NS)}</Badge>
                {:else if receiveTransport === 'relay'}
                  <Badge tone="warning">{t('transportRelay', undefined, NS)}</Badge>
                {/if}
                {#if receiveFingerprint}
                  <span class="drop-fp mono">
                    {t('fingerprintLabel', { fp: receiveFingerprint }, NS)}
                  </span>
                {/if}
              </div>
            </div>

            {#if receivePhase === 'receiving' || (receivePhase === 'completed' && incomingMeta)}
              <Meter
                percent={receivePercent}
                tone="success"
                label={incomingMeta?.fileName ?? t('modeText', undefined, NS)}
                valueText={`${formatBytes(receivePhase === 'completed' ? receiveTotalBytes : receiveProgressBytes)} / ${formatBytes(receiveTotalBytes)}`}
              />
            {/if}
          </div>

          {#if receiveError}
            <div class="glass drop-alert" role="alert" data-testid="drop-receive-error">
              {translateDropError(receiveError)}
            </div>
          {/if}

          {#if receivedPayload}
            {#if receivedPayload.kind === 'text'}
              <div class="drop-result" data-testid="drop-received-text">
                <CodeBlock
                  label={t('receivedTextLabel', undefined, NS)}
                  code={receivedPayload.text ?? ''}
                  wrap
                />
              </div>
            {:else}
              <div class="glass drop-file-card" data-testid="drop-received-file">
                <div class="drop-file-card__meta">
                  <span class="drop-file-card__icon" aria-hidden="true">
                    <Icon name="file-text" size="md" />
                  </span>
                  <div class="drop-file-card__text">
                    <strong class="mono">{receivedPayload.fileName}</strong>
                    <span class="mono">
                      {formatBytes(receivedPayload.totalBytes)} · {receivedPayload.mimeType}
                    </span>
                  </div>
                </div>
                <Button variant="primary" size="sm" onclick={downloadReceivedFile}>
                  <Icon name="download" size="xs" />
                  <span>{t('saveFile', undefined, NS)}</span>
                </Button>
              </div>
            {/if}
          {/if}

          <div class="drop-bay__cta">
            <Button variant="secondary" onclick={resetReceiveBay}>
              <Icon name="refresh-cw" size="xs" />
              <span>{t('resetReceive', undefined, NS)}</span>
            </Button>
          </div>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .drop-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .drop-bar {
    padding: 0 0.125rem 0.875rem;
    border-bottom: 1px solid var(--hairline);
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .drop-bar__title h2 {
    font-size: 1.125rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    color: var(--ink);
  }

  .drop-bar__title p {
    margin-top: 0.25rem;
    font-size: 0.78125rem;
    color: var(--ink-3);
  }

  .drop-bar__badges {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .drop-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap);
    align-items: stretch;
  }

  .drop-bay {
    padding: 1.125rem 1.25rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    transition: box-shadow 0.15s;
  }

  .drop-bay[data-drag='true'] {
    box-shadow:
      inset 0 0 0 2px var(--mint),
      var(--plate-shadow);
  }

  .drop-bay__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--hairline);
  }

  .drop-bay__composer,
  .drop-bay__active {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.875rem;
  }

  .drop-bay__idle {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .drop-bay__toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .drop-bay__hint {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .drop-bay__cta {
    margin-top: auto;
    padding-top: 0.25rem;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .drop-file-card {
    padding: 0.875rem 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
    flex-wrap: wrap;
  }

  .drop-file-card__meta {
    display: inline-flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
  }

  .drop-file-card__icon {
    width: 2.375rem;
    height: 2.375rem;
    border-radius: var(--r-key);
    background: var(--plate);
    color: var(--amber);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .drop-file-card__text {
    display: flex;
    flex-direction: column;
    gap: 0.1875rem;
    min-width: 0;
  }

  .drop-file-card__text strong {
    font-size: 0.875rem;
    color: var(--ink);
    word-break: break-all;
  }

  .drop-file-card__text span {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .drop-code-well {
    padding: 0.9375rem 1.0625rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .drop-code-well__top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .drop-code-well__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
  }

  .drop-code-well__digits {
    font-size: 2.25rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-align: center;
    color: var(--amber);
    padding: 0.375rem 0;
    user-select: all;
  }

  .drop-status-well {
    padding: 0.8125rem 0.9375rem;
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  }

  .drop-status-well__row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .drop-status-well__msg {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink);
  }

  .drop-status-well__pills {
    display: inline-flex;
    align-items: center;
    gap: 0.4375rem;
    flex-wrap: wrap;
  }

  .drop-fp {
    font-size: 0.6875rem;
    color: var(--ink-3);
    padding: 0.125rem 0.4375rem;
    border-radius: 0.25rem;
    background: var(--plate);
  }

  .drop-join-form {
    display: flex;
    flex-direction: column;
    gap: 0.4375rem;
  }

  .drop-join-form__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .drop-join-form__row {
    display: flex;
    align-items: stretch;
    gap: 0.625rem;
  }

  .drop-join-input {
    flex: 1;
    min-width: 0;
    height: 2.5rem;
    padding: 0 0.875rem;
    border: 0;
    font-size: 1.25rem;
    font-weight: 700;
    letter-spacing: 0.2em;
    text-align: center;
    color: var(--mint);
  }

  .drop-join-input::placeholder {
    color: var(--ink-3);
    opacity: 0.45;
  }

  .drop-join-input:disabled {
    opacity: 0.55;
  }

  .drop-alert {
    padding: 0.75rem 0.9375rem;
    color: var(--fault);
    font-size: 0.8125rem;
    border-left: 3px solid var(--fault);
  }

  .drop-result {
    display: flex;
    flex-direction: column;
  }

  @media (max-width: 920px) {
    .drop-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  @media (max-width: 520px) {
    .drop-join-form__row {
      flex-direction: column;
    }
  }
</style>
