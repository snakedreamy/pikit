// Strict-CSP (`style-src 'self'`) dynamic CSS custom-property action:
// sets custom properties via CSSOM `node.style.setProperty('--var', value)` without touching HTML `style="..."` attributes.

export type CssVarMap = Record<string, string | number | undefined | null>;

export function cssVars(node: HTMLElement | SVGElement, vars: CssVarMap) {
  let prevKeys = new Set<string>();

  function apply(next: CssVarMap) {
    const nextKeys = new Set<string>();
    for (const [rawKey, val] of Object.entries(next)) {
      const prop = rawKey.startsWith('--') ? rawKey : `--${rawKey}`;
      if (val === undefined || val === null || val === '') {
        node.style.removeProperty(prop);
      } else {
        node.style.setProperty(prop, String(val));
        nextKeys.add(prop);
      }
    }
    for (const oldProp of prevKeys) {
      if (!nextKeys.has(oldProp)) {
        node.style.removeProperty(oldProp);
      }
    }
    prevKeys = nextKeys;
  }

  apply(vars);

  return {
    update(next: CssVarMap) {
      apply(next);
    },
    destroy() {
      for (const prop of prevKeys) {
        node.style.removeProperty(prop);
      }
    },
  };
}
