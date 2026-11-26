// Two-way POSIX 12-bit file mode calculator (Owner / Group / Other rwx + SUID / SGID / Sticky)

export interface ChmodMatrix {
  owner: { r: boolean; w: boolean; x: boolean };
  group: { r: boolean; w: boolean; x: boolean };
  other: { r: boolean; w: boolean; x: boolean };
  suid: boolean;
  sgid: boolean;
  sticky: boolean;
}

export function modeToMatrix(mode: number): ChmodMatrix {
  const m = mode & 0o7777;
  return {
    owner: { r: Boolean(m & 0o400), w: Boolean(m & 0o200), x: Boolean(m & 0o100) },
    group: { r: Boolean(m & 0o040), w: Boolean(m & 0o020), x: Boolean(m & 0o010) },
    other: { r: Boolean(m & 0o004), w: Boolean(m & 0o002), x: Boolean(m & 0o001) },
    suid: Boolean(m & 0o4000),
    sgid: Boolean(m & 0o2000),
    sticky: Boolean(m & 0o1000),
  };
}

export function matrixToMode(mat: ChmodMatrix): number {
  let m = 0;
  if (mat.suid) m |= 0o4000;
  if (mat.sgid) m |= 0o2000;
  if (mat.sticky) m |= 0o1000;
  if (mat.owner.r) m |= 0o0400;
  if (mat.owner.w) m |= 0o0200;
  if (mat.owner.x) m |= 0o0100;
  if (mat.group.r) m |= 0o0040;
  if (mat.group.w) m |= 0o0020;
  if (mat.group.x) m |= 0o0010;
  if (mat.other.r) m |= 0o0004;
  if (mat.other.w) m |= 0o0002;
  if (mat.other.x) m |= 0o0001;
  return m;
}

export function formatOctalMode(mode: number): string {
  const m = mode & 0o7777;
  return m.toString(8).padStart(4, '0');
}

export function parseOctalMode(raw: string): number | null {
  const cleaned = raw.trim().replace(/^0o/i, '');
  if (!/^[0-7]{3,4}$/.test(cleaned)) return null;
  return parseInt(cleaned, 8) & 0o7777;
}

export function formatSymbolicMode(mode: number): string {
  const mat = modeToMatrix(mode);
  const uX = mat.suid ? (mat.owner.x ? 's' : 'S') : mat.owner.x ? 'x' : '-';
  const gX = mat.sgid ? (mat.group.x ? 's' : 'S') : mat.group.x ? 'x' : '-';
  const oX = mat.sticky ? (mat.other.x ? 't' : 'T') : mat.other.x ? 'x' : '-';

  return [
    mat.owner.r ? 'r' : '-',
    mat.owner.w ? 'w' : '-',
    uX,
    mat.group.r ? 'r' : '-',
    mat.group.w ? 'w' : '-',
    gX,
    mat.other.r ? 'r' : '-',
    mat.other.w ? 'w' : '-',
    oX,
  ].join('');
}

export function parseSymbolicMode(raw: string): number | null {
  const trimmed = raw.trim();
  const core = trimmed.length === 10 && /^[-dlcbps]/.test(trimmed) ? trimmed.slice(1) : trimmed;
  if (core.length !== 9) return null;

  const [ur, uw, ux, gr, gw, gx, or_, ow, ox] = core.split('');
  if ((ur !== 'r' && ur !== '-') || (uw !== 'w' && uw !== '-') || !['x', '-', 's', 'S'].includes(ux)) {
    return null;
  }
  if ((gr !== 'r' && gr !== '-') || (gw !== 'w' && gw !== '-') || !['x', '-', 's', 'S'].includes(gx)) {
    return null;
  }
  if ((or_ !== 'r' && or_ !== '-') || (ow !== 'w' && ow !== '-') || !['x', '-', 't', 'T'].includes(ox)) {
    return null;
  }

  return matrixToMode({
    owner: { r: ur === 'r', w: uw === 'w', x: ux === 'x' || ux === 's' },
    group: { r: gr === 'r', w: gw === 'w', x: gx === 'x' || gx === 's' },
    other: { r: or_ === 'r', w: ow === 'w', x: ox === 'x' || ox === 't' },
    suid: ux === 's' || ux === 'S',
    sgid: gx === 's' || gx === 'S',
    sticky: ox === 't' || ox === 'T',
  });
}

function shellEscapeTarget(path: string): string {
  const trimmed = path.trim() || 'config.toml';
  if (/^[a-zA-Z0-9._/@:-]+$/.test(trimmed)) return trimmed;
  return `'${trimmed.replace(/'/g, `'\\''`)}'`;
}

export function buildChmodCommands(
  mode: number,
  targetPath: string,
  recursive = false
): { octalCmd: string; symbolicCmd: string } {
  const mat = modeToMatrix(mode);
  const flag = recursive ? '-R ' : '';
  const safePath = shellEscapeTarget(targetPath);
  const octal = formatOctalMode(mode);

  const uBits = `${mat.owner.r ? 'r' : ''}${mat.owner.w ? 'w' : ''}${mat.owner.x ? 'x' : ''}${mat.suid ? 's' : ''}`;
  const gBits = `${mat.group.r ? 'r' : ''}${mat.group.w ? 'w' : ''}${mat.group.x ? 'x' : ''}${mat.sgid ? 's' : ''}`;
  const oBits = `${mat.other.r ? 'r' : ''}${mat.other.w ? 'w' : ''}${mat.other.x ? 'x' : ''}${mat.sticky ? 't' : ''}`;

  return {
    octalCmd: `chmod ${flag}${octal} ${safePath}`,
    symbolicCmd: `chmod ${flag}u=${uBits},g=${gBits},o=${oBits} ${safePath}`,
  };
}
