// Self-contained `docker run` / `podman run` shell tokenizer & converter to `compose.yaml` and Podman `.container` Quadlet

export interface ParsedContainerRun {
  name: string;
  image: string;
  command: string[];
  ports: string[];
  volumes: string[];
  mounts: string[];
  env: string[];
  envFiles: string[];
  labels: string[];
  network?: string;
  hostname?: string;
  workdir?: string;
  user?: string;
  restart?: string;
  entrypoint?: string;
  readOnly: boolean;
  interactive: boolean;
  tty: boolean;
  privileged: boolean;
  capDrop: string[];
  capAdd: string[];
  securityOpt: string[];
  tmpfs: string[];
  devices: string[];
  extraHosts: string[];
  cpus?: string;
  memory?: string;
  pull?: string;
  warnings: string[];
}

export interface DockerConvertOptions {
  quadletAutoUpdate?: boolean;
}

export type DockerConvertResult =
  | {
      ok: true;
      serviceName: string;
      unitFileName: string;
      composeYaml: string;
      quadletUnit: string;
      warnings: string[];
    }
  | {
      ok: false;
      error: string;
    };

export function tokenizeShellCommand(raw: string): string[] {
  // Normalize backslash-newline line continuations and strip whole-line comments
  const cleanedLines = raw
    .split(/\r?\n/)
    .filter((ln) => !ln.trim().startsWith('#'))
    .join('\n')
    .replace(/\\\n/g, ' ');

  const tokens: string[] = [];
  let cur = '';
  let inToken = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < cleanedLines.length; i += 1) {
    const ch = cleanedLines[i];

    if (quote === "'") {
      if (ch === "'") {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }

    if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\' && i + 1 < cleanedLines.length) {
        const next = cleanedLines[i + 1];
        if (next === '"' || next === '\\' || next === '$' || next === '`') {
          cur += next;
          i += 1;
        } else {
          cur += ch;
        }
      } else {
        cur += ch;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }

    if (ch === '\\' && i + 1 < cleanedLines.length) {
      cur += cleanedLines[i + 1];
      inToken = true;
      i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(cur);
        cur = '';
        inToken = false;
      }
      continue;
    }

    cur += ch;
    inToken = true;
  }

  if (quote !== null) {
    throw new Error(`Unterminated ${quote} quote in command string`);
  }
  if (inToken) {
    tokens.push(cur);
  }
  return tokens;
}

const VALUE_SHORT_FLAGS = new Set(['p', 'v', 'e', 'l', 'h', 'w', 'u', 'm']);
const BOOL_SHORT_FLAGS = new Set(['d', 'i', 't']);

function deriveServiceName(image: string): string {
  const withoutDigest = image.split('@')[0];
  const lastSlash = withoutDigest.split('/').pop() ?? 'app';
  const withoutTag = lastSlash.split(':')[0] || 'app';
  const sanitized = withoutTag.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return sanitized || 'app';
}

