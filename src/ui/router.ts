/** Tiny hash router. No dependency, works from file:// or any static host. */

export interface Route {
  path: string;
  segments: string[];
  query: URLSearchParams;
}

export function parseRoute(hash = window.location.hash): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart || '/';
  return {
    path,
    segments: path.split('/').filter(Boolean),
    query: new URLSearchParams(queryPart ?? ''),
  };
}

let handler: ((route: Route) => void) | null = null;

export function initRouter(callback: (route: Route) => void): void {
  handler = callback;
  window.addEventListener('hashchange', () => callback(parseRoute()));
  callback(parseRoute());
}

export function navigate(path: string): void {
  const target = `#${path}`;
  if (window.location.hash === target) {
    handler?.(parseRoute(target));
    return;
  }
  window.location.hash = path;
}

export function linkHref(path: string): string {
  return `#${path}`;
}
