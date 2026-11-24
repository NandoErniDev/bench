import './styles.css';
import { el, svg, ICONS } from './core/util';
import { applyTheme, getThemeMode, resolveTheme, setThemeMode, type ThemeMode } from './core/storage';
import { initRouter, navigate, type Route } from './ui/router';
import { homeView } from './ui/home';
import { runView } from './ui/run';
import { resultView } from './ui/result';
import { compareView } from './ui/compare';
import { methodView } from './ui/method';
import { experimentsView, labView } from './ui/experiments';
import type { View } from './ui/types';

const app = document.getElementById('app');
if (!app) throw new Error('App-Container fehlt');

const NAV_ITEMS = [
  { path: '/', label: 'Benchmark' },
  { path: '/experiments', label: 'Experimente' },
  { path: '/compare', label: 'Vergleich' },
  { path: '/method', label: 'Methode' },
];

const themeButton = el('button', {
  class: 'icon-btn',
  type: 'button',
  'aria-label': 'Darstellung wechseln',
  title: 'Darstellung',
});

function updateThemeButton(): void {
  const mode = getThemeMode();
  const resolved = resolveTheme(mode);
  themeButton.replaceChildren(svg(mode === 'auto' ? ICONS.contrast : resolved === 'dark' ? ICONS.moon : ICONS.sun));
  themeButton.title =
    mode === 'auto'
      ? `Darstellung: Automatisch (${resolved === 'dark' ? 'Dunkel' : 'Hell'}) — klicken für Hell`
      : mode === 'light'
        ? 'Darstellung: Hell — klicken für Dunkel'
        : 'Darstellung: Dunkel — klicken für Automatisch';
}

themeButton.addEventListener('click', () => {
  const mode = getThemeMode();
  const next: ThemeMode = mode === 'auto' ? 'light' : mode === 'light' ? 'dark' : 'auto';
  setThemeMode(next);
  updateThemeButton();
});

const navLinks = NAV_ITEMS.map((item) =>
  el('a', { class: 'nav-link', href: `#${item.path}` }, item.label),
);

const nav = el(
  'header',
  { class: 'nav' },
  el(
    'div',
    { class: 'nav-inner' },
    el(
      'a',
      { class: 'brand', href: '#/' },
      el('span', { class: 'brand-mark' }, 'B'),
      el('span', null, 'BENCH'),
    ),
    el('nav', { class: 'nav-links', 'aria-label': 'Hauptnavigation' }, ...navLinks),
    el('div', { class: 'nav-spacer' }),
    themeButton,
  ),
  el('nav', { class: 'nav-mobile', 'aria-label': 'Hauptnavigation mobil' }, ...navLinks.map((link) => link.cloneNode(true) as HTMLElement)),
);

const page = el('main', { class: 'page', id: 'page' });

const footer = el(
  'footer',
  { class: 'footer' },
  el(
    'div',
    { class: 'footer-inner' },
    el('span', null, `BENCH — Device Performance Benchmark · ${new Date().getFullYear()}`),
    el(
      'span',
      null,
      'Lokal im Browser gemessen · keine Konten · keine Datenübertragung · ',
      el('a', { href: '#/method' }, 'Methodik'),
    ),
  ),
);

app.append(nav, page, footer);

applyTheme(getThemeMode());
updateThemeButton();

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (getThemeMode() === 'auto') applyTheme('auto');
});

let current: View | null = null;

function updateNav(route: Route): void {
  const root = route.segments[0] ?? '';
  document.querySelectorAll<HTMLAnchorElement>('.nav-link').forEach((link) => {
    const target = (link.getAttribute('href') ?? '').replace(/^#/, '');
    const isActive = target === '/' ? root === '' : `/${root}` === target;
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function notFoundView(): View {
  return {
    node: el(
      'div',
      { class: 'stack', style: 'gap:16px;padding:40px 0' },
      el('h1', null, 'Seite nicht gefunden'),
      el('p', { class: 'muted' }, 'Diese Adresse gehört nicht zu BENCH.'),
      el('div', null, el('a', { class: 'btn primary', href: '#/' }, 'Zur Startseite')),
    ),
  };
}

function mount(route: Route): void {
  current?.destroy?.();
  current = null;

  const [first, second] = route.segments;
  let view: View;
  if (!first) view = homeView();
  else if (first === 'run') view = runView({ mode: route.query.get('mode') === 'full' ? 'full' : 'quick' });
  else if (first === 'result') view = resultView(second ?? '');
  else if (first === 'compare') view = compareView();
  else if (first === 'method') view = methodView();
  else if (first === 'experiments') view = second ? labView(second) : experimentsView();
  else view = notFoundView();

  page.replaceChildren(view.node);
  current = view;
  updateNav(route);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

initRouter(mount);

window.addEventListener('hashchange', () => {
  /* router handles it; kept for clarity of lifecycle */
});

void navigate;
