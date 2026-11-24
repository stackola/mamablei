# Design decisions

## Requirements (agreed)

| Topic | Decision |
|---|---|
| Model | **Blocks**: every closed shape is one acrylic pane; everything else is solid chrome. A block on top cuts into the blocks below, leaving one lead width of chrome. Lead lines split blocks. (Replaced the first "lines partition the plane" model on request.) |
| Templates | Presets (window grid, rosette, arch window, honeycomb, flower, diamonds) and a blank frame. Everything stays editable. |
| Glass | Coloured acrylic, default 2 mm. |
| Cut files | Laser SVG + DXF per colour, and a tiled 1:1 PDF on A4. |
| Retention | Glue / silicone. Nothing extra is generated. |
| Frame | Rectangle (optional rounded corners), circle/oval, custom polygon. Plain border; goes into a lightbox. |
| Size | Often larger than 60 × 60 cm, so automatic splitting is essential. |
| Chrome | After gluing the pieces together. Seams are filled and sanded first. |
| Printing | Front face up, sharp step (≈ 1–1.5 mm overhang, no supports). A1 mini: 180 mm bed, 5 mm margin by default. |
| Export | 3MF (one object per piece) + STL zip. |
| UI | German, laptop + mouse, local only (`npm run dev`). |
| Tools | Rectangle, circle, oval, triangle/regular polygon, arch/half circle, free polygon, lead line, paint bucket. Magnetic snapping at lead-width gaps, align & distribute, pack with lead gap, z-order. |
| UX | Mom-friendly: labelled tools, essentials only, everything technical behind "Mehr …". |
| Preview | Finished (chrome + backlit acrylic), print parts, exploded. |

## Block model

```
for each block from top to bottom:
    pane = block ∩ frame-inner − grow(all blocks above, lead width) − lead lines
    clean up: drop slivers narrower than "Mindestbreite Glas", round opening corners
chrome = frame − all panes
```

A ring of chrome around a block that sits entirely inside another block is not
connected to the frame. It is printed as a loose part held by the glued panes, and the
app reports it as a notice.

## Profile

```
                 ◄──── W ────►
                  ╭─────────╮         front (chrome), top edges rounded, radius r
       pane A     │   cap   │     pane B
                  └──┐   ┌──┘
  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   acrylic, glued in from the back
                     └───┘            back (light side) = print bed
                   ◄R►               stem = W − 2R
```

- Total height = acrylic thickness + glue allowance + cap thickness.
- r is limited to min(W/2, cap thickness). r = W/2 gives a full half-round like real lead came.
- The opening corner radius rounds the convex corners of every opening (top view).
- Glass areas narrower than "Mindestbreite Glas" become solid automatically.
- Acrylic cut = opening grown by (R − clearance).

## Rounded top: how the mesh is built

The lead footprint is eroded at N levels along a quarter-circle profile. The band
between two consecutive levels is triangulated as one polygon set: the outer level's
contours plus the inner level's contours reversed (as holes). Manifold's
`triangulate` keeps every input edge, so neighbouring bands share exact edges and the
result is watertight by construction. Topology changes between levels are handled
automatically: a lead that disappears at a level simply ends up as a flat top.

## Splitting

Seams are cheapest paths on a 0.5 mm raster of the lead footprint:

- Crossing material costs 1 per mm. Passing through an opening is almost free.
  Seams therefore cross lead lines at right angles at their narrowest spot, and the
  acrylic panes bridge the seam.
- Optional mode ("Nähte dürfen durch Glasflächen laufen" off): seams follow lead
  centrelines, so every pane stays inside one piece. The leads are then split
  lengthwise, which leaves ~0.8 mm half-stems at default settings. That is why it is
  not the default.
- First vertical seams create columns, then each column gets its own horizontal seams
  (brick pattern). Every seam may wander only as far as still lets the pieces fit the bed.

## Planned: domes

Domes (spherical caps) are planned. The pipeline keeps the design as a flat 2D pattern
and builds a flat solid, so a dome can be added as a final mapping step
(`Manifold.refineToLength` + `warp`, projecting z onto the sphere normal).
The acrylic would then need to be thermoformed or use small flat facets. That is still
to be decided.
