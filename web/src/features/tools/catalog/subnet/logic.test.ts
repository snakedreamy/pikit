import { describe, expect, it } from 'vitest';
import { calculateSubnet, formatIpv6Compressed, parseIpv6 } from './logic';

describe('subnet CIDR logic', () => {
  it('calculates IPv4 /22 boundaries, netmask, wildcard, and usable hosts', () => {
    const res = calculateSubnet('10.24.8.15/22');
    expect(res).not.toBeNull();
    if (!res) return;
    expect(res.version).toBe(4);
    expect(res.normalizedCidr).toBe('10.24.8.0/22');
    expect(res.networkAddress).toBe('10.24.8.0');
    expect(res.lastAddress).toBe('10.24.11.255');
    expect(res.netmask).toBe('255.255.252.0');
    expect(res.wildcardMask).toBe('0.0.3.255');
    expect(res.firstUsable).toBe('10.24.8.1');
    expect(res.lastUsable).toBe('10.24.11.254');
    expect(res.totalAddresses).toBe('1,024');
    expect(res.usableHosts).toBe('1,022');
    expect(res.scope).toBe('private');
  });

  it('handles RFC 3021 /31 point-to-point and /32 host routes accurately', () => {
    const p2p = calculateSubnet('172.16.0.9/31');
    expect(p2p?.firstUsable).toBe('172.16.0.8');
    expect(p2p?.lastUsable).toBe('172.16.0.9');
    expect(p2p?.usableHosts).toBe('2');

    const single = calculateSubnet('100.64.12.5/32');
    expect(single?.usableHosts).toBe('1');
    expect(single?.scope).toBe('cgnat');
  });

  it('calculates IPv6 /64 and compresses zero runs per RFC 5952', () => {
    const v6 = parseIpv6('2001:0db8:0000:0000:0001:0000:0000:0000');
    expect(v6).not.toBeNull();
    // Trailing 3-hextet zero run is longer than leading 2-hextet run; RFC 5952 collapses the longer run
    expect(formatIpv6Compressed(v6!)).toBe('2001:db8:0:0:1::');

    const sub = calculateSubnet('fd00:abcd:12:34::99/64');
    expect(sub).not.toBeNull();
    if (!sub) return;
    expect(sub.version).toBe(6);
    expect(sub.normalizedCidr).toBe('fd00:abcd:12:34::/64');
    expect(sub.lastAddress).toBe('fd00:abcd:12:34:ffff:ffff:ffff:ffff');
    expect(sub.totalAddresses).toBe('18,446,744,073,709,551,616');
    expect(sub.scope).toBe('private');
  });

  it('rejects malformed addresses and out-of-range prefixes', () => {
    expect(calculateSubnet('256.0.0.1/24')).toBeNull();
    expect(calculateSubnet('192.168.1.1/33')).toBeNull();
    expect(calculateSubnet('2001:db8::1::2/64')).toBeNull();
    expect(calculateSubnet('2001:db8::1/129')).toBeNull();
  });
});
