# Bleiglas-Editor

Web-Editor für **3D-gedruckte „Bleiglas“-Rahmen**: Die Bleistege werden gedruckt
(und später verchromt), farbige Acrylscheiben werden von hinten in einen Falz
eingeklebt, das Ganze wird von hinten beleuchtet.

Der Editor läuft komplett im Browser, lokal, ohne Server und ohne Anmeldung.

## Starten

```bash
npm install
```

```bash
npm run dev
```

Dann <http://localhost:5173> öffnen. Der Entwurf wird automatisch im Browser
gespeichert. Mit **Speichern** lädt man ihn zusätzlich als `.bleiglas.json`-Datei herunter.

## Bedienung (kurz)

| Werkzeug | Taste | |
|---|---|---|
| Auswählen / Verschieben | V | Klicken = auswählen, ziehen = verschieben, leere Fläche ziehen = Ansicht verschieben |
| Linie | L | Endpunkte rasten an Raster und vorhandenen Linien ein |
| Rechteck | R | aufziehen |
| Kreis | K | von der Mitte aus aufziehen |
| Oval | O | aufziehen |
| Vieleck | P | Punkte klicken, Doppelklick / Enter schließt |
| Farbeimer | F | Farbe rechts wählen, Fläche anklicken („Massiv“ = Chrom-Fläche) |

- **Jede Form ist eine Bleilinie.** Alle Flächen dazwischen werden Glas.
- Mausrad = Zoom, `0` = alles zeigen, `Alt` gedrückt = Einrasten aus,
  `Shift` beim Eckgriff = Seitenverhältnis halten.
- `Strg+Z` / `Strg+Y` rückgängig / wiederholen, `Strg+D` duplizieren, `Entf` löschen,
  Pfeiltasten = verschieben.
- Rechts stehen alle Maße als Schieberegler. Die Profilskizze zeigt den Querschnitt eines Stegs.
- **Hinweise** warnen z. B. vor zu schmalen Stegen hinten oder vor Bleiteilen, die
  nicht mit dem Rahmen verbunden sind.

## Export

- **3MF für Bambu Studio**: alle Druckteile als einzelne Objekte (benannt „Teil A1“, „Teil B2“ …),
  Vorderseite nach oben. In Bambu Studio „Anordnen“ nutzen, um sie auf mehrere Platten zu verteilen.
- **STL (ZIP)**: ein STL pro Teil.
- **Laser: SVG / DXF je Farbe**: Acrylzuschnitte pro Farbe auf Platten gepackt
  (rot = schneiden, blau = Nummer).
- **Schablonen PDF (A4, 1:1)**: Übersichtsseite plus gekachelte 1:1-Seiten mit
  nummerierten Scheiben. Mit 100 % drucken und den 50-mm-Balken nachmessen.

## Druckhinweise

- Gedruckt wird **Vorderseite oben**, die Rückseite mit dem Falz liegt auf dem Druckbett.
  Der kleine Überhang am Falz (≈ 1–1,5 mm) druckt ohne Stützen.
- Für die Chromlackierung die Rundungen mit feiner bzw. variabler Schichthöhe drucken
  (0,08–0,12 mm). Chrom zeigt jede Schichtlinie.
- Große Fenster werden automatisch in Teile ≤ Bauraum − Rand (Standard 175 mm) zerlegt.
  Die Nähte laufen durch Glasflächen und kreuzen Bleistege nur quer an der schmalsten Stelle.
  Die eingeklebten Scheiben überbrücken die Nähte. Erst zusammenkleben, Nähte spachteln
  und schleifen, dann verchromen.

---

## Developer notes (English)

- Stack: Vite + React + TypeScript, [Manifold](https://github.com/elalish/manifold) (WASM) for
  all 2D (Clipper2) and 3D geometry, Three.js for the preview, fflate and jsPDF for exports.
- `src/geometry/layout2d.ts`: shapes → lead strokes → glass regions → openings, back step, acrylic cuts.
- `src/geometry/build3d.ts`: rounded lead profile (stacked offset contours stitched with
  constrained triangulation, so the mesh is watertight), minus the back step.
- `src/geometry/split.ts`: seams are cheapest paths on a raster of the lead footprint,
  run as columns first and then rows per column (brick pattern).
- The 3D build runs in a Web Worker (`src/geometry/worker.ts`); the 2D layout runs on the main thread.
- Tests: `npm test` (geometry, splitting, all export formats in Node).
- See [docs/DESIGN.md](docs/DESIGN.md) for the decisions behind the geometry.
