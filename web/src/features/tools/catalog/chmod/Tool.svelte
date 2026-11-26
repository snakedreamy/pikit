<script lang="ts">
  import { t } from '../../../../lib/i18n/index.svelte';
  import { Button, Checkbox, CodeBlock, Field, Input, Switch } from '../../../../ui';
  import {
    buildChmodCommands,
    formatOctalMode,
    formatSymbolicMode,
    matrixToMode,
    modeToMatrix,
    parseOctalMode,
    parseSymbolicMode,
  } from './logic';

  const NS = 'tool:chmod';

  const PRESETS = [
    { label: '0600', mode: 0o0600 },
    { label: '0640', mode: 0o0640 },
    { label: '0644', mode: 0o0644 },
    { label: '0750', mode: 0o0750 },
    { label: '0755', mode: 0o0755 },
    { label: '1777', mode: 0o1777 },
  ] as const;

  let mode = $state(0o0640);
  let octalInput = $state('0640');
  let symbolicInput = $state('rw-r-----');
  let octalInvalid = $state(false);
  let symbolicInvalid = $state(false);
  let targetPath = $state('/opt/pikbay/config.toml');
  let recursive = $state(false);

  const mat = $derived(modeToMatrix(mode));
  const cmds = $derived(buildChmodCommands(mode, targetPath, recursive));

  function applyMode(nextMode: number) {
    mode = nextMode & 0o7777;
    octalInput = formatOctalMode(mode);
    symbolicInput = formatSymbolicMode(mode);
    octalInvalid = false;
    symbolicInvalid = false;
  }

  function handleOctalEdit() {
    const parsed = parseOctalMode(octalInput);
    if (parsed === null) {
      octalInvalid = true;
      return;
    }
    octalInvalid = false;
    mode = parsed;
    symbolicInput = formatSymbolicMode(parsed);
    symbolicInvalid = false;
  }

  function handleSymbolicEdit() {
    const parsed = parseSymbolicMode(symbolicInput);
    if (parsed === null) {
      symbolicInvalid = true;
      return;
    }
    symbolicInvalid = false;
    mode = parsed;
    octalInput = formatOctalMode(parsed);
    octalInvalid = false;
  }

  function togglePerm(scope: 'owner' | 'group' | 'other', bit: 'r' | 'w' | 'x', checked: boolean) {
    const next = modeToMatrix(mode);
    next[scope][bit] = checked;
    applyMode(matrixToMode(next));
  }

  function toggleSpecial(key: 'suid' | 'sgid' | 'sticky', checked: boolean) {
    const next = modeToMatrix(mode);
    next[key] = checked;
    applyMode(matrixToMode(next));
  }
</script>

