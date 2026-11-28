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
  init: boolean;
  publishAll: boolean;
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
  shmSize?: string;
  pidsLimit?: string;
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

interface ParsedMountSpec {
  type: 'bind' | 'volume' | 'tmpfs';
  source?: string;
  target: string;
  readOnly: boolean;
  bindPropagation?: string;
  volumeNoCopy?: boolean;
  tmpfsSize?: string;
  tmpfsMode?: string;
}

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
const BOOL_SHORT_FLAGS = new Set(['d', 'i', 't', 'P', 'q']);

const KNOWN_UNMAPPED_BOOL_LONG_FLAGS = new Set([
  '--no-healthcheck',
  '--oom-kill-disable',
  '--sig-proxy',
  '--quiet',
  '--replace',
]);

const KNOWN_UNMAPPED_VALUE_LONG_FLAGS = new Set([
  '--cgroupns',
  '--cidfile',
  '--cpus-period',
  '--cpu-shares',
  '--dns',
  '--dns-opt',
  '--dns-option',
  '--dns-search',
  '--domainname',
  '--gpus',
  '--group-add',
  '--health-cmd',
  '--health-interval',
  '--health-retries',
  '--health-start-period',
  '--health-timeout',
  '--ip',
  '--ip6',
  '--ipc',
  '--isolation',
  '--log-driver',
  '--log-opt',
  '--mac-address',
  '--memory-reservation',
  '--memory-swap',
  '--network-alias',
  '--pid',
  '--platform',
  '--runtime',
  '--stop-signal',
  '--stop-timeout',
  '--sysctl',
  '--tz',
  '--ulimit',
  '--userns',
  '--uts',
  '--volumes-from',
]);