export function parseContainerRunTokens(tokens: readonly string[]): ParsedContainerRun {
  let idx = 0;
  while (idx < tokens.length && tokens[idx] === 'sudo') idx += 1;

  if (idx < tokens.length && (tokens[idx] === 'docker' || tokens[idx] === 'podman')) {
    idx += 1;
    if (idx < tokens.length && tokens[idx] === 'container') idx += 1;
    if (idx < tokens.length && (tokens[idx] === 'run' || tokens[idx] === 'create')) idx += 1;
  }

  const state: ParsedContainerRun = {
    name: '',
    image: '',
    command: [],
    ports: [],
    volumes: [],
    mounts: [],
    env: [],
    envFiles: [],
    labels: [],
    readOnly: false,
    interactive: false,
    tty: false,
    privileged: false,
    capDrop: [],
    capAdd: [],
    securityOpt: [],
    tmpfs: [],
    devices: [],
    extraHosts: [],
    warnings: [],
  };

  const takeNextVal = (flagName: string): string => {
    if (idx + 1 >= tokens.length) {
      throw new Error(`Flag ${flagName} requires a value`);
    }
    idx += 1;
    return tokens[idx];
  };

  while (idx < tokens.length) {
    const tok = tokens[idx];
    if (tok === '--') {
      idx += 1;
      break;
    }
    if (!tok.startsWith('-') || tok === '-') {
      break;
    }

    if (tok.startsWith('--')) {
      const eqIdx = tok.indexOf('=');
      const flag = eqIdx >= 0 ? tok.slice(0, eqIdx) : tok;
      const inlineVal = eqIdx >= 0 ? tok.slice(eqIdx + 1) : undefined;
      const val = () => (inlineVal !== undefined ? inlineVal : takeNextVal(flag));

      switch (flag) {
        case '--name':
          state.name = val();
          break;
        case '--publish':
          state.ports.push(val());
          break;
        case '--volume':
          state.volumes.push(val());
          break;
        case '--mount':
          state.mounts.push(val());
          break;
        case '--env':
          state.env.push(val());
          break;
        case '--env-file':
          state.envFiles.push(val());
          break;
        case '--label':
          state.labels.push(val());
          break;
        case '--network':
        case '--net':
          state.network = val();
          break;
        case '--hostname':
          state.hostname = val();
          break;
        case '--workdir':
          state.workdir = val();
          break;
        case '--user':
          state.user = val();
          break;
        case '--restart':
          state.restart = val();
          break;
        case '--entrypoint':
          state.entrypoint = val();
          break;
        case '--read-only':
          state.readOnly = inlineVal !== 'false';
          break;
        case '--detach':
        case '--rm':
          break;
        case '--interactive':
          state.interactive = inlineVal !== 'false';
          break;
        case '--tty':
          state.tty = inlineVal !== 'false';
          break;
        case '--privileged':
          state.privileged = inlineVal !== 'false';
          break;
        case '--cap-drop':
          state.capDrop.push(val());
          break;
        case '--cap-add':
          state.capAdd.push(val());
          break;
        case '--security-opt':
          state.securityOpt.push(val());
          break;
        case '--tmpfs':
          state.tmpfs.push(val());
          break;
        case '--device':
          state.devices.push(val());
          break;
        case '--add-host':
          state.extraHosts.push(val());
          break;
        case '--cpus':
          state.cpus = val();
          break;
        case '--memory':
          state.memory = val();
          break;
        case '--pull':
          state.pull = val();
          break;
        default:
          if (inlineVal !== undefined) {
            state.warnings.push(`Unmapped flag preserved in notes: ${tok}`);
          } else if (idx + 1 < tokens.length && !tokens[idx + 1].startsWith('-')) {
            const skipped = takeNextVal(flag);
            state.warnings.push(`Unmapped flag ignored: ${flag} ${skipped}`);
          } else {
            state.warnings.push(`Unmapped boolean flag ignored: ${flag}`);
          }
          break;
      }
      idx += 1;
      continue;
    }

    // Short flags (`-d`, `-it`, `-p 8080:80`, `-p8080:80`)
    const chars = tok.slice(1);
    for (let c = 0; c < chars.length; c += 1) {
      const ch = chars[c];
      if (BOOL_SHORT_FLAGS.has(ch)) {
        if (ch === 'i') state.interactive = true;
        if (ch === 't') state.tty = true;
        continue;
      }
      if (VALUE_SHORT_FLAGS.has(ch)) {
        const rest = chars.slice(c + 1);
        const v = rest.length > 0 ? rest : takeNextVal(`-${ch}`);
        if (ch === 'p') state.ports.push(v);
        else if (ch === 'v') state.volumes.push(v);
        else if (ch === 'e') state.env.push(v);
        else if (ch === 'l') state.labels.push(v);
        else if (ch === 'h') state.hostname = v;
        else if (ch === 'w') state.workdir = v;
        else if (ch === 'u') state.user = v;
        else if (ch === 'm') state.memory = v;
        break;
      }
      state.warnings.push(`Unmapped short flag ignored: -${ch}`);
    }
    idx += 1;
  }

  if (idx >= tokens.length) {
    throw new Error('Missing container image name in run command');
  }

  state.image = tokens[idx];
  state.command = tokens.slice(idx + 1);
  if (!state.name) {
    state.name = deriveServiceName(state.image);
  }
  return state;
}

