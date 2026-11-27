<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Button, Checkbox, CodeBlock, Field, Icon, IconButton, Input } from '../../../../ui';
  import {
    buildUrlFromComponents,
    parseUrlDeep,
    type BuildUrlErrorKind,
    type QueryParamRow,
  } from './logic';

  const NS = 'tool:url-parser';

  let rawUrl = $state(
    'https://gw.example.ts.net:8443/api/v1/nodes?region=ap-east&role=edge&limit=50#overview'
  );
  let parseError = $state(false);
  let buildError = $state<BuildUrlErrorKind | null>(null);

  let protocol = $state('https');
  let username = $state('');
  let password = $state('');
  let hostname = $state('gw.example.ts.net');
  let port = $state('8443');
  let pathname = $state('/api/v1/nodes');
  let hash = $state('overview');
  let origin = $state('https://gw.example.ts.net:8443');
  let params = $state<QueryParamRow[]>([
    { id: 'q-0', key: 'region', value: 'ap-east', enabled: true },
    { id: 'q-1', key: 'role', value: 'edge', enabled: true },
    { id: 'q-2', key: 'limit', value: '50', enabled: true },
  ]);
  let rowSeq = 10;

  function syncFromRawUrl() {
    const res = parseUrlDeep(rawUrl);
    if (!res.ok) {
      parseError = true;
      return;
    }
    parseError = false;
    buildError = null;
    protocol = res.data.protocol;
    username = res.data.username;
    password = res.data.password;
    hostname = res.data.hostname;
    port = res.data.port;
    pathname = res.data.pathname;
    hash = res.data.hash;
    origin = res.data.origin;
    params = res.data.params;
  }

  function syncToRawUrl() {
    const res = buildUrlFromComponents({
      protocol,
      username,
      password,
      hostname,
      port,
      pathname,
      hash,
      params,
    });
    if (res.ok) {
      rawUrl = res.url;
      origin = res.origin;
      parseError = false;
      buildError = null;
    } else {
      buildError = res.error;
    }
  }

  function addParamRow() {
    params = [...params, { id: `q-${++rowSeq}`, key: 'param', value: '', enabled: true }];
    syncToRawUrl();
  }

  function removeParamRow(id: string) {
    params = params.filter((r) => r.id !== id);
    syncToRawUrl();
  }

  function updateRow(idx: number, patch: Partial<QueryParamRow>) {
    params = params.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    syncToRawUrl();
  }

  const buildResult = $derived(
    buildUrlFromComponents({
      protocol,
      username,
      password,
      hostname,
      port,
      pathname,
      hash,
      params,
    })
  );
  const rebuilt = $derived(buildResult.ok ? buildResult.url : rawUrl);
</script>

<div class="up-bench">
  <Field
    label={t('inputLabel', undefined, NS)}
    forId="pk-up-raw"
    error={parseError ? t('invalidUrl', undefined, NS) : undefined}
  >
    <Input
      id="pk-up-raw"
      bind:value={rawUrl}
      mono
      clearable
      invalid={parseError}
      oninput={syncFromRawUrl}
    />
  </Field>

  <div class="up-grid">
    <Field label={t('protocolLabel', undefined, NS)} forId="pk-up-proto">
      <Input id="pk-up-proto" bind:value={protocol} mono oninput={syncToRawUrl} />
    </Field>
    <Field
      label={t('hostLabel', undefined, NS)}
      forId="pk-up-host"
      error={buildError === 'missing_host' ? t('missingHost', undefined, NS) : undefined}
    >
      <Input
        id="pk-up-host"
        bind:value={hostname}
        mono
        invalid={buildError === 'missing_host' || buildError === 'invalid_url'}
        oninput={syncToRawUrl}
      />
    </Field>
    <Field
      label={t('portLabel', undefined, NS)}
      forId="pk-up-port"
      error={buildError === 'invalid_port' ? t('invalidPort', undefined, NS) : undefined}
    >
      <Input
        id="pk-up-port"
        bind:value={port}
        mono
        placeholder="80 / 443"
        invalid={buildError === 'invalid_port'}
        oninput={syncToRawUrl}
      />
    </Field>
    <Field label={t('originLabel', undefined, NS)} forId="pk-up-origin">
      <Input id="pk-up-origin" value={origin} mono readonly />
    </Field>

    <Field label={t('pathLabel', undefined, NS)} forId="pk-up-path">
      <Input id="pk-up-path" bind:value={pathname} mono oninput={syncToRawUrl} />
    </Field>
    <Field label={t('hashLabel', undefined, NS)} forId="pk-up-hash">
      <Input id="pk-up-hash" bind:value={hash} mono oninput={syncToRawUrl} />
    </Field>
    <Field label={t('userLabel', undefined, NS)} forId="pk-up-user">
      <Input id="pk-up-user" bind:value={username} mono oninput={syncToRawUrl} />
    </Field>
    <Field label={t('passLabel', undefined, NS)} forId="pk-up-pass">
      <Input id="pk-up-pass" bind:value={password} mono oninput={syncToRawUrl} />
    </Field>
  </div>

  <div class="up-section">
    <div class="up-section__head">
      <span class="up-section__title">
        {t('querySection', { count: params.length }, NS)}
      </span>
      <Button variant="secondary" size="sm" onclick={addParamRow}>
        <Icon name="plus" size="xs" />
        <span>{t('addParam', undefined, NS)}</span>
      </Button>
    </div>

    {#if params.length === 0}
      <div class="glass up-empty">{t('emptyParams', undefined, NS)}</div>
    {:else}
      <div class="glass up-table-wrap">
        <table class="up-table">
          <thead>
            <tr>
              <th class="up-col-check">{t('colEnabled', undefined, NS)}</th>
              <th>{t('colKey', undefined, NS)}</th>
              <th>{t('colValue', undefined, NS)}</th>
              <th class="up-col-act">{t('colAction', undefined, NS)}</th>
            </tr>
          </thead>
          <tbody>
            {#each params as row, idx (row.id)}
              <tr>
                <td>
                  <Checkbox
                    id={`up-en-${row.id}`}
                    label=""
                    checked={row.enabled}
                    onchange={(v) => updateRow(idx, { enabled: v })}
                  />
                </td>
                <td>
                  <Input
                    value={row.key}
                    mono
                    oninput={(e) =>
                      updateRow(idx, { key: (e.currentTarget as HTMLInputElement).value })}
                  />
                </td>
                <td>
                  <Input
                    value={row.value}
                    mono
                    oninput={(e) =>
                      updateRow(idx, { value: (e.currentTarget as HTMLInputElement).value })}
                  />
                </td>
                <td>
                  <IconButton
                    icon="trash-2"
                    label={t('colAction', undefined, NS)}
                    onclick={() => removeParamRow(row.id)}
                  />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <CodeBlock label={t('rebuiltLabel', undefined, NS)} code={rebuilt} wrap />
</div>

<style>
  .up-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .up-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
  }

  .up-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .up-section__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .up-section__title {
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .up-empty {
    padding: 0.875rem 1rem;
    font-size: 0.8125rem;
    color: var(--ink-3);
  }

  .up-table-wrap {
    overflow-x: auto;
  }

  .up-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .up-table th,
  .up-table td {
    padding: 0.5rem 0.625rem;
    text-align: left;
    border-bottom: 1px solid var(--hairline);
    vertical-align: middle;
  }

  .up-table th {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-3);
  }

  .up-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .up-col-check {
    width: 3.5rem;
  }

  .up-col-act {
    width: 3.5rem;
  }

  @media (max-width: 960px) {
    .up-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .up-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
