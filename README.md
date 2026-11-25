# BENCH — Device Performance Benchmark

BENCH ist eine plattformübergreifende Benchmark-Webseite für Smartphones, Tablets, Laptops und Desktop-PCs.
Ein Testlauf misst echte Rechen- und Grafikleistung direkt im Browser – ohne Installation, ohne Konto,
ohne Server und ohne Datenübertragung.

**Geplant:** `bench.naerdev.ch` · **Stack:** Vite · TypeScript · Web Workers · WebGL2 (WebGPU optional)

---

## Inhalt

- [Was BENCH macht](#was-bench-macht)
- [Benchmark-Umfang](#benchmark-umfang)
- [Messmethodik](#messmethodik)
- [Scores und Gewichtung](#scores-und-gewichtung)
- [Quick Test und Full Test](#quick-test-und-full-test)
- [Was Browser nicht messen können](#was-browser-nicht-messen-können)
- [Interactive Experiments](#interactive-experiments)
- [Ergebnisse und Teilen](#ergebnisse-und-teilen)
- [Projektstruktur](#projektstruktur)
- [Lokal starten](#lokal-starten)
- [Deployment](#deployment)
- [Browser-Support](#browser-support)

---

## Was BENCH macht

- **CPU-Benchmark** mit Integer-, Gleitkomma-, komplexer Mathematik- und FFT-Last, jeweils Single-Core und über alle Kerne.
- **GPU-Benchmark** mit Shader-Berechnung, Vertex-Durchsatz, einer beleuchteten 3D-Szene und einer GPGPU-Partikelsimulation.
- **Overall-Score** aus CPU und GPU mit offengelegter Formel, alle Einzelwerte bleiben sichtbar.
- **Effizienz und Stabilität** ausschließlich aus gemessenen Größen – keine erfundenen Wattwerte.
- **Zwölf interaktive Experimente**, die unabhängig von den Scores auf dem Gerät gerechnet werden.
- **Ergebnisbericht** mit Diagrammen und eine teilbare Grafik über das native Teilen-Menü.

Jeder Score entsteht aus einer echten Berechnung auf dem Gerät. Es gibt keine hinterlegten Hardwarewerte,
keine gerätespezifischen Erwartungswerte und keine Anpassung an ein Zielergebnis.

---

## Benchmark-Umfang

| Bereich | Arbeitslast | Messgröße |
| --- | --- | --- |
| CPU | Integer-Bitmix (32-Bit) | Operationen pro Sekunde |
| CPU | Gleitkomma mit `sin` / `cos` / `sqrt` / Division | Operationen pro Sekunde |
| CPU | Julia-Menge, 192 Iterationen | komplexe Iterationen pro Sekunde |
| CPU | Radix-2-FFT, 1024 Punkte | Butterflies pro Sekunde |
| GPU | Fullscreen-Fragment-Shader, 48 Iterationen pro Pixel | Pixel pro Sekunde |
| GPU | 262 144 Punkte mit Vertex-Transformation | Vertices pro Sekunde |
| GPU | Prozedurales Terrain, ~77 k Dreiecke, Beleuchtung | Dreiecke pro Sekunde |
| GPU | 262 144 Partikel, Ping-Pong-Render-Targets | Partikelschritte pro Sekunde |

Alle GPU-Lasten rendern in ein **festes 1280 × 720-Framebuffer**. Displayauflösung und Seitenverhältnis
des Geräts beeinflussen den Score damit nicht.

---

## Messmethodik

### CPU

Vier deterministische Arbeitslasten laufen in einem eigenen Web Worker. Vor der Messung kalibriert der
Worker die Batch-Größe so, dass ein Batch auf dem jeweiligen Gerät etwa 24–32 ms dauert. Dadurch wird auf
schnellen wie langsamen Geräten dieselbe Art von Arbeit gemessen, ohne dass Overhead pro Batch dominiert.

- **Single-Core:** ein Worker führt alle Lasten nacheinander aus.
- **Multi-Core:** ein Worker pro logischem Kern (maximal acht) führt dieselben Batches gleichzeitig aus.
  Der aggregierte Durchsatz ist die Summe aller Operationen geteilt durch die längste gemessene
  Worker-Laufzeit – es wird keine Zeit doppelt gezählt.
- **Dauerlast (nur Full Test):** die Multi-Core-Last wird mehrfach mit Abkühlpausen wiederholt.
  Verglichen werden bester, durchschnittlicher und letzter Durchlauf.

Gezählt werden ausschließlich primitive Operationen, die der Code tatsächlich ausführt; die Zeit kommt aus
`performance.now()` im Worker.

### GPU

- Jeder Batch wird mit `readPixels` synchronisiert. Gemessen wird also **abgeschlossene GPU-Arbeit**,
  nicht nur das Absenden von Befehlen.
- Es wird nicht im `requestAnimationFrame`-Takt gezeichnet, damit die Bildwiederholrate des Displays die
  Messung nicht begrenzt.
- Wenn der Browser `EXT_disjoint_timer_query_webgl2` bereitstellt, wird zusätzlich die reine GPU-Zeit
  je Frame erfasst. Fehlt die Erweiterung, wird das im Ergebnis ausdrücklich vermerkt.
- Im Full Test wird der Shader-Test zusätzlich bei 100 %, 70 % und 50 % Auflösung gemessen, um die
  Auflösungsabhängigkeit sichtbar zu machen.

### Reproduzierbarkeit

- Feste Seeds, deterministische Arbeitslasten, kalibrierte Batch-Größen.
- Suite-Version, CPU-Testsuite und GPU-Testsuite werden mit jedem Ergebnis gespeichert.
- Ergebnisse unterschiedlicher Versionen oder unterschiedlicher Modi werden nie direkt gegeneinander
  gerechnet – der Vergleich blockiert das ausdrücklich.

---

## Scores und Gewichtung

```
CPU-Score = 40 % Single-Core + 60 % Multi-Core
GPU-Score = 40 % Shader + 20 % Vertex + 25 % Szene + 15 % Simulation
Overall   = √(CPU-Score × GPU-Score)          gleiche Gewichtung 50 / 50
```

Jede Arbeitslast wird auf eine **fest definierte Referenzbasis** normiert (Referenz = Score 1000) und
dann gewichtet gemittelt. Die Referenzwerte sind dokumentierte Konstanten der Suite-Version – keine
Messung eines bestimmten Geräts. Sie wurden mit den echten Arbeitslasten kalibriert
(`scripts/calibrate.ts`).

Der Overall-Score ist bewusst ein geometrisches Mittel: Ein sehr schneller Prozessor kann eine schwache
GPU nicht vollständig ausgleichen. Fehlt der GPU-Test, bleibt Overall leer statt einen Ersatzwert zu bilden.

### Effizienz

Leistungsaufnahme in Watt ist im Browser nicht messbar. BENCH erfindet deshalb keine Wattwerte. Der
Effizienz-Proxy kombiniert zwei tatsächlich gemessene Größen:

- **Parallelskalierung:** Multi-Core-Durchsatz relativ zu Single-Core × Anzahl Worker
- **Stabilität:** durchschnittlicher Dauerlast-Score relativ zum besten Durchlauf

Ohne Full Test gibt es keine Dauerlast und damit keinen Proxy. Das ist beabsichtigt.

---

## Quick Test und Full Test

| Parameter | Quick | Full |
| --- | --- | --- |
| CPU Single-Core je Last | 800 ms | 1800 ms |
| CPU Multi-Core je Last | 800 ms | 2200 ms |
| Dauerlast | – | 3 × 1600 ms mit Pausen |
| GPU je Last | 1200 ms | 3200 ms |
| Auflösungsskalierung | – | 3 Stufen |
| Typische Dauer | ~15 s | ~1–2 min |

Quick- und Full-Scores haben unterschiedliche Aussagekraft und werden in BENCH nirgends direkt
vermischt. Während längerer Belastungen legt BENCH Abkühlpausen ein; jeder Test lässt sich jederzeit
abbrechen, und es werden keine unvollständigen Werte gespeichert.

---

## Was Browser nicht messen können

Diese Werte werden weder gemessen noch geschätzt und überall als „nicht verfügbar" gekennzeichnet:

- Leistungsaufnahme in Watt
- Temperatur und thermische Drosselung (nur indirekt über den Leistungsabfall sichtbar)
- Taktfrequenz
- prozentuale CPU- / GPU-Auslastung
- physische Kerne, SMT- und Big-/Little-Aufteilung (der Browser meldet nur logische Kerne)

Zusätzlich gilt: Browser drosseln Timer, Worker und Grafik im Hintergrund. BENCH warnt während des Tests,
wenn der Tab verdeckt ist.

---

## Interactive Experiments

Unabhängig von den standardisierten Scores – frei wählbare Last, echte Berechnung im Browser:

1. **Mandelbrot Explorer** – Deep-Zoom ohne Präzisionsanschlag. Bis rund 800-fach rechnet der Shader in einfachem
   float; darüber schaltet er auf **64-Bit-Festkomma** mit 60 Nachkommabits um und iteriert in exakter
   Ganzzahlarithmetik (drei 64×64-Bit-Multiplikationen pro Schritt). Der Zoommittelpunkt liegt als 120-Bit-Festkomma
   in JavaScript. Die Iterationszahl wächst automatisch mit der Zoomstufe, dazu 1–4 Samples pro Pixel, vier Paletten
   und einstellbare Renderauflösung; Anzeige von Frame-Zeit, Zoomstufe, Genauigkeitspfad und Pixeldurchsatz.
2. **Volume Shader** – Echtzeit-Raymarching durch ein prozedurales Dichtefeld aus vier Rauschebenen mit
   Gradienten-Beleuchtung; 24–1536 Schritte, Volumendichte und Renderauflösung regelbar.
3. **Particle Simulation** – bis zu 4 194 304 Partikel, wahlweise als GPGPU-Ping-Pong oder als
   JavaScript-Schleife auf der CPU; beide Pfade werden getrennt gemessen.
4. **3D Rendering** – prozedurale Landschaft mit Shadow-Map, PCF-Schatten und Nebel; Detailgrad bis
   1024² Gitter, Auflösung und Schatten zuschaltbar.
5. **Mandelbulb Raymarcher** – Fraktal als Distanzfeld, 64–4096 Raymarching-Schritte mit voller
   Mandelbulb-Iteration (bis 64 Iterationen), 1–16 Samples pro Pixel, 9-stufige Ambient Occlusion und
   Soft-Shadows über 96 Schritte. Bewusst so schwer, dass Smartphones in den einstelligen FPS-Bereich
   fallen – auf einem M1 ist selbst der Standard schon sichtbar zäh.
6. **GPU Fluid** – Navier-Stokes auf der GPU: Advektion, Wirklichkeitskonfinement, Jacobi-Drucksolver
   (4–1024 Iterationen pro Bild) und Gradientenabzug im Ping-Pong; Simulationsraster 128²–3072².
7. **Path Tracer** – progressive Monte-Carlo-Pfadverfolgung mit Float-Akkumulation, 1–64 Bounces und
   1–64 Samples pro Bild; stehende Kamera konvergiert, Bewegung startet die Akkumulation neu.
8. **Reaktions-Diffusion** – Gray-Scott-Gleichungen auf der GPU: neun Texturlesungen pro Texel und Schritt,
   bis 3072² Raster und 256 Schritte pro Bild; Zufuhr und Abbau wechseln zwischen Korallen, Zellen und Flimmern.
9. **Seltsamer Attraktor** – bis zu 4 194 304 Partikel im Aizawa-Vektorfeld (Runge-Kutta 2. Ordnung), additiv
   in einen abklingenden Float-Spurenpuffer gezeichnet und anschließend tonemapped.
10. **Fraktur-Schlucht** – 3D-Landschaft ohne Geometrie: Die Oberfläche wird pro Strahl aus ridged Rauschen
    geraymarcht, mit acht Bisektionsschritten verfeinert, über 96 Schritte weich beschattet und in einem
    Wasserspiegel mit Fresnel-Reflexion gespiegelt. Wolken, Nebel und Sonnenstreuung liegen im Shader,
    Detailgrad (2–8 Oktaven), Schrittzahl (64–2048), Samples (1–16) und Auflösung bis 250 % sind regelbar.
11. **Schleimpilz-Netzwerk** – Physarum-Polycephalum auf der GPU: bis zu 4 194 304 Agenten lesen drei
    Sensoren aus einer Float-Textur, drehen sich und schreiben ihre Spur additiv in ein Raster bis 4096²,
    das pro Schritt verwischt und gedämpft wird. Aus Nachlaufen entstehen Adernnetze.
12. **Ereignishorizont** – ein Schwarzes Loch mit echter Lichtkrümmung: Jeder Strahl integriert die
    Bahngleichung u″ = −u + 1,5·rs·u² mit Runge-Kutta 4. Ordnung, bis er den Horizont kreuzt oder entkommt.
    Die Akkretionsscheibe wird im Äquatorialschnitt getroffen, per Turbulenz strukturiert und über die
    Dopplerverschiebung einseitig aufgehellt; 64–4096 Bahnschritte, 1–16 Samples pro Pixel, Auflösung bis 250 %.

---

## Ergebnisse und Teilen

Nach jedem Test erscheint eine vollständige Auswertung mit Geräte- und Browserangaben, Testversion,
Modus, allen Scores, Messdauern, Diagrammen und – im Full Test – Stabilitätswerten.

Der Share-Button erzeugt eine 1200 × 1500-Grafik im Gerät und übergibt sie an das native Teilen-Menü
(WhatsApp, AirDrop, Messages, …). Ohne Dateifreigabe wird die Grafik als PNG gespeichert und die
Zusammenfassung in die Zwischenablage kopiert. Kein Konto, kein Upload.

Ergebnisse liegen ausschließlich im `localStorage` des Browsers (maximal 30 Läufe) und lassen sich dort
löschen. Der Vergleich stellt zwei gespeicherte Läufe desselben Modus und derselben Suite-Version
gegenüber.

---

## Projektstruktur

```
src/
├── core/                  Messung und Auswertung
│   ├── suite.ts           Versionen, Gewichte, Referenzen, Ergebnistypen
│   ├── workloads.ts       Deterministische CPU-Arbeitslasten
│   ├── cpu.ts             Orchestrierung Single-/Multi-Core und Dauerlast
│   ├── gpu.ts             WebGL2-Suite mit Timer-Queries
│   ├── webgpu.ts          Optionaler WebGPU-Compute-Test (nicht im Score)
│   ├── runner.ts          Ablauf, Pausen, Effizienz, Gesamtergebnis
│   ├── device.ts          Geräte- und Browsererkennung
│   └── storage.ts         Theme und lokale Läufe
├── workers/cpu.worker.ts  CPU-Messung im Worker
├── ui/                    Ansichten, Komponenten, SVG-Diagramme, Router
├── labs/                  Mandelbrot, Volume, Partikel, Terrain, Schlucht, Netzwerk, Loch
├── share/card.ts          Ergebnisgrafik und natives Teilen
└── styles.css             Design-System (hell/dunkel)
```

Neue Benchmark-Methoden lassen sich ergänzen, indem eine Arbeitslast in `core/workloads.ts` bzw. ein
GPU-Test in `core/gpu.ts` registriert und in `core/suite.ts` gewichtet wird; die Versionen machen
Änderungen an den Scores nachvollziehbar.

---

## Lokal starten

Voraussetzung: Node.js 20 oder neuer.

```bash
npm ci
npm run dev        # http://localhost:3000
npm run build      # Typecheck + Produktionsbuild nach dist/
npm run preview    # Produktionsbuild lokal ansehen
```

Optionale Kalibrierung der Score-Referenz:

```bash
node --experimental-strip-types scripts/calibrate.ts
```

---

## Deployment

BENCH ist eine rein statische Single-Page-App (Hash-Routing). Es braucht keinen Server, keine Functions,
keine Datenbank und keine Umgebungsvariablen.

### Empfehlung: Cloudflare Pages

Die Zone `naerdev.ch` liegt bereits bei Cloudflare. Damit bekommt `bench.naerdev.ch` DNS-Eintrag und
Zertifikat ohne manuelle Schritte, und es fallen keine Bandbreitenkosten an.

| Einstellung | Wert |
| --- | --- |
| Repository | dieses Repo |
| Production branch | `main` |
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Node version | 20 oder neuer (`NODE_VERSION=20`) |

Danach unter **Custom domains** → `bench.naerdev.ch` hinzufügen. Cloudflare legt den CNAME im
eigenen Zoneneintrag automatisch an. Kein Rewrite nötig: Die App nutzt Hash-Routing
(`/#/result/…`), es gibt keine Server-Routen.

### Alternative: Vercel

| Einstellung | Wert |
| --- | --- |
| Framework preset | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm ci` |

Custom Domain `bench.naerdev.ch` im Vercel-Projekt hinzufügen und den angezeigten CNAME
(`cname.vercel-dns.com`) bei Cloudflare als **DNS-only** (graue Wolke) eintragen. Proxy (orange Wolke)
kann Zertifikatsprüfungen von Vercel stören.

**Kurz:** Cloudflare Pages, weil die Domain ohnehin dort liegt – ein Klick für DNS und TLS, und der
statische Build braucht nichts anderes. Vercel funktioniert genauso, erfordert aber den zusätzlichen
CNAME-Eintrag.

---

## Browser-Support

| Browser | CPU | GPU | Experimente |
| --- | --- | --- | --- |
| Safari / iOS 16+ | ✅ | ✅ WebGL2 | ✅ |
| Chrome / Edge 111+ | ✅ | ✅ WebGL2 + GPU-Timer | ✅ |
| Firefox 115+ | ✅ | ✅ WebGL2 | ✅ |

- WebGL2 ist Voraussetzung für den GPU-Test; fehlt es, bleiben GPU- und Overall-Score leer.
- WebGPU wird optional erkannt und als Zusatzmessung ausgewiesen – es fließt bewusst nicht in den
  GPU-Score ein, damit WebGL2- und WebGPU-Ergebnisse vergleichbar bleiben.
- Ohne Web Worker ist kein CPU-Test möglich; dieser Fall wird gemeldet statt einen Wert zu schätzen.

---

## Datenschutz

Kein Backend, keine Konten, keine Analyse, keine Cookies, keine externen Schriften oder Skripte.
Alle Messungen und die Ergebnisgrafik entstehen lokal. Eine Übertragung findet nur statt, wenn die
Teilen-Funktion aktiv genutzt wird.
