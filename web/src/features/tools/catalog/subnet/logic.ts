export type AddressScope =
  | 'loopback'
  | 'private'
  | 'cgnat'
  | 'linkLocal'
  | 'multicast'
  | 'documentation'
  | 'unspecified'
  | 'global';

export interface SubnetInfo {
  version: 4 | 6;
  prefix: number;
  normalizedCidr: string;
  ipAddress: string;
  expandedAddress?: string;
  networkAddress: string;
  lastAddress: string;
  netmask?: string;
  wildcardMask?: string;
  firstUsable: string;
  lastUsable: string;
  totalAddresses: string;
  usableHosts: string;
  scope: AddressScope;
}

const IPV4_MAX = (1n << 32n) - 1n;
const IPV6_MAX = (1n << 128n) - 1n;

export function parseIpv4(raw: string): bigint | null {
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  let acc = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    if (part.length > 1 && part.startsWith('0')) return null;
    const n = Number(part);
    if (n < 0 || n > 255) return null;
    acc = (acc << 8n) | BigInt(n);
  }
  return acc;
}

export function formatIpv4(val: bigint): string {
  const b0 = Number((val >> 24n) & 0xffn);
  const b1 = Number((val >> 16n) & 0xffn);
  const b2 = Number((val >> 8n) & 0xffn);
  const b3 = Number(val & 0xffn);
  return `${b0}.${b1}.${b2}.${b3}`;
}