function yamlScalar(v: string): string {
  if (/^[a-zA-Z0-9._/@:-]+$/.test(v) && !/^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(v)) {
    return v;
  }
  return JSON.stringify(v);
}

function renderComposeYaml(p: ParsedContainerRun): string {
  const svc = p.name.replace(/[^a-zA-Z0-9_-]/g, '-') || 'app';
  const lines: string[] = ['services:', `  ${svc}:`, `    image: ${yamlScalar(p.image)}`, `    container_name: ${yamlScalar(p.name)}`];

  if (p.restart) lines.push(`    restart: ${yamlScalar(p.restart)}`);
  if (p.pull) lines.push(`    pull_policy: ${yamlScalar(p.pull)}`);
  if (p.user) lines.push(`    user: ${JSON.stringify(p.user)}`);
  if (p.hostname) lines.push(`    hostname: ${yamlScalar(p.hostname)}`);
  if (p.workdir) lines.push(`    working_dir: ${yamlScalar(p.workdir)}`);
  if (p.entrypoint) lines.push(`    entrypoint: ${JSON.stringify(p.entrypoint)}`);
  if (p.readOnly) lines.push('    read_only: true');
  if (p.privileged) lines.push('    privileged: true');
  if (p.interactive) lines.push('    stdin_open: true');
  if (p.tty) lines.push('    tty: true');

  if (p.network) {
    if (['host', 'none', 'bridge'].includes(p.network) || p.network.startsWith('container:')) {
      lines.push(`    network_mode: ${yamlScalar(p.network)}`);
    } else {
      lines.push('    networks:', `      - ${yamlScalar(p.network)}`);
    }
  }

  const pushList = (key: string, arr: string[], quoteAll = false) => {
    if (arr.length === 0) return;
    lines.push(`    ${key}:`);
    for (const item of arr) {
      lines.push(`      - ${quoteAll ? JSON.stringify(item) : yamlScalar(item)}`);
    }
  };

  pushList('ports', p.ports, true);
  pushList('environment', p.env, true);
  pushList('env_file', p.envFiles);
  pushList('volumes', [...p.volumes, ...p.mounts], true);
  pushList('tmpfs', p.tmpfs);
  pushList('devices', p.devices, true);
  pushList('cap_drop', p.capDrop);
  pushList('cap_add', p.capAdd);
  pushList('security_opt', p.securityOpt, true);
  pushList('extra_hosts', p.extraHosts, true);
  pushList('labels', p.labels, true);

  if (p.command.length > 0) {
    lines.push(`    command: [${p.command.map((c) => JSON.stringify(c)).join(', ')}]`);
  }

  if (p.cpus || p.memory) {
    lines.push('    deploy:', '      resources:', '        limits:');
    if (p.cpus) lines.push(`          cpus: ${JSON.stringify(p.cpus)}`);
    if (p.memory) lines.push(`          memory: ${yamlScalar(p.memory)}`);
  }

  // Declare named volumes at root when non-path volume sources are present
  const namedVolumes: string[] = [];
  for (const v of p.volumes) {
    const first = v.split(':')[0];
    if (first && !first.startsWith('/') && !first.startsWith('.') && !first.startsWith('~')) {
      if (!namedVolumes.includes(first)) namedVolumes.push(first);
    }
  }
  if (namedVolumes.length > 0) {
    lines.push('', 'volumes:');
    for (const nv of namedVolumes) {
      lines.push(`  ${yamlScalar(nv)}:`);
    }
  }

  if (
    p.network &&
    !['host', 'none', 'bridge'].includes(p.network) &&
    !p.network.startsWith('container:')
  ) {
    lines.push('', 'networks:', `  ${yamlScalar(p.network)}:`, '    external: true');
  }

  return lines.join('\n');
}

function quadletEscapeValue(v: string): string {
  return /\s/.test(v) ? JSON.stringify(v) : v;
}

