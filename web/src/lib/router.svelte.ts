// Minimal client-side History API router (~50 lines, zero external dependencies)

export type RouteMatch =
  | { name: 'dashboard' }
  | { name: 'tools' }
  | { name: 'tool'; id: string }
  | { name: 'speedtest' }
  | { name: 'drop' }
  | { name: 'dev-ui' }
  | { name: 'not-found'; path: string };

export const DEV_UI_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_DEV_UI === 'true';

function normalizePath(raw: string): string {
  if (!raw || raw === '/') return '/';
  const cleaned = raw.split('?')[0].split('#')[0].replace(/\/+$/, '');
  return cleaned || '/';
}

export function matchRoute(pathname: string): RouteMatch {
  const clean = normalizePath(pathname);
  if (clean === '/') return { name: 'dashboard' };
  if (clean === '/tools') return { name: 'tools' };
  if (clean.startsWith('/tools/')) {
    try {
      const id = decodeURIComponent(clean.slice('/tools/'.length));
      if (id && !id.includes('/')) {
        return { name: 'tool', id };
      }
    } catch {
      return { name: 'not-found', path: clean };
    }
  }
  if (clean === '/speedtest') return { name: 'speedtest' };
  if (clean === '/drop') return { name: 'drop' };
  if (clean === '/dev/ui' && DEV_UI_ENABLED) return { name: 'dev-ui' };
  return { name: 'not-found', path: clean };
}

let currentPath = $state<string>(
  typeof window !== 'undefined' ? normalizePath(window.location.pathname) : '/'
);

const currentRoute = $derived<RouteMatch>(matchRoute(currentPath));

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    currentPath = normalizePath(window.location.pathname);
  });
}

export function getRoute(): RouteMatch {
  return currentRoute;
}

export function navigate(to: string, opts?: { replace?: boolean }): void {
  const next = normalizePath(to);
  if (next === currentPath) return;
  if (typeof window !== 'undefined') {
    if (opts?.replace) {
      window.history.replaceState(null, '', next);
    } else {
      window.history.pushState(null, '', next);
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }
  currentPath = next;
}
