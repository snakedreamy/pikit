import { describe, expect, it } from 'vitest';
import { deriveBookmarkMonogram } from './monogram';

describe('deriveBookmarkMonogram', () => {
  it('prefers explicit icon_text up to 3 characters', () => {
    expect(deriveBookmarkMonogram('TrueNAS Scale', 'nas')).toBe('NAS');
    expect(deriveBookmarkMonogram('内网主路由', '路由')).toBe('路由');
  });

  it('derives clean 2-letter initials from multi-word or camelCase names', () => {
    expect(deriveBookmarkMonogram('Proxmox VE')).toBe('PV');
    expect(deriveBookmarkMonogram('Caddy Gateway')).toBe('CG');
    expect(deriveBookmarkMonogram('TrueNAS')).toBe('TN');
    expect(deriveBookmarkMonogram('Jellyfin')).toBe('JE');
  });

  it('derives single CJK character for Chinese titles', () => {
    expect(deriveBookmarkMonogram('内网主路由')).toBe('内');
    expect(deriveBookmarkMonogram('家庭相册')).toBe('家');
  });
});
