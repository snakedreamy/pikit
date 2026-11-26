<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { CodeBlock, Field, Switch, TextArea } from '../../../../ui';
  import { convertDockerRun } from './logic';

  const NS = 'tool:docker-convert';

  let command = $state(`podman run -d \\
  --name pikbay \\
  --restart unless-stopped \\
  --read-only \\
  --cap-drop=ALL \\
  --security-opt=no-new-privileges:true \\
  -u 65532:65532 \\
  -p 127.0.0.1:8080:8080 \\
  -v /etc/localtime:/etc/localtime:ro \\
  -v /srv/pikbay/pikbay.toml:/config/pikbay.toml:ro \\
  -v /srv/pikbay/icons:/config/icons:ro \\
  ghcr.io/snakedreamy/pikbay:latest`);

  let quadletAutoUpdate = $state(true);

  const result = $derived(convertDockerRun(command, { quadletAutoUpdate }));
</script>

<div class="dk-bench">
  <Field
    label={t('inputLabel', undefined, NS)}
    forId="pk-dk-cmd"
    error={!result.ok ? result.error : undefined}
  >
    <TextArea id="pk-dk-cmd" bind:value={command} rows={8} mono />
  </Field>

  <div class="dk-bar">
    <Switch bind:checked={quadletAutoUpdate} label={t('autoUpdateLabel', undefined, NS)} />
  </div>

  {#if result.ok}
    {#if result.warnings.length > 0}
      <div class="glass dk-warn mono">
        <strong>{t('warningsTitle', undefined, NS)}:</strong>
        {#each result.warnings as w, idx (idx)}
          <div>{w}</div>
        {/each}
      </div>
    {/if}

    <div class="dk-outputs">
      <CodeBlock label={t('composeLabel', undefined, NS)} code={result.composeYaml} fillHeight />
      <CodeBlock
        label={t('quadletLabel', { file: result.unitFileName }, NS)}
        meta={t('quadletPathHint', { file: result.unitFileName }, NS)}
        code={result.quadletUnit}
        fillHeight
      />
    </div>
  {/if}
</div>

<style>
  .dk-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .dk-bar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .dk-warn {
    padding: 0.625rem 0.875rem;
    font-size: 0.75rem;
    color: var(--amber);
    border-left: 3px solid var(--amber);
  }

  .dk-outputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.875rem;
    align-items: stretch;
  }

  @media (max-width: 920px) {
    .dk-outputs {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
