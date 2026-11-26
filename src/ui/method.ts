import { el, fmtInt, fmtSI, fmtNum, type Child } from '../core/util';
import {
  CPU_COMPOSITE,
  CPU_REFERENCE,
  CPU_WEIGHTS,
  GPU_REFERENCE,
  GPU_WEIGHTS,
  GPU_TEST_INFO,
  OVERALL_FORMULA,
  SUITE,
  TIMING,
} from '../core/suite';
import { WORKLOAD_INFO } from '../core/workloads';
import { card, cardHead, note, tag } from './components';
import type { View } from './types';
import type { WorkloadId } from '../core/workloads';
import type { GpuTestId } from '../core/suite';

function table(headers: string[], rows: Child[][], numericFrom = 1): HTMLElement {
  const t = el('table', { class: 'data' });
  t.appendChild(el('thead', null, el('tr', null, ...headers.map((label, index) => el('th', { class: index >= numericFrom ? 'num' : undefined }, label)))));
  const body = el('tbody');
  for (const row of rows) {
    body.appendChild(el('tr', null, ...row.map((cell, index) => el('td', { class: index >= numericFrom ? 'num' : undefined }, cell))));
  }
  t.appendChild(body);
  return el('div', { class: 'table-wrap' }, t);
}

export function methodView(): View {
  const cpuWeights: Child[][] = (Object.keys(CPU_WEIGHTS) as WorkloadId[]).map((id) => [
    WORKLOAD_INFO[id].label,
    WORKLOAD_INFO[id].opDefinition,
    `${Math.round(CPU_WEIGHTS[id] * 100)} %`,
    `${fmtSI(CPU_REFERENCE[id], 1, 'ops/s')}`,
  ]);

  const gpuWeights: Child[][] = (Object.keys(GPU_WEIGHTS) as GpuTestId[]).map((id) => [
    GPU_TEST_INFO[id].label,
    GPU_TEST_INFO[id].detail,
    `${Math.round(GPU_WEIGHTS[id] * 100)} %`,
    `${fmtSI(GPU_REFERENCE[id], 1, 'ops/s')}`,
  ]);

  const timingRows: Child[][] = [
    ['Single-Core je Arbeitslast', `${TIMING.quick.cpuSingleMs} ms`, `${TIMING.full.cpuSingleMs} ms`],
    ['Multi-Core je Arbeitslast', `${TIMING.quick.cpuMultiMs} ms`, `${TIMING.full.cpuMultiMs} ms`],
    ['Dauerlast-Durchläufe', '0', `${TIMING.full.sustainedTrials} × ${TIMING.full.sustainedMs} ms`],
    ['GPU-Test je Arbeitslast', `${TIMING.quick.gpuTestMs} ms`, `${TIMING.full.gpuTestMs} ms`],
    ['Pause zwischen GPU-Tests', '—', `${TIMING.full.pauseBetweenGpuMs} ms`],
    ['Abkühlpause nach CPU', `${TIMING.quick.pauseAfterCpuMs} ms`, `${TIMING.full.pauseAfterCpuMs} ms`],
  ];

  const node = el(
    'div',
    null,
    el(
      'div',
      null,
      el('div', { class: 'eyebrow' }, el('span', { class: 'eyebrow-dot' }), `Suite ${SUITE.version}`),
      el('h1', { style: 'font-size:clamp(1.7rem,3.4vw,2.2rem);margin-top:10px' }, 'Methodik'),
      el(
        'p',
        { class: 'lede', style: 'margin-top:8px' },
        'Wie BENCH misst, wie Scores entstehen und welche Grenzen das Messen im Browser hat. Alles, was einen Score beeinflusst, ist hier festgelegt und versioniert.',
      ),
    ),

    el(
      'div',
      { class: 'section' },
      card([
        cardHead('Grundprinzip', tag('neutral', 'lokal')),
        el(
          'p',
          { class: 'small muted', style: 'line-height:1.65' },
          'Jeder Test führt echte Berechnungen auf dem Gerät aus. Es gibt keine hinterlegten Hardwarewerte, keine simulierten Ergebnisse und keine Anpassung an ein erwartetes Gerät. '
            + 'Gemessen wird ausschließlich Zeit: performance.now() im Worker für CPU-Arbeit, synchronisierte Frame-Zeiten und optional GPU-Timer-Queries für Grafikarbeit. '
            + 'Scores sind gemessener Durchsatz, normiert auf eine fest definierte Basis dieser Suite-Version.',
        ),
        el(
          'div',
          { class: 'row', style: 'margin-top:12px;gap:6px' },
          tag('measured', 'gemessen'),
          el('span', { class: 'footnote' }, 'Zeit, Durchsatz, Frame-Zeiten, Skalierung'),
          tag('derived', 'berechnet'),
          el('span', { class: 'footnote' }, 'Scores, Stabilität, Effizienz-Proxy'),
          tag('na'),
          el('span', { class: 'footnote' }, 'Watt, Temperatur, Takt, Auslastung'),
        ),
      ]),
    ),

    el(
      'div',
      { class: 'section' },
      card([
        cardHead('Fairness über Plattformen', tag('measured', 'gleiche Arbeit überall')),
        el(
          'p',
          { class: 'small muted', style: 'line-height:1.65' },
          'BENCH hat keinen Plattform-Pfad: Es gibt keinen Code, der je nach Betriebssystem, Browser oder Geräteklasse andere Arbeit ausführt, anders gewichtet oder einen Bonus vergibt. '
            + 'iOS, iPadOS, Android, macOS und Windows durchlaufen exakt dieselben Arbeitslasten mit denselben Seeds, Größen und Shadern.',
        ),
        el(
          'ul',
          { class: 'stack', style: 'gap:9px;padding-left:18px;margin:12px 0 0' },
          ...[
            'GPU: feste interne Auflösung 1280 × 720, identische Shader, 262 144 Punkte, ~77 k Dreiecke, 262 144 Partikel — unabhängig von Display, Pixeldichte und Seitenverhältnis.',
            'GPU: Der Simulationszustand liegt auf jedem Browser als RGBA8 vor. Es gibt keinen Float-Pfad für Browser mit EXT_color_buffer_float, denn unterschiedliche Bytes pro Texel wären eine andere Arbeitslast.',
            'CPU: gleicher Code und gleiche Seeds; kalibriert wird nur die Batch-Größe an die Gerätegeschwindigkeit, nicht die Art der Arbeit.',
            'CPU: ein Worker pro vom Browser gemeldeten logischen Kern, maximal 16. Damit werden auch Geräte mit mehr als acht Kernen vollständig gemessen; die tatsächlich verwendete Zahl steht in jedem Ergebnis.',
            'Kein Referenzgerät, keine Gewichtung nach User-Agent, keine erwarteten Hardwarewerte. WebGPU wird nur zusätzlich geprüft und fließt nicht in den Score ein.',
            'Messungen starten nur bei sichtbarem Tab; wird er währenddessen verdeckt, pausiert der GPU-Test und das Ergebnis wird entsprechend gekennzeichnet.',
          ].map((entry) => el('li', { class: 'small muted', style: 'line-height:1.6' }, entry)),
        ),
        el(
          'p',
          { class: 'footnote', style: 'margin-top:12px;line-height:1.6' },
          'Was sich nicht angleichen lässt und deshalb im Ergebnis steht: Treiber- und Browser-Implementierungen (ANGLE, Metal, Vulkan), die Engine-Ausführung von Math.sin/cos, die Wahl zwischen integrierter und diskreter GPU, Software-Rasterizer sowie thermische Drosselung. '
            + 'Innerhalb derselben Suite-Version sind Scores deshalb vergleichbar, aber kein Laborvergleich.',
        ),
      ]),
    ),

    el(
      'div',
      { class: 'section' },
      card([
        cardHead('CPU-Messung', tag('measured', 'Web Worker')),
        el(
          'div',
          { class: 'stack', style: 'gap:10px' },
          el(
            'p',
            { class: 'small muted', style: 'line-height:1.65' },
            'Vier deterministische Arbeitslasten laufen in einem eigenen Worker. Vor der Messung kalibriert der Worker die Batch-Größe so, dass ein Batch auf dem jeweiligen Gerät etwa 24–32 ms dauert. '
              + 'Dadurch wird auf schnellen wie langsamen Geräten dieselbe Art von Arbeit gemessen, ohne dass Overhead pro Batch die Werte dominiert.',
          ),
          el(
            'p',
            { class: 'small muted', style: 'line-height:1.65' },
            'Single-Core: ein Worker führt alle Lasten nacheinander aus. Multi-Core: ein Worker pro logischem Kern (maximal 16) führt dieselben Batches gleichzeitig aus. '
              + 'Der aggregierte Durchsatz ist die Summe aller Operationen geteilt durch die längste gemessene Worker-Laufzeit — es wird keine Zeit doppelt gezählt. '
              + 'Der Full Test wiederholt die Multi-Core-Last mehrfach mit Abkühlpausen und vergleicht den letzten mit dem besten Durchlauf.',
          ),
          el(
            'p',
            { class: 'footnote' },
            'Der Browser meldet nur logische Kerne. Physische Kerne, SMT und Big-/Little-Aufteilung sind nicht auslesbar — die Anzahl getesteter Worker wird deshalb immer mit angegeben.',
          ),
        ),
        el('div', { style: 'margin-top:16px' }, table(['Arbeitslast', 'Definition einer Operation', 'Gewicht', 'Referenz'], cpuWeights)),
        el(
          'p',
          { class: 'footnote', style: 'margin-top:10px' },
          `CPU-Score = ${Math.round(CPU_COMPOSITE.single * 100)} % Single-Core + ${Math.round(CPU_COMPOSITE.multi * 100)} % Multi-Core. `
            + 'Jede Arbeitslast wird einzeln auf ihre Referenz normiert (Referenz = Score 1000) und dann gewichtet gemittelt.',
        ),
      ]),
    ),

    el(
      'div',
      { class: 'section' },
      card([
        cardHead('GPU-Messung', tag('measured', 'WebGL2')),
        el(
          'p',
          { class: 'small muted', style: 'line-height:1.65' },
          'Alle vier Grafiklasten rendern in ein Framebuffer mit fester interner Auflösung von 1280 × 720. Die Displayauflösung und das Seitenverhältnis des Geräts beeinflussen den Score daher nicht. '
            + 'Nach jedem Batch wird ein Pixel mit readPixels gelesen. Das blockiert, bis die GPU die Arbeit abgeschlossen hat — gemessen wird also fertige Arbeit, nicht nur das Absenden von Befehlen. '
            + 'Die Bildwiederholrate des Displays begrenzt die Messung nicht, weil nicht im requestAnimationFrame-Takt gezeichnet wird. '
            + 'Shader, Geometrie, Texturformate und Partikelanzahl sind auf allen Plattformen identisch — der Simulationszustand liegt überall als RGBA8 vor, damit keine optionalen Float-Erweiterungen die Arbeit verändern.',
        ),
        el(
          'p',
          { class: 'small muted', style: 'line-height:1.65;margin-top:10px' },
          'Wenn der Browser EXT_disjoint_timer_query_webgl2 bereitstellt, wird zusätzlich die reine GPU-Zeit je Frame erfasst. Fehlt die Erweiterung, wird das ausdrücklich vermerkt: '
            + 'Die Frame-Zeit enthält dann auch CPU- und Treiber-Overhead.',
        ),
        el('div', { style: 'margin-top:16px' }, table(['Arbeitslast', 'Was gerendert wird', 'Gewicht', 'Referenz'], gpuWeights)),
        el(
          'p',
          { class: 'footnote', style: 'margin-top:10px' },
          `GPU-Score = gewichtetes Mittel der vier Tests. Referenz = Score 1000. WebGPU wird nur zusätzlich geprüft und fließt nicht in den GPU-Score ein, `
            + 'damit WebGL2- und WebGPU-Läufe vergleichbar bleiben.',
        ),
      ]),
    ),

    el(
      'div',
      { class: 'section' },
      el(
        'div',
        { class: 'grid grid-2' },
        card([
          cardHead('Overall-Score', tag('derived', 'berechnet')),
          el('p', { class: 'mono small', style: 'margin-bottom:10px' }, OVERALL_FORMULA),
          el(
            'p',
            { class: 'small muted', style: 'line-height:1.65' },
            'Das geometrische Mittel bestraft einseitige Geräte: Ein sehr schneller Prozessor kann eine schwache GPU nicht vollständig ausgleichen. '
              + 'CPU- und GPU-Score bleiben immer einzeln sichtbar. Fehlt der GPU-Test, bleibt Overall leer.',
          ),
        ]),
        card([
          cardHead('Effizienz', tag('derived', 'Proxy')),
          el(
            'p',
            { class: 'small muted', style: 'line-height:1.65' },
            'Leistungsaufnahme in Watt ist im Browser nicht messbar. BENCH erfindet deshalb keine Wattwerte. '
              + 'Der Effizienz-Proxy kombiniert zwei tatsächlich gemessene Größen: die Parallelskalierung (Multi-Core-Durchsatz relativ zu Single-Core × Worker) '
              + 'und die Stabilität unter Dauerlast (Mittelwert der Durchläufe relativ zum besten Durchlauf).',
          ),
          el(
            'p',
            { class: 'footnote', style: 'margin-top:10px' },
            'Ohne Full Test gibt es keine Dauerlast und damit keinen Proxy. Das ist beabsichtigt.',
          ),
        ]),
      ),
    ),

    el(
      'div',
      { class: 'section' },
      card([
        cardHead('Quick und Full', tag('neutral', 'getrennt')),
        table(['Parameter', 'Quick', 'Full'], timingRows),
        el(
          'div',
          { style: 'margin-top:14px' },
          note(
            'Quick- und Full-Modus verwenden unterschiedliche Laufzeiten, Durchläufe und Auswertungen. Ihre Scores haben unterschiedliche Aussagekraft und werden in BENCH nirgends gegeneinander gerechnet.',
            'warn',
          ),
        ),
      ]),
    ),

    el(
      'div',
      { class: 'section' },
      card([
        cardHead('Grenzen der Messung', tag('na', 'bekannte Einschränkungen')),
        el(
          'ul',
          { class: 'stack', style: 'gap:9px;padding-left:18px;margin:0' },
          ...[
            'Leistungsaufnahme, Temperatur, Taktfrequenz und echte Hardwareauslastung sind über Web-APIs nicht verfügbar. Sie werden weder gemessen noch geschätzt.',
            'Browser drosseln Timer, Worker und Grafik im Hintergrund. Messungen bei verdecktem Tab sind nicht repräsentativ — BENCH warnt während des Tests.',
            'Thermische Drosselung ist geräteabhängig und wird nur indirekt über den Leistungsabfall unter Dauerlast sichtbar.',
            'JIT-Warmlauf, Garbage Collection und Betriebssystem-Scheduling erzeugen Streuung. BENCH misst mehrere Batches und verwendet die Gesamtzeit, nicht einzelne Ausreißer.',
            'Grafiktreiber und Browser-Implementierungen unterscheiden sich. Ein Vergleich über Browser hinweg ist möglich, aber kein Laborvergleich.',
            'Die JavaScript-Engines führen Math.sin, Math.cos und Math.sqrt unterschiedlich aus. Der Gleitkomma-Teil kann deshalb auf identischer Hardware zwischen Safari und Chrome abweichen.',
            'Welche GPU ein Browser verwendet (integriert oder diskret), entscheidet der Browser; powerPreference ist nur ein Hinweis. Läuft WebGL auf einem Software-Rasterizer, wird das im Ergebnis vermerkt.',
            'Ein Score ist kein Qualitätsurteil über ein Gerät, sondern ein Durchsatzmaß für diese konkreten Arbeitslasten.',
          ].map((entry) => el('li', { class: 'small muted', style: 'line-height:1.6' }, entry)),
        ),
      ]),
    ),

    el(
      'div',
      { class: 'section' },
      el(
        'div',
        { class: 'grid grid-2' },
        card([
          cardHead('Versionierung', tag('neutral', SUITE.version)),
          el(
            'p',
            { class: 'small muted', style: 'line-height:1.65' },
            'Suite-Version, CPU-Testsuite und GPU-Testsuite werden mit jedem Ergebnis gespeichert und auf der Ergebnisseite angezeigt. '
              + 'Ändern sich Arbeitslasten, Gewichte oder Referenzwerte, steigt die Version — ältere Ergebnisse bleiben als solche markiert und werden nicht mit neuen gemischt.',
          ),
          el(
            'p',
            { class: 'footnote', style: 'margin-top:10px' },
            `Referenzbasis: ${SUITE.normalization}. Die Referenzwerte sind feste Konstanten der Suite, keine Messung eines bestimmten Geräts.`,
          ),
        ]),
        card([
          cardHead('Daten und Datenschutz', tag('neutral', 'lokal')),
          el(
            'p',
            { class: 'small muted', style: 'line-height:1.65' },
            'BENCH hat kein Backend, keine Konten und keine Analyse. Ergebnisse liegen ausschließlich im localStorage dieses Browsers und lassen sich dort löschen. '
              + 'Die Teilen-Funktion erzeugt eine Grafik im Gerät und übergibt sie an das native Teilen-Menü — ein Versand findet nur statt, wenn du ihn auslöst.',
          ),
          el(
            'p',
            { class: 'footnote', style: 'margin-top:10px' },
            `Messdauer Full Test: typischerweise ${'1–2'} Minuten, abhängig von der Geräteleistung.`,
          ),
        ]),
      ),
    ),

    el(
      'p',
      { class: 'footnote', style: 'margin-top:24px' },
      `BENCH Suite ${SUITE.version} · CPU ${SUITE.cpuVersion} · GPU ${SUITE.gpuVersion} · ${fmtInt(4)} Arbeitslasten je Bereich`,
    ),
  );

  return { node };
}