<div class="cm-bench">
  <div class="cm-presets">
    <span class="cm-label">{t('presetsLabel', undefined, NS)}</span>
    <div class="cm-presets__list">
      {#each PRESETS as p (p.label)}
        <Button
          variant={mode === p.mode ? 'primary' : 'secondary'}
          size="sm"
          onclick={() => applyMode(p.mode)}
        >
          <span class="mono">{p.label}</span>
        </Button>
      {/each}
    </div>
  </div>

  <div class="cm-inputs">
    <Field
      label={t('octalLabel', undefined, NS)}
      forId="pk-cm-octal"
      error={octalInvalid ? t('invalidOctal', undefined, NS) : undefined}
    >
      <Input
        id="pk-cm-octal"
        bind:value={octalInput}
        mono
        invalid={octalInvalid}
        oninput={handleOctalEdit}
      />
    </Field>

    <Field
      label={t('symbolicLabel', undefined, NS)}
      forId="pk-cm-sym"
      error={symbolicInvalid ? t('invalidSymbolic', undefined, NS) : undefined}
    >
      <Input
        id="pk-cm-sym"
        bind:value={symbolicInput}
        mono
        invalid={symbolicInvalid}
        oninput={handleSymbolicEdit}
      />
    </Field>

    <Field label={t('targetLabel', undefined, NS)} forId="pk-cm-target">
      <Input id="pk-cm-target" bind:value={targetPath} mono />
    </Field>
  </div>

  <div class="glass cm-matrix-wrap">
    <table class="cm-table">
      <thead>
        <tr>
          <th>{t('colScope', undefined, NS)}</th>
          <th>{t('colRead', undefined, NS)}</th>
          <th>{t('colWrite', undefined, NS)}</th>
          <th>{t('colExec', undefined, NS)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="cm-scope">{t('rowOwner', undefined, NS)}</td>
          <td>
            <Checkbox
              id="cm-u-r"
              label="r"
              checked={mat.owner.r}
              onchange={(v) => togglePerm('owner', 'r', v)}
            />
          </td>
          <td>
            <Checkbox
              id="cm-u-w"
              label="w"
              checked={mat.owner.w}
              onchange={(v) => togglePerm('owner', 'w', v)}
            />
          </td>
          <td>
            <Checkbox
              id="cm-u-x"
              label="x"
              checked={mat.owner.x}
              onchange={(v) => togglePerm('owner', 'x', v)}
            />
          </td>
        </tr>
        <tr>
          <td class="cm-scope">{t('rowGroup', undefined, NS)}</td>
          <td>
            <Checkbox
              id="cm-g-r"
              label="r"
              checked={mat.group.r}
              onchange={(v) => togglePerm('group', 'r', v)}
            />
          </td>
          <td>
            <Checkbox
              id="cm-g-w"
              label="w"
              checked={mat.group.w}
              onchange={(v) => togglePerm('group', 'w', v)}
            />
          </td>
          <td>
            <Checkbox
              id="cm-g-x"
              label="x"
              checked={mat.group.x}
              onchange={(v) => togglePerm('group', 'x', v)}
            />
          </td>
        </tr>
        <tr>
          <td class="cm-scope">{t('rowOther', undefined, NS)}</td>
          <td>
            <Checkbox
              id="cm-o-r"
              label="r"
              checked={mat.other.r}
              onchange={(v) => togglePerm('other', 'r', v)}
            />
          </td>
          <td>
            <Checkbox
              id="cm-o-w"
              label="w"
              checked={mat.other.w}
              onchange={(v) => togglePerm('other', 'w', v)}
            />
          </td>
          <td>
            <Checkbox
              id="cm-o-x"
              label="x"
              checked={mat.other.x}
              onchange={(v) => togglePerm('other', 'x', v)}
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="glass cm-special">
    <span class="cm-label">{t('specialTitle', undefined, NS)}</span>
    <div class="cm-special__items">
      <Switch
        checked={mat.suid}
        label={t('suidLabel', undefined, NS)}
        onchange={(v) => toggleSpecial('suid', v)}
      />
      <Switch
        checked={mat.sgid}
        label={t('sgidLabel', undefined, NS)}
        onchange={(v) => toggleSpecial('sgid', v)}
      />
      <Switch
        checked={mat.sticky}
        label={t('stickyLabel', undefined, NS)}
        onchange={(v) => toggleSpecial('sticky', v)}
      />
      <Switch bind:checked={recursive} label={t('recursiveLabel', undefined, NS)} />
    </div>
  </div>

  <div class="cm-outputs">
    <CodeBlock label={t('cmdOctalLabel', undefined, NS)} code={cmds.octalCmd} />
    <CodeBlock label={t('cmdSymbolicLabel', undefined, NS)} code={cmds.symbolicCmd} />
  </div>
</div>

<style>
  .cm-bench {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .cm-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--ink-2);
  }

  .cm-presets {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    flex-wrap: wrap;
  }

  .cm-presets__list {
    display: inline-flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }

  .cm-inputs {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.875rem;
  }

  .cm-matrix-wrap {
    overflow-x: auto;
  }

  .cm-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .cm-table th,
  .cm-table td {
    padding: 0.625rem 0.875rem;
    text-align: left;
    border-bottom: 1px solid var(--hairline);
  }

  .cm-table th {
    color: var(--ink-3);
    font-size: 0.75rem;
    font-weight: 600;
  }

  .cm-table tbody tr:last-child td {
    border-bottom: 0;
  }

  .cm-scope {
    font-weight: 600;
    color: var(--ink);
  }

  .cm-special {
    padding: 0.75rem 0.9375rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.875rem;
    flex-wrap: wrap;
  }

  .cm-special__items {
    display: flex;
    align-items: center;
    gap: 1.125rem;
    flex-wrap: wrap;
  }

  .cm-outputs {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.875rem;
  }

  @media (max-width: 820px) {
    .cm-inputs,
    .cm-outputs {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
