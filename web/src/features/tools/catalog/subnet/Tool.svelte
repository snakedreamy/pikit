<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Badge, Button, CopyButton, Field, Input } from '../../../../ui';
  import { calculateSubnet } from './logic';

  const NS = 'tool:subnet';
  const PRESETS = [
    '10.24.8.15/22',
    '192.168.1.42/24',
    '172.16.0.10/31',
    'fd00:abcd:12::1/64',
    '2001:db8:85a3::8a2e:370:7334/48',
  ] as const;

  let cidr = $state('10.24.8.15/22');
  const info = $derived(calculateSubnet(cidr));

  const rows = $derived.by(() => {
    if (!info) return [];
    const list: Array<{ label: string; value: string; copyable?: boolean }> = [
      { label: t('fieldNormalized', undefined, NS), value: info.normalizedCidr, copyable: true },
      { label: t('fieldAddress', undefined, NS), value: info.ipAddress, copyable: true },
    ];
    if (info.expandedAddress) {
      list.push({
        label: t('fieldExpanded', undefined, NS),
        value: info.expandedAddress,
        copyable: true,
      });
    }
    list.push(
      { label: t('fieldNetwork', undefined, NS), value: info.networkAddress, copyable: true },
      { label: t('fieldLast', undefined, NS), value: info.lastAddress, copyable: true }
    );
    if (info.netmask && info.wildcardMask) {
      list.push(
        { label: t('fieldNetmask', undefined, NS), value: info.netmask, copyable: true },
        { label: t('fieldWildcard', undefined, NS), value: info.wildcardMask, copyable: true }
      );
    }
    list.push(
      {
        label: t('fieldUsable', undefined, NS),
        value: `${info.firstUsable} — ${info.lastUsable}`,
        copyable: true,
      },
      { label: t('fieldTotal', undefined, NS), value: info.totalAddresses },
      { label: t('fieldUsableCount', undefined, NS), value: info.usableHosts }
    );
    return list;
  });
</script>

<div class="sn-bench">
  <Field
    label={t('inputLabel', undefined, NS)}
    forId="pk-sn-input"
    error={cidr.trim() && !info ? t('invalidCidr', undefined, NS) : undefined}
  >
    <Input
      id="pk-sn-input"
      bind:value={cidr}
      mono
      invalid={Boolean(cidr.trim() && !info)}
    />
  </Field>

  <div class="sn-presets">
    <span class="sn-presets__label">{t('presetsLabel', undefined, NS)}:</span>
    {#each PRESETS as preset (preset)}
      <Button variant="secondary" size="sm" onclick={() => (cidr = preset)}>
        <span class="mono">{preset}</span>
      </Button>
    {/each}
  </div>

  {#if info}
    <div class="sn-status">
      <Badge tone="info">IPv{info.version} /{info.prefix}</Badge>
      <Badge tone="success" dot>{t(`scope_${info.scope}`, undefined, NS)}</Badge>
    </div>

    <div class="sn-grid">
      {#each rows as row (row.label)}
        <div class="glass sn-card">
          <div class="sn-card__head">
            <span class="sn-card__label">{row.label}</span>
            {#if row.copyable}
              <CopyButton text={row.value} />
            {/if}
          </div>
          <code class="sn-card__val mono">{row.value}</code>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .sn-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .sn-presets {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4375rem;
  }

  .sn-presets__label {
    font-size: 0.75rem;
    color: var(--ink-3);
    margin-right: 0.25rem;
  }

  .sn-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .sn-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.625rem;
  }

  .sn-card {
    padding: 0.6875rem 0.875rem;
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .sn-card__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .sn-card__label {
    font-size: 0.75rem;
    color: var(--ink-3);
  }

  .sn-card__val {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--mint);
    word-break: break-all;
  }

  @media (max-width: 780px) {
    .sn-grid {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
