type RouteHandler = (params: Record<string, string>) => void;

const routes = new Map<string, RouteHandler>();
let current = '';
const changeListeners = new Set<() => void>();

export const router = {
  register(path: string, handler: RouteHandler): void {
    routes.set(path, handler);
  },
  go(path: string): void {
    if (path === current) return;
    current = path;
    location.hash = `#/${path}`;
    changeListeners.forEach((fn) => fn());
    const handler = routes.get(path);
    if (handler) handler({});
  },
  start(defaultPath = 'ledger'): void {
    const apply = () => {
      const hash = location.hash.replace(/^#\//, '') || defaultPath;
      current = hash;
      changeListeners.forEach((fn) => fn());
      const handler = routes.get(hash);
      if (handler) handler({});
    };
    window.addEventListener('hashchange', apply);
    apply();
  },
  get current(): string {
    return current;
  },
  onChange(fn: () => void): () => void {
    changeListeners.add(fn);
    return () => changeListeners.delete(fn);
  },
};
