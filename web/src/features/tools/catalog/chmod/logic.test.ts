import { describe, expect, it } from 'vitest';
import {
  buildChmodCommands,
  formatOctalMode,
  formatSymbolicMode,
  parseOctalMode,
  parseSymbolicMode,
} from './logic';

describe('POSIX chmod calculator (rwx + SUID/SGID/Sticky two-way sync)', () => {
  it('converts standard and special permission modes accurately in both directions', () => {
    expect(formatOctalMode(0o640)).toBe('0640');
    expect(formatSymbolicMode(0o640)).toBe('rw-r-----');
    expect(parseSymbolicMode('-rw-r-----')).toBe(0o0640);

    // SUID + SGID + Sticky edge cases (`s`/`S` and `t`/`T`)
    expect(formatSymbolicMode(0o4755)).toBe('rwsr-xr-x');
    expect(parseSymbolicMode('rwsr-xr-x')).toBe(0o4755);

    expect(formatSymbolicMode(0o2640)).toBe('rw-r-S---');
    expect(parseSymbolicMode('rw-r-S---')).toBe(0o2640);

    expect(formatSymbolicMode(0o1777)).toBe('rwxrwxrwt');
    expect(parseSymbolicMode('drwxrwxrwt')).toBe(0o1777);

    expect(parseOctalMode('750')).toBe(0o0750);
    expect(parseOctalMode('0899')).toBeNull();
  });

  it('builds safe octal and symbolic chmod CLI commands', () => {
    const cmds = buildChmodCommands(0o0640, '/opt/pikbay/config.toml', false);
    expect(cmds.octalCmd).toBe('chmod 0640 /opt/pikbay/config.toml');
    expect(cmds.symbolicCmd).toBe('chmod u=rw,g=r,o= /opt/pikbay/config.toml');

    const quoted = buildChmodCommands(0o0755, 'my folder/run.sh', true);
    expect(quoted.octalCmd).toBe("chmod -R 0755 'my folder/run.sh'");
  });
});
