import { el, svg, ICONS } from '../core/util';
import { mountMandelbrot } from '../labs/mandelbrot';
import { mountVolume } from '../labs/volume';
import { mountParticles } from '../labs/particles';
import { mountTerrain } from '../labs/terrain';
import { note, tag } from './components';
import type { View } from './types';

interface ExperimentDefinition {
  slug: string;
  title: string;
  description: string;
  long: string;
  tech: string;
  icon: string;
  mount: (host: HTMLElement, controls: HTMLElement) => { destroy: () => void };
}

const EXPERIMENTS: ExperimentDefinition[] = [
  {
    slug: 'mandelbrot',
    title: 'Mandelbrot Explorer',
    description: 'Interaktives Zoomen durch die Mandelbrot-Menge, vollständig im Fragment-Shader berechnet.',
    long:
      'Jedes Pixel führt die Iteration selbst aus. Iterationszahl, Farbpalette und Renderauflösung sind einstellbar; die Anzeige liefert Frame-Zeit und Pixeldurchsatz in Echtzeit.',
    tech: 'Fragment-Shader · Iteration',
    icon: ICONS.layers,
    mount: mountMandelbrot,
  },
  {
    slug: 'volume',
    title: 'Volume Shader',
    description: 'Echtzeit-Raymarching durch ein prozedurales 3D-Volumen mit Gradienten-Beleuchtung.',
    long:
      'Der Shader tastet ein animiertes Dichtefeld ab und beleuchtet es über den Gradienten. Die Schrittzahl steuert Qualität und Rechenlast unmittelbar.',
    tech: 'Raymarching · Beleuchtung',
    icon: ICONS.waves,
    mount: mountVolume,
  },
  {
    slug: 'particles',
    title: 'Particle Simulation',
    description: 'Bis zu eine Million Partikel — wahlweise auf der GPU oder in JavaScript auf der CPU.',
    long:
      'Beide Pfade führen dieselbe Integration aus. Damit lässt sich der Unterschied zwischen GPU-Ping-Pong und CPU-Schleife auf demselben Gerät direkt vergleichen.',
    tech: 'GPGPU · CPU-Vergleich',
    icon: ICONS.bolt,
    mount: mountParticles,
  },
  {
    slug: 'terrain',
    title: '3D Rendering',
    description: 'Prozedurale Landschaft mit Schattenwurf, Beleuchtung und Nebel in Echtzeit.',
    long:
      'Die Höhenkarte wird im Browser erzeugt, Normalen werden analytisch berechnet, Schatten entstehen in einem eigenen Tiefenpass. Detailgrad und Auflösung verändern die Last direkt.',
    tech: 'Shadow Map · Terrain',
    icon: ICONS.cube,
    mount: mountTerrain,
  },
];

export function experimentsView(): View {
  const cards = EXPERIMENTS.map((experiment) =>
    el(
      'a',
      { class: 'card feature', href: `#/experiments/${experiment.slug}`, style: 'text-decoration:none;color:inherit' },
      el('div', { class: 'feature-icon' }, svg(experiment.icon)),
      el('h3', null, experiment.title),
      el('p', null, experiment.description),
      el(
        'div',
        { class: 'row between', style: 'margin-top:auto;padding-top:8px' },
        el('span', { class: 'feature-meta' }, experiment.tech),
        el('span', { class: 'card-link' }, 'Öffnen', svg(ICONS.arrow)),
      ),
    ),
  );

  const node = el(
    'div',
    null,
    el(
      'div',
      null,
      el('div', { class: 'eyebrow' }, el('span', { class: 'eyebrow-dot' }), 'Interactive Experiments'),
      el('h1', { style: 'font-size:clamp(1.7rem,3.4vw,2.2rem);margin-top:10px' }, 'Interaktive Hardware-Demos'),
      el(
        'p',
        { class: 'lede', style: 'margin-top:8px' },
        'Vier Experimente, die vollständig auf deinem Gerät berechnet und gerendert werden. Sie sind unabhängig von den standardisierten Scores: '
          + 'Sie zeigen, wie sich Rechenlast und Bildrate verhalten, wenn du Qualität, Auflösung oder Detailgrad veränderst.',
      ),
    ),
    el('div', { class: 'grid grid-2', style: 'margin-top:26px' }, ...cards),
    el(
      'div',
      { class: 'section' },
      note(
        'Die Experimente laufen in Echtzeit und belasten die GPU dauerhaft. Für einen Benchmark mit stabilen, vergleichbaren Werten nutze den '
          + '<a href="#/">standardisierten Test</a>. Alle Anzeigen sind echte Messwerte: Frame-Zeiten aus dem Render-Loop, keinerlei geschätzte Auslastungsprozente.',
        'default',
      ),
    ),
  );

  return { node };
}

export function labView(slug: string): View {
  const definition = EXPERIMENTS.find((experiment) => experiment.slug === slug);
  if (!definition) {
    return {
      node: el(
        'div',
        { class: 'stack', style: 'gap:14px;padding:24px 0' },
        el('h1', { style: 'font-size:1.8rem' }, 'Experiment nicht gefunden'),
        el('p', { class: 'muted' }, 'Dieses Experiment existiert nicht.'),
        el('a', { class: 'btn secondary', href: '#/experiments' }, 'Alle Experimente'),
      ),
    };
  }

  const canvasHost = el('div', { class: 'lab-canvas' });
  const controls = el('aside', { class: 'lab-side' });

  const node = el(
    'div',
    null,
    el('a', { class: 'breadcrumb', href: '#/experiments' }, '← Alle Experimente'),
    el(
      'div',
      { class: 'experiment-hero' },
      el(
        'div',
        null,
        el('h1', { style: 'font-size:clamp(1.6rem,3.2vw,2.1rem)' }, definition.title),
        el('p', null, definition.long),
      ),
      el('div', { class: 'row', style: 'gap:6px' }, tag('neutral', definition.tech), tag('na', 'unabhängig vom Score')),
    ),
    el('div', { class: 'lab' }, canvasHost, controls),
    el(
      'div',
      { class: 'section' },
      note(
        'Dieses Experiment fließt nicht in CPU-, GPU- oder Overall-Score ein. Es zeigt das Verhalten unter frei wählbarer Last — nicht ein standardisiertes Ergebnis.',
        'default',
      ),
    ),
  );

  let instance: { destroy: () => void } | null = null;
  let disposed = false;

  const attach = () => {
    if (disposed || !node.isConnected) {
      if (!disposed) requestAnimationFrame(attach);
      return;
    }
    try {
      instance = definition.mount(canvasHost, controls);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      canvasHost.replaceChildren(
        el('div', { class: 'lab-error' }, `Dieses Experiment konnte nicht gestartet werden: ${message}`),
      );
    }
  };
  requestAnimationFrame(() => requestAnimationFrame(attach));

  return {
    node,
    destroy() {
      disposed = true;
      instance?.destroy();
      instance = null;
    },
  };
}