function deriveServiceName(image: string): string {
  const withoutDigest = image.split('@')[0];
  const lastSlash = withoutDigest.split('/').pop() ?? 'app';
  const withoutTag = lastSlash.split(':')[0] || 'app';
  const sanitized = withoutTag
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
    init: false,
    publishAll: false,
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
        case '--init':
          state.init = inlineVal !== 'false';
          break;
        case '--publish-all':
          state.publishAll = inlineVal !== 'false';
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
        case '--shm-size':
          state.shmSize = val();
          break;
        case '--pids-limit':
          state.pidsLimit = val();
          break;
        case '--pull':
          state.pull = val();
          break;
        default:
          if (inlineVal !== undefined) {
            state.warnings.push(`Unmapped flag preserved in notes: ${tok}`);
          } else if (KNOWN_UNMAPPED_BOOL_LONG_FLAGS.has(flag)) {
            state.warnings.push(`Unmapped boolean flag ignored: ${flag}`);
          } else if (KNOWN_UNMAPPED_VALUE_LONG_FLAGS.has(flag)) {
            const skipped = takeNextVal(flag);
            state.warnings.push(`Unmapped flag ignored: ${flag} ${skipped}`);
          } else {
            throw new Error(
              `Unknown flag ${flag} without '='; pass ${flag}=<value> if it takes an argument or remove it so the image name is not misread`
            );
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
        if (ch === 'P') state.publishAll = true;
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

function parseDockerMountSpec(raw: string): ParsedMountSpec {
  let mountType: 'bind' | 'volume' | 'tmpfs' = 'volume';
  let source: string | undefined;
  let target = '';
  let readOnly = false;
  let bindPropagation: string | undefined;
  let volumeNoCopy: boolean | undefined;
  let tmpfsSize: string | undefined;
  let tmpfsMode: string | undefined;

  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    const key = (eq >= 0 ? trimmed.slice(0, eq) : trimmed).trim().toLowerCase();
    const val = eq >= 0 ? trimmed.slice(eq + 1).trim() : undefined;

    switch (key) {
      case 'type':
        if (val === 'bind' || val === 'volume' || val === 'tmpfs') {
          mountType = val;
        } else {
          throw new Error(`Unsupported --mount type: ${val ?? ''}`);
        }
        break;
      case 'src':
      case 'source':
        source = val;
        break;
      case 'dst':
      case 'destination':
      case 'target':
        target = val ?? '';
        break;
      case 'ro':
      case 'readonly':
        readOnly = val === undefined || val === 'true' || val === '1';
        break;
      case 'bind-propagation':
        bindPropagation = val;
        break;
      case 'volume-nocopy':
        volumeNoCopy = val === undefined || val === 'true' || val === '1';
        break;
      case 'tmpfs-size':
        tmpfsSize = val;
        break;
      case 'tmpfs-mode':
        tmpfsMode = val;
        break;
      default:
        break;
    }
  }

  if (!target) {
    throw new Error(`--mount specification is missing target/destination: ${raw}`);
  }
  return {
    type: mountType,
    source,
    target,
    readOnly,
    bindPropagation,
    volumeNoCopy,
    tmpfsSize,
    tmpfsMode,
  };
}

function yamlScalar(v: string): string {
  if (
    /^[a-zA-Z0-9._/@:-]+$/.test(v) &&
    !/^(true|false|null|yes|no|on|off|\d+(\.\d+)?)$/i.test(v)
  ) {
    return v;
  }
  return JSON.stringify(v);
}

function renderComposeYaml(p: ParsedContainerRun, parsedMounts: readonly ParsedMountSpec[]): string {
  const svc = p.name.replace(/[^a-zA-Z0-9_-]/g, '-') || 'app';
  const lines: string[] = [
    'services:',
    `  ${svc}:`,
    `    image: ${yamlScalar(p.image)}`,
    `    container_name: ${yamlScalar(p.name)}`,
  ];

  if (p.restart) lines.push(`    restart: ${yamlScalar(p.restart)}`);
  if (p.pull) lines.push(`    pull_policy: ${yamlScalar(p.pull)}`);
  if (p.user) lines.push(`    user: ${JSON.stringify(p.user)}`);
  if (p.hostname) lines.push(`    hostname: ${yamlScalar(p.hostname)}`);
  if (p.workdir) lines.push(`    working_dir: ${yamlScalar(p.workdir)}`);
  if (p.entrypoint !== undefined) lines.push(`    entrypoint: ${JSON.stringify(p.entrypoint)}`);
  if (p.readOnly) lines.push('    read_only: true');
  if (p.init) lines.push('    init: true');
  if (p.privileged) lines.push('    privileged: true');
  if (p.interactive) lines.push('    stdin_open: true');
  if (p.tty) lines.push('    tty: true');
  if (p.shmSize) lines.push(`    shm_size: ${yamlScalar(p.shmSize)}`);
  if (p.pidsLimit) {
    const numPids = Number(p.pidsLimit);
    lines.push(
      `    pids_limit: ${Number.isInteger(numPids) ? String(numPids) : yamlScalar(p.pidsLimit)}`
    );
  }

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

  if (p.volumes.length > 0 || parsedMounts.length > 0) {
    lines.push('    volumes:');
    for (const vol of p.volumes) {
      lines.push(`      - ${JSON.stringify(vol)}`);
    }
    for (const m of parsedMounts) {
      lines.push(`      - type: ${m.type}`);
      if (m.source) {
        lines.push(`        source: ${yamlScalar(m.source)}`);
      }
      lines.push(`        target: ${yamlScalar(m.target)}`);
      if (m.readOnly) {
        lines.push('        read_only: true');
      }
      if (m.type === 'bind' && m.bindPropagation) {
        lines.push('        bind:', `          propagation: ${yamlScalar(m.bindPropagation)}`);
      }
      if (m.type === 'volume' && m.volumeNoCopy) {
        lines.push('        volume:', '          nocopy: true');
      }
      if (m.type === 'tmpfs' && (m.tmpfsSize || m.tmpfsMode)) {
        lines.push('        tmpfs:');
        if (m.tmpfsSize) lines.push(`          size: ${yamlScalar(m.tmpfsSize)}`);
        if (m.tmpfsMode) lines.push(`          mode: ${yamlScalar(m.tmpfsMode)}`);
      }
    }
  }

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
  for (const m of parsedMounts) {
    if (
      m.type === 'volume' &&
      m.source &&
      !m.source.startsWith('/') &&
      !m.source.startsWith('.') &&
      !m.source.startsWith('~')
    ) {
      if (!namedVolumes.includes(m.source)) namedVolumes.push(m.source);
    }
  }
  if (namedVolumes.length > 0) {
    lines.push('', 'volumes:');
    for (const nv of namedVolumes) {
      // Preserve exact existing Docker volume name instead of prefixing `<project>_<nv>`, while still creating it on fresh hosts
      lines.push(`  ${yamlScalar(nv)}:`, `    name: ${yamlScalar(nv)}`);
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

/**
 * Rejects control characters (CR, LF, NUL) in single-line systemd Quadlet fields so untrusted
 * quoted multiline tokens can never break out into arbitrary `[Service]` unit directives.
 */
function assertSafeQuadletToken(fieldName: string, value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`Newline or NUL control character is not permitted in ${fieldName}`);
  }
  return value;
}

/**
 * Escapes arbitrary strings (such as `Environment=`, `Label=`, or `Exec=` arguments) into a single
 * systemd-compliant C-escaped token (`\n`, `\r`, `\t`, `\"`, `\\`), guaranteeing zero raw line breaks.
 */
function systemdEscapeValue(fieldName: string, v: string): string {
  if (v.includes('\0')) {
    throw new Error(`NUL character is not permitted in ${fieldName}`);
  }
  if (v.length > 0 && !/[\s"'\\]/.test(v)) {
    return v;
  }
  let escaped = '"';
  for (let i = 0; i < v.length; i += 1) {
    const ch = v[i];
    if (ch === '\\') escaped += '\\\\';
    else if (ch === '"') escaped += '\\"';
    else if (ch === '\n') escaped += '\\n';
    else if (ch === '\r') escaped += '\\r';
    else if (ch === '\t') escaped += '\\t';
    else escaped += ch;
  }
  escaped += '"';
  return escaped;
}

interface MappedQuadletRestart {
  systemdRestart?: string;
  startLimitBurst?: number;
  warning?: string;
}

function mapSystemdRestart(dockerRestart?: string): MappedQuadletRestart {
  if (!dockerRestart) {
    return {};
  }
  const safe = assertSafeQuadletToken('--restart', dockerRestart);
  if (safe === 'no') {
    return { systemdRestart: 'no' };
  }
  if (safe === 'on-failure') {
    return { systemdRestart: 'on-failure' };
  }
  const retryMatch = safe.match(/^on-failure:(\d+)$/);
  if (retryMatch) {
    const burst = Number(retryMatch[1]);
    if (!Number.isSafeInteger(burst) || burst < 0) {
      throw new Error(`Invalid --restart retry count: ${safe}`);
    }
    if (burst === 0) {
      return { systemdRestart: 'on-failure' };
    }
    return {
      systemdRestart: 'on-failure',
      startLimitBurst: burst,
      warning: `Mapped --restart ${safe} to systemd Restart=on-failure with StartLimitBurst=${burst} (StartLimitIntervalSec=0).`,
    };
  }
  if (safe === 'always' || safe === 'unless-stopped') {
    return { systemdRestart: 'always' };
  }
  throw new Error(`Unsupported --restart policy: ${safe}`);
}

function renderPodmanQuadlet(
  p: ParsedContainerRun,
  opts: DockerConvertOptions | undefined,
  warningsOut: string[]
): string {
  const safeName = assertSafeQuadletToken('--name', p.name);
  const safeImage = assertSafeQuadletToken('image', p.image);
  const restartMapping = mapSystemdRestart(p.restart);
  if (restartMapping.warning) {
    warningsOut.push(restartMapping.warning);
  }

  const lines: string[] = [
    '[Unit]',
    `Description=${safeName} container`,
    'After=network-online.target',
    'Wants=network-online.target',
  ];
  if (restartMapping.startLimitBurst !== undefined) {
    lines.push('StartLimitIntervalSec=0');
    lines.push(`StartLimitBurst=${restartMapping.startLimitBurst}`);
  }
  lines.push('', '[Container]', `ContainerName=${safeName}`, `Image=${safeImage}`);

  if (opts?.quadletAutoUpdate) {
    lines.push('AutoUpdate=registry');
  }
  if (p.pull) lines.push(`Pull=${assertSafeQuadletToken('--pull', p.pull)}`);
  if (p.network) lines.push(`Network=${assertSafeQuadletToken('--network', p.network)}`);
  if (p.hostname) lines.push(`HostName=${assertSafeQuadletToken('--hostname', p.hostname)}`);
  if (p.workdir) lines.push(`WorkingDir=${assertSafeQuadletToken('--workdir', p.workdir)}`);
  if (p.entrypoint !== undefined) {
    lines.push(`Entrypoint=${systemdEscapeValue('--entrypoint', p.entrypoint)}`);
  }

  if (p.user) {
    const safeUser = assertSafeQuadletToken('--user', p.user);
    const [u, g] = safeUser.split(':');
    if (u) lines.push(`User=${u}`);
    if (g) lines.push(`Group=${g}`);
  }

  if (p.readOnly) lines.push('ReadOnly=true');
  if (p.init) lines.push('RunInit=true');
  if (p.publishAll) lines.push('PublishAllPorts=true');
  if (p.shmSize) lines.push(`ShmSize=${assertSafeQuadletToken('--shm-size', p.shmSize)}`);
  if (p.pidsLimit) lines.push(`PidsLimit=${assertSafeQuadletToken('--pids-limit', p.pidsLimit)}`);
  if (p.tty) lines.push('PodmanArgs=--tty');

  for (const port of p.ports) {
    lines.push(`PublishPort=${assertSafeQuadletToken('--publish', port)}`);
  }
  for (const env of p.env) {
    lines.push(`Environment=${systemdEscapeValue('--env', env)}`);
  }
  for (const ef of p.envFiles) {
    lines.push(`EnvironmentFile=${assertSafeQuadletToken('--env-file', ef)}`);
  }
  for (const vol of p.volumes) {
    lines.push(`Volume=${assertSafeQuadletToken('--volume', vol)}`);
  }
  for (const mnt of p.mounts) {
    lines.push(`Mount=${assertSafeQuadletToken('--mount', mnt)}`);
  }
  for (const tf of p.tmpfs) {
    lines.push(`Tmpfs=${assertSafeQuadletToken('--tmpfs', tf)}`);
  }
  for (const dev of p.devices) {
    lines.push(`AddDevice=${assertSafeQuadletToken('--device', dev)}`);
  }
  for (const cd of p.capDrop) {
    lines.push(`DropCapability=${assertSafeQuadletToken('--cap-drop', cd)}`);
  }
  for (const ca of p.capAdd) {
    lines.push(`AddCapability=${assertSafeQuadletToken('--cap-add', ca)}`);
  }

  for (const sec of p.securityOpt) {
    const safeSec = assertSafeQuadletToken('--security-opt', sec);
    if (safeSec === 'no-new-privileges' || safeSec === 'no-new-privileges:true') {
      lines.push('NoNewPrivileges=true');
    } else if (safeSec === 'label=disable' || safeSec === 'label:disable') {
      lines.push('SecurityLabelDisable=true');
    } else {
      lines.push(`PodmanArgs=--security-opt=${systemdEscapeValue('--security-opt', safeSec)}`);
    }
  }

  for (const host of p.extraHosts) {
    lines.push(`AddHost=${assertSafeQuadletToken('--add-host', host)}`);
  }
  for (const lbl of p.labels) {
    lines.push(`Label=${systemdEscapeValue('--label', lbl)}`);
  }

  if (p.privileged) {
    lines.push('PodmanArgs=--privileged');
  }
  if (p.cpus) {
    lines.push(`PodmanArgs=--cpus=${assertSafeQuadletToken('--cpus', p.cpus)}`);
  }
  if (p.command.length > 0) {
    lines.push(`Exec=${p.command.map((arg) => systemdEscapeValue('command', arg)).join(' ')}`);
  }

  if (restartMapping.systemdRestart || p.memory) {
    lines.push('', '[Service]');
    if (restartMapping.systemdRestart) {
      lines.push(`Restart=${restartMapping.systemdRestart}`);
      if (restartMapping.systemdRestart !== 'no') {
        lines.push('RestartSec=5');
      }
    }
    if (p.memory) {
      lines.push(`MemoryMax=${assertSafeQuadletToken('--memory', p.memory).toUpperCase()}`);
    }
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
    const warnings = [...parsed.warnings];
    if (parsed.publishAll) {
      warnings.push(
        'Docker Compose has no equivalent for -P / --publish-all; declare explicit host:container port mappings under ports: in compose.yaml.'
      );
    }
    const parsedMounts = parsed.mounts.map(parseDockerMountSpec);
    const quadletUnit = renderPodmanQuadlet(parsed, options, warnings);
    const composeYaml = renderComposeYaml(parsed, parsedMounts);
    const safeUnitBase = parsed.name.replace(/[^a-zA-Z0-9_.@-]/g, '-') || 'app';

    return {
      ok: true,
      serviceName: parsed.name,
      unitFileName: `${safeUnitBase}.container`,
      composeYaml,
      quadletUnit,
      warnings,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
