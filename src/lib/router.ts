import { useEffect, useState } from 'react';

export type Route = { view: 'home' } | { view: 'stock'; ticker: string };

function parse(hash: string): Route {
  const match = hash.match(/^#\/stock\/([A-Za-z0-9.&-]+)/);
  if (match) return { view: 'stock', ticker: decodeURIComponent(match[1]).toUpperCase() };
  return { view: 'home' };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}