function mapSystemdRestart(dockerRestart?: string): string {
  if (!dockerRestart || dockerRestart === 'no') return 'no';
  if (dockerRestart.startsWith('on-failure')) return 'on-failure';
  // Both `always` and `unless-stopped` map cleanly to `always` under systemd service management
  return 'always';
}

function renderPodmanQuadlet(p: ParsedContainerRun, opts?: DockerConvertOptions): string {
  const lines: string[] = [
    '[Unit]',
    `Description=${p.name} container`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Container]',
    `ContainerName=${p.name}`,
    `Image=${p.image}`,
  ];

  if (opts?.quadletAutoUpdate) {
    lines.push('AutoUpdate=registry');
  }
  if (p.pull) lines.push(`Pull=${p.pull}`);
  if (p.network) lines.push(`Network=${p.network}`);
  if (p.hostname) lines.push(`HostName=${p.hostname}`);
  if (p.workdir) lines.push(`WorkingDir=${p.workdir}`);
  if (p.entrypoint) lines.push(`Entrypoint=${p.entrypoint}`);

  if (p.user) {
    const [u, g] = p.user.split(':');
    if (u) lines.push(`User=${u}`);
    if (g) lines.push(`Group=${g}`);
  }

  if (p.readOnly) lines.push('ReadOnly=true');
  if (p.tty) lines.push('PodmanArgs=--tty');

  for (const port of p.ports) lines.push(`PublishPort=${port}`);
  for (const env of p.env) lines.push(`Environment=${quadletEscapeValue(env)}`);
  for (const ef of p.envFiles) lines.push(`EnvironmentFile=${ef}`);
  for (const vol of p.volumes) lines.push(`Volume=${vol}`);
  for (const mnt of p.mounts) lines.push(`Mount=${mnt}`);
  for (const tf of p.tmpfs) lines.push(`Tmpfs=${tf}`);
  for (const dev of p.devices) lines.push(`AddDevice=${dev}`);
  for (const cd of p.capDrop) lines.push(`DropCapability=${cd}`);
  for (const ca of p.capAdd) lines.push(`AddCapability=${ca}`);

  for (const sec of p.securityOpt) {
    if (sec === 'no-new-privileges' || sec === 'no-new-privileges:true') {
      lines.push('NoNewPrivileges=true');
    } else if (sec === 'label=disable' || sec === 'label:disable') {
      lines.push('SecurityLabelDisable=true');
    } else {
      lines.push(`PodmanArgs=--security-opt=${quadletEscapeValue(sec)}`);
    }
  }

  for (const host of p.extraHosts) lines.push(`AddHost=${host}`);
  for (const lbl of p.labels) lines.push(`Label=${quadletEscapeValue(lbl)}`);

  if (p.privileged) {
    lines.push('PodmanArgs=--privileged');
  }
  if (p.cpus) {
    lines.push(`PodmanArgs=--cpus=${p.cpus}`);
  }
  if (p.command.length > 0) {
    lines.push(`Exec=${p.command.map(quadletEscapeValue).join(' ')}`);
  }

  lines.push('', '[Service]');
  lines.push(`Restart=${mapSystemdRestart(p.restart ?? 'on-failure')}`);
  lines.push('RestartSec=5');
  if (p.memory) {
    lines.push(`MemoryMax=${p.memory.toUpperCase()}`);
  }

  lines.push('', '[Install]', 'WantedBy=default.target');
  return lines.join('\n');
}

export function convertDockerRun(
  rawCommand: string,
  options?: DockerConvertOptions
): DockerConvertResult {
  if (!rawCommand.trim()) {
    return { ok: false, error: 'Enter a docker run or podman run command' };
  }

  try {
    const tokens = tokenizeShellCommand(rawCommand);
    if (tokens.length === 0) {
      return { ok: false, error: 'Command contains no arguments' };
    }
    const parsed = parseContainerRunTokens(tokens);
    return {
      ok: true,
      serviceName: parsed.name,
      unitFileName: `${parsed.name}.container`,
      composeYaml: renderComposeYaml(parsed),
      quadletUnit: renderPodmanQuadlet(parsed, options),
      warnings: parsed.warnings,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
