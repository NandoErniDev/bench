import { el, svg, ICONS } from '../core/util';
import { mountMandelbrot } from '../labs/mandelbrot';
import { mountVolume } from '../labs/volume';
import { mountParticles } from '../labs/particles';
import { mountTerrain } from '../labs/terrain';
import { mountRaymarch } from '../labs/raymarch';
import { mountFluid } from '../labs/fluid';
import { mountPathtracer } from '../labs/pathtracer';
import { mountReaction } from '../labs/reaction';
import { mountAttractor } from '../labs/attractor';
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
    description: 'Deep-Zoom durch die Mandelbrot-Menge — jenseits von 800-fach rechnet der Shader in exaktem 64-Bit-Festkomma.',
    long:
      'Jedes Pixel baut seine Koordinate aus einem 60 Bit breiten Nachkommafeld und iteriert in reiner Ganzzahlarithmetik, '
      + 'sobald du tiefer als rund 800-fach zoomst. Ganzzahlen kann kein Compiler umsortieren, deshalb bleibt das Bild dort scharf, '
      + 'wo Doppel-Float-Shader auf Apple-GPUs stillschweigend auf einfache Genauigkeit zurückfallen. '
      + 'Die Iterationszahl wächst automatisch mit dem Zoom, Supersampling und Renderauflösung kommen obendrauf.',
    tech: 'Festkomma 64 Bit · Iteration',
    icon: ICONS.layers,
    mount: mountMandelbrot,
  },
  {
    slug: 'volume',
    title: 'Volume Shader',
    description: 'Echtzeit-Raymarching durch ein prozedurales 3D-Volumen — vier Oktaven Rauschen pro Dichtefunktion.',
    long:
      'Der Shader tastet ein animiertes Dichtefeld aus vier Rauschebenen ab und beleuchtet es über den Gradienten. '
      + 'Jeder Schritt kostet vier komplette Dichtefunktionen; die Schrittzahl steuert Qualität und Rechenlast unmittelbar.',
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
  {
    slug: 'raymarch',
    title: 'Mandelbulb Raymarcher',
    description: 'Ein Fraktal als Distanzfeld: bis zu 1024 Raymarching-Schritte, jeder mit voller Mandelbulb-Iteration.',
    long:
      'Der Shader sucht die Oberfläche eines Mandelbulbs über seine Distanzfunktion — ohne Mesh, ohne Dreiecke. '
      + 'Jeder Schritt ruft eine komplette Fraktal-Iteration auf, Beleuchtung, Ambient Occlusion und Schatten lösen weitere Abfragen aus. '
      + 'Auf Smartphones fällt die Bildrate hier bewusst in den einstelligen Bereich.',
    tech: 'Raymarching · Distanzfeld',
    icon: ICONS.sphere,
    mount: mountRaymarch,
  },
  {
    slug: 'fluid',
    title: 'GPU Fluid',
    description: 'Navier-Stokes in Echtzeit: Advektion, Wirbelstärke und bis zu 192 Druck-Iterationen pro Bild.',
    long:
      'Pro Frame laufen Advektion, Wirbelstärke, Divergenz, Abklingen, der Jacobi-Drucksolver und der Gradientenabzug über das komplette Raster. '
      + 'Jeder Durchlauf schreibt ein Float-Ziel; bei 512² und 64 Iterationen sind das über 18 Millionen Texel pro Bild, bei 2048² entsprechend mehr.',
    tech: 'GPGPU · Fluiddynamik',
    icon: ICONS.waves,
    mount: mountFluid,
  },
  {
    slug: 'pathtracer',
    title: 'Path Tracer',
    description: 'Progressive Monte-Carlo-Pfadverfolgung mit bis zu 16 Bounces und 16 Samples pro Bild.',
    long:
      'Jedes Sample verfolgt einen Strahl über mehrere diffuse Reflexionen und addiert das Ergebnis in einen Fließkommapuffer. '
      + 'Stillstehende Kamera konvergiert zu einem sauberen Bild, jede Bewegung startet die Akkumulation neu. '
      + 'Das ist die schwerste Last der Sammlung — die GPU rechnet hier ohne Pause.',
    tech: 'Monte-Carlo · Akkumulation',
    icon: ICONS.orbit,
    mount: mountPathtracer,
  },
  {
    slug: 'reaction',
    title: 'Reaktions-Diffusion',
    description: 'Gray-Scott-Chemie auf der GPU: zwei Stoffe diffundieren und reagieren zu Korallen, Zellen und Wurmgeflechten.',
    long:
      'Zwei Chemikalien durchdringen sich, reagieren miteinander und bilden aus winzigen Störungen komplexe Muster — vollständig auf der GPU, '
      + 'Schritt für Schritt. Jeder Schritt liest ein 3×3-Nachbarschaftsfenster für den Laplace-Operator und schreibt zwei neue Konzentrationen. '
      + 'Raster und Schritte pro Bild skalieren die Last linear; die Regler für Zufuhr und Abbau wechseln zwischen Korallen, Zellen und chaotischem Flimmern.',
    tech: 'GPGPU · Reaktions-Diffusion',
    icon: ICONS.waves,
    mount: mountReaction,
  },
  {
    slug: 'attractor',
    title: 'Seltsamer Attraktor',
    description: 'Bis zu eine Million Partikel in einem Aizawa-Attraktor, additiv in einen nachleuchtenden Spurenpuffer gezeichnet.',
    long:
      'Jedes Partikel integriert ein chaotisches Vektorfeld mit einem Runge-Kutta-Schritt zweiter Ordnung und wird anschließend als '
      + 'additiv geblendeter Punkt in einen Float-Puffer gezeichnet, der pro Bild leicht abklingt und am Ende tonemapped wird. '
      + 'Aus einer Million Partikel wird so eine leuchtende, langsam rotierende Form, die aus nichts als einer Formel entsteht.',
    tech: 'Partikel · Tonemapping',
    icon: ICONS.orbit,
    mount: mountAttractor,
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
        'Neun Experimente, die vollständig auf deinem Gerät berechnet und gerendert werden. Sie sind unabhängig von den standardisierten Scores: '
          + 'Sie zeigen, wie sich Rechenlast und Bildrate verhalten, wenn du Qualität, Auflösung oder Detailgrad veränderst.',
      ),
    ),
    el('div', { class: 'grid grid-2', style: 'margin-top:26px' }, ...cards),
    el(
      'div',
      { class: 'section' },
      note(
        'Die Experimente laufen in Echtzeit und belasten die GPU dauerhaft — Mandelbulb-Raymarcher, GPU-Fluid und Path Tracer sind bewusst so schwer, '
          + 'dass sie auf Smartphones sichtbar einbrechen. Für einen Benchmark mit stabilen, vergleichbaren Werten nutze den '
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
