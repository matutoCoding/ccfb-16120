import './styles.css';
import { store } from './data/store';
import { router } from './app/router';
import { h, clear } from './app/dom';
import { renderLedgerPage } from './pages/ledger';
import { renderTowersPage } from './pages/towers';
import { renderConductorsPage } from './pages/conductors';
import { renderCheckPage } from './pages/check3d';
import { renderGallopingPage } from './pages/galloping';
import { renderReportPage } from './pages/report';

const NAV = [
  { path: 'ledger', label: '线路台账' },
  { path: 'towers', label: '杆塔排位' },
  { path: 'conductors', label: '导线工况' },
  { path: 'check3d', label: '三维校核' },
  { path: 'galloping', label: '舞动回放' },
  { path: 'report', label: '校核报告' },
] as const;

const RENDERERS: Record<string, (root: HTMLElement) => void> = {
  ledger: renderLedgerPage,
  towers: renderTowersPage,
  conductors: renderConductorsPage,
  check3d: renderCheckPage,
  galloping: renderGallopingPage,
  report: renderReportPage,
};

function renderShell(): void {
  const app = document.getElementById('app')!;
  clear(app);
  const line = store.line;

  const nav = h('div', { class: 'nav' });
  for (const item of NAV) {
    const btn = h('button', {
      textContent: item.label,
      onclick: () => router.go(item.path),
    });
    if (router.current === item.path) btn.classList.add('active');
    nav.append(btn);
  }

  const topbar = h('div', { class: 'topbar' }, [
    h('div', { class: 'logo', innerHTML: '覆冰弧垂·舞动 <span>三维校核</span>' }),
    h('div', { class: 'line-name', textContent: line ? `${line.name} · ${line.voltage}` : '' }),
    nav,
  ]);

  const pageRoot = h('div', { class: 'page' });
  app.append(topbar, pageRoot);

  const path = router.current || 'ledger';
  const renderer = RENDERERS[path] ?? renderLedgerPage;
  renderer(pageRoot);
}

async function bootstrap(): Promise<void> {
  await store.init();
  router.register('ledger', () => renderShell());
  for (const p of Object.keys(RENDERERS)) {
    if (p !== 'ledger') router.register(p, () => renderShell());
  }
  router.onChange(renderShell);
  router.start('ledger');
}

void bootstrap();
