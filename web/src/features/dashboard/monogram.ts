// Automatic bookmark monogram derivation (fallback when no custom icon file is configured or loading fails)

const CJK_RE = /[\u3400-\u9FFF\uF900-\uFAFF]/;

export function deriveBookmarkMonogram(name: string, customText?: string): string {
  const custom = customText?.trim();
  if (custom) {
    return Array.from(custom).slice(0, 3).join('').toUpperCase();
  }

  const trimmed = name.trim();
  if (!trimmed) return '?';

  const chars = Array.from(trimmed);
  const firstCjk = chars.find((ch) => CJK_RE.test(ch));
  if (firstCjk) {
    return firstCjk;
  }

  // Multi-word or hyphenated titles (e.g. "Proxmox VE" -> "PV", "Caddy Gateway" -> "CG")
  const words = trimmed
    .split(/[\s._/-]+/)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  const single = words[0] ?? '';
  if (!single) {
    return chars[0].toUpperCase();
  }

  // CamelCase single words extract the first two uppercase letters (e.g. "TrueNAS" -> "TN", "NextCloud" -> "NC")
  const uppers = Array.from(single).filter((c) => c >= 'A' && c <= 'Z');
  if (uppers.length >= 2 && single[0] === uppers[0]) {
    return uppers[0] + uppers[1];
  }

  return single.slice(0, 2).toUpperCase();
}