export function parseIpv6(raw: string): bigint | null {
  let input = raw.trim().toLowerCase();
  if (!input || input.startsWith(':') && !input.startsWith('::')) return null;
  if (input.endsWith(':') && !input.endsWith('::')) return null;

  // Support trailing embedded IPv4 dotted-quad notation (e.g. `::ffff:192.168.1.1`)
  const lastColon = input.lastIndexOf(':');
  if (lastColon !== -1 && input.slice(lastColon + 1).includes('.')) {
    const v4 = parseIpv4(input.slice(lastColon + 1));
    if (v4 === null) return null;
    const hi = ((v4 >> 16n) & 0xffffn).toString(16);
    const lo = (v4 & 0xffffn).toString(16);
    input = `${input.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const doubleParts = input.split('::');
  if (doubleParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (side === '') return [];
    const tokens = side.split(':');
    const nums: number[] = [];
    for (const tk of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(tk)) return null;
      nums.push(Number.parseInt(tk, 16));
    }
    return nums;
  };

  let hextets: number[];
  if (doubleParts.length === 2) {
    const left = parseSide(doubleParts[0]);
    const right = parseSide(doubleParts[1]);
    if (!left || !right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 1) return null;
    hextets = [...left, ...Array<number>(missing).fill(0), ...right];
  } else {
    const all = parseSide(doubleParts[0]);
    if (!all || all.length !== 8) return null;
    hextets = all;
  }

  let acc = 0n;
  for (const h of hextets) {
    acc = (acc << 16n) | BigInt(h);
  }
  return acc;
}

function toHextets(val: bigint): number[] {
  const out = Array<number>(8);
  for (let i = 7; i >= 0; i--) {
    out[7 - i] = Number((val >> BigInt(i * 16)) & 0xffffn);
  }
  return out;
}

export function formatIpv6Expanded(val: bigint): string {
  return toHextets(val)
    .map((h) => h.toString(16).padStart(4, '0'))
    .join(':');
}

/**
 * RFC 5952 canonical compression: collapses only the longest contiguous run of `>= 2` zero hextets (leftmost on ties).
 */
export function formatIpv6Compressed(val: bigint): string {
  const hs = toHextets(val);
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i++) {
    if (hs[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
      if (curLen >= 2 && curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestStart === -1) {
    return hs.map((h) => h.toString(16)).join(':');
  }

  const left = hs
    .slice(0, bestStart)
    .map((h) => h.toString(16))
    .join(':');
  const right = hs
    .slice(bestStart + bestLen)
    .map((h) => h.toString(16))
    .join(':');
  return `${left}::${right}`;
}

function formatBigCount(n: bigint): string {
  const s = n.toString(10);
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function classifyIpv4(ip: bigint): AddressScope {
  if (ip === 0n) return 'unspecified';
  if ((ip >> 24n) === 127n) return 'loopback';
  if ((ip >> 24n) === 10n) return 'private';
  if ((ip >> 20n) === ((172n << 4n) | 1n)) return 'private'; // 172.16.0.0/12
  if ((ip >> 16n) === ((192n << 8n) | 168n)) return 'private'; // 192.168.0.0/16
  if ((ip >> 22n) === ((100n << 2n) | 1n)) return 'cgnat'; // 100.64.0.0/10
  if ((ip >> 16n) === ((169n << 8n) | 254n)) return 'linkLocal';
  if ((ip >> 28n) === 14n) return 'multicast'; // 224.0.0.0/4
  if (
    (ip >> 8n) === ((192n << 16n) | (0n << 8n) | 2n) ||
    (ip >> 8n) === ((198n << 16n) | (51n << 8n) | 100n) ||
    (ip >> 8n) === ((203n << 16n) | (0n << 8n) | 113n)
  ) {
    return 'documentation';
  }
  return 'global';
}

function classifyIpv6(ip: bigint): AddressScope {
  if (ip === 0n) return 'unspecified';
  if (ip === 1n) return 'loopback';
  if ((ip >> 120n) === 0xffn) return 'multicast'; // ff00::/8
  if ((ip >> 118n) === 0x3fan) return 'linkLocal'; // fe80::/10
  if ((ip >> 121n) === 0x7en) return 'private'; // fc00::/7
  if ((ip >> 96n) === 0x20010db8n) return 'documentation'; // 2001:db8::/32
  return 'global';
}

export function calculateSubnet(rawInput: string): SubnetInfo | null {
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  const slashParts = trimmed.split('/');
  if (slashParts.length > 2) return null;

  const addrPart = slashParts[0].trim();
  const prefixPart = slashParts[1]?.trim();

  const isV6 = addrPart.includes(':');

  if (!isV6) {
    const ip = parseIpv4(addrPart);
    if (ip === null) return null;
    let prefix = 32;
    if (prefixPart !== undefined) {
      if (!/^\d{1,2}$/.test(prefixPart)) return null;
      prefix = Number(prefixPart);
      if (prefix < 0 || prefix > 32) return null;
    }

    const hostBits = BigInt(32 - prefix);
    const mask = prefix === 0 ? 0n : (IPV4_MAX << hostBits) & IPV4_MAX;
    const wildcard = IPV4_MAX ^ mask;
    const network = ip & mask;
    const broadcast = network | wildcard;
    const total = 1n << hostBits;

    let firstUsable = network;
    let lastUsable = broadcast;
    let usableCount = total;

    if (prefix <= 30) {
      firstUsable = network + 1n;
      lastUsable = broadcast - 1n;
      usableCount = total - 2n;
    }
    // RFC 3021: both addresses in `/31` point-to-point links are usable (2 hosts); `/32` is a single host route (1 host)

    return {
      version: 4,
      prefix,
      normalizedCidr: `${formatIpv4(network)}/${prefix}`,
      ipAddress: formatIpv4(ip),
      networkAddress: formatIpv4(network),
      lastAddress: formatIpv4(broadcast),
      netmask: formatIpv4(mask),
      wildcardMask: formatIpv4(wildcard),
      firstUsable: formatIpv4(firstUsable),
      lastUsable: formatIpv4(lastUsable),
      totalAddresses: formatBigCount(total),
      usableHosts: formatBigCount(usableCount),
      scope: classifyIpv4(ip),
    };
  }

  const ip6 = parseIpv6(addrPart);
  if (ip6 === null) return null;
  let prefix6 = 128;
  if (prefixPart !== undefined) {
    if (!/^\d{1,3}$/.test(prefixPart)) return null;
    prefix6 = Number(prefixPart);
    if (prefix6 < 0 || prefix6 > 128) return null;
  }

  const hostBits6 = BigInt(128 - prefix6);
  const mask6 = prefix6 === 0 ? 0n : (IPV6_MAX << hostBits6) & IPV6_MAX;
  const wildcard6 = IPV6_MAX ^ mask6;
  const network6 = ip6 & mask6;
  const last6 = network6 | wildcard6;
  const total6 = 1n << hostBits6;

  return {
    version: 6,
    prefix: prefix6,
    normalizedCidr: `${formatIpv6Compressed(network6)}/${prefix6}`,
    ipAddress: formatIpv6Compressed(ip6),
    expandedAddress: formatIpv6Expanded(ip6),
    networkAddress: formatIpv6Compressed(network6),
    lastAddress: formatIpv6Compressed(last6),
    firstUsable: formatIpv6Compressed(network6),
    lastUsable: formatIpv6Compressed(last6),
    totalAddresses: formatBigCount(total6),
    usableHosts: formatBigCount(total6),
    scope: classifyIpv6(ip6),
  };
}
