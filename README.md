# SCADBridge

SCADBridge is a browser-side compiler from SolidCraft's parametric feature timeline to
readable, independently reproducible OpenSCAD source.

It runs inside the SolidCraft web app, reads the design through `window.solidcraft`,
builds a geometry intermediate representation, emits SCAD, and validates the result with
OpenSCAD WebAssembly in the same tab. A SCAD file can also be opened into SolidCraft, edited
there, and written back.

## Motivation

Graphical CAD makes chamfers, fillets, sketches, face offsets and geometry-dependent
booleans much easier than writing OpenSCAD by hand. But exporting STL or STEP preserves the
evaluated shape, not the instructions and parameters that produced it.

The initial specification starts from that gap:

> The objective is not to replace any of these applications. It is to establish a
> reproducible engineering pipeline that preserves design intent rather than merely
> exchanging geometric meshes.

SCADBridge recovers the modeling operations and parameters from SolidCraft and turns them
into OpenSCAD source that can be regenerated and modified independently. The intended
pipeline is:

```text
SolidCraft      parametric part construction
SCADBridge      translation, provenance and validation
OpenSCAD        reproducible declarative source
Blender         presentation and rendering (future)
```

The first version is deliberately limited to atomic mechanical parts. Assemblies,
kinematics, joints and motion studies are out of scope. The full initial specification is
in [docs/SPEC.md](docs/SPEC.md).

The governing requirement:

> SCADBridge shall translate parametric part definitions and modeling operations from
> SolidCraft into independently reproducible, human-readable OpenSCAD programs, selecting
> geometrically equivalent constructions from native CSG, hull, Minkowski sums, offsets,
> extrusions, and approved external libraries. The compiler shall preserve parameter
> dependencies, validate geometric equivalence, and avoid nonparametric fallbacks unless
> explicitly requested.

## Runtime

The implementation is browser-only. No desktop application, MCP server or SolidCraft fork is
required to compile a part.

```text
SolidCraft web app tab
  window.solidcraft
        |
        v
  SCADBridge overlay (TypeScript)
        |
        v
  geometry IR -> SCAD emitter
        |
        v
  OpenSCAD WebAssembly (runtime dependency)
        |
        v
  mesh metrics compared with SolidCraft measurements
```

The OpenSCAD WebAssembly build is GPL-2.0 and is loaded at runtime from a CDN. BOSL2 is
bundled as a compressed BSD-2-Clause dependency and mounted in the validator so generated
SCAD can use `include <BOSL2/std.scad>`.

## Status

Working:

- SolidCraft browser command API and timeline inspection.
- Geometry IR for primitives, transforms, booleans, sketches, extrusions, holes, fillets,
  shells and chamfers.
- Native OpenSCAD emission for box, cylinder, sphere, move, union, difference, intersection,
  simple extrusions, holes, constant-radius box fillets, box shells and chamfers.
- Native 2D sketch modules using `polygon()` and `circle()`.
- SCAD import of parameters, primitives, transforms, booleans, hulls, `for` loops and
  tapered cylinders.
- Write back to the opened `.scad` through the File System Access API.
- OpenSCAD WebAssembly validation against SolidCraft volume, area, bounding box and centroid.
- BOSL2 dependency mounted in the validator.

Next: revolve, torus, mirror, patterns, pipe, sweep, loft, thread and the remaining Create
menu operations. See the [GitHub issues](https://github.com/jegb/scadbridge/issues).

## Quick start

Requirements:

- Node 22
- Rust and `trunk` for the SolidCraft web build
- SolidCraft v0.15.0 checkout at `../solidcraft`
- Chrome or Edge for in-place Update. Other browsers fall back to a download.

```bash
git clone git@github.com:jegb/scadbridge.git
git clone --branch v0.15.0 https://github.com/tangency-labs/solidcraft ../solidcraft

git -C ../solidcraft apply ../scadbridge/integrations/solidcraft-web.patch

cd browser
npm install
npm run build

cd ../solidcraft/apps/solidcraft-web
trunk serve --release
```

Open `http://127.0.0.1:8781/?webgl`. The SCADBridge panel appears on the right.

If the patch does not apply cleanly, reset the SolidCraft checkout to v0.15.0 and try again,
or apply it with `git apply --3way`.

### Use

1. Open a `.scad` with **SolidCraft File > Open...**.
2. Edit or add features in SolidCraft.
3. **Compile SCAD** to inspect the generated source.
4. **Validate** to render it independently and compare against SolidCraft.
5. **Update SCAD** to write the new source back to the opened file.

`File > Export SCAD…` downloads a copy instead.

**Update** writes in place when the browser retained the file handle. If not, it opens the
save dialog so you can choose the same file. A download happens only when the browser lacks
the File System Access API.

OpenSCAD sees a new modification time after Update. Enable **Design > Automatic Reload and
Compile** in OpenSCAD to refresh its view automatically.

## Supported operations

| SolidCraft feature | SCAD output | Status |
|---|---|---|
| Box | `cube()` | Supported |
| Cylinder | `cylinder()`, including tapered `d1`/`d2` | Supported |
| Sphere | `sphere()` | Supported |
| Move | `translate()`, `rotate()` | Supported |
| Combine | `union()`, `difference()`, `intersection()` | Supported |
| Primitive join/cut/intersect | CSG with target bodies | Supported |
| Sketch | Native 2D `polygon()` / `circle()` module | Supported |
| Extrude | `linear_extrude()` of the sketch profile | Supported |
| Hole | `difference()` with cylinder cutters | Simple and counterbore |
| Chamfer | `difference()` with an extruded triangular cutter | Straight edges on axis-aligned boxes |
| Fillet | Square-minus-cylinder corner cutter | Constant radius on convex box edges |
| Shell | Inner box subtraction | Box bodies, inside direction, open faces |
| Revolve | `rotate_extrude()` | Planned |
| Torus | `rotate_extrude()` of a circle | Planned |
| Mirror | `mirror()` | Planned |
| Rectangular pattern | `for` + `translate()` | Planned |
| Circular pattern | `for` + `rotate()` | Planned |
| Pattern on path, sweep, loft, thread | BOSL2 or generated constructions | Planned |
| Pipe, coil, rib, web, emboss, boundary fill | Generated CSG | Planned |
| Joint origin, assemblies | Not part geometry | Out of scope |

Unsupported features produce explicit diagnostics. Generated source never silently falls
back to an imported mesh.

## UAT checklist

Apply the operation in SolidCraft, then use **Compile SCAD**, **Validate** and **Update SCAD**.
Volumes are for the stated fixtures and will differ for other dimensions.

| Operation | Fixture | Expected volume | Status |
|---|---|---:|---|
| Sketch | Rectangle sketch | 2D `polygon()` module | PASS |
| Extrude | Rectangle 0-5, height 5 | 125 mm³ | PASS |
| Extrude cut | 5×5×5 cut into the 20 mm cube | 7875 mm³ | PASS |
| Sphere | Radius 10 | 4188.49 mm³ | PASS |
| Sphere cut | Radius 5 at the cube corner | 7934.57 mm³ | PASS |
| Cube + separate sphere | Cube plus radius 5 sphere as a second body | 8523.56 mm³ | PASS |
| Sphere in a component | Sphere created inside Component1, moved, root activated | 8523.56 mm³ | PASS |
| Component sphere cut | Sphere inside Component1, root Combine cut | 7934.57 mm³ | PASS |
| Cube + component sphere r10 | Sphere inside Component1, no combine yet | 12188.49 mm³ | PASS |
| Hole | 5 mm vertical through hole | 7607.37 mm³ | PASS |
| Counterbore | 5 mm hole with 10 × 3 counterbore | 7430.82 mm³ | PASS |
| Chamfer | 2 mm on any box edge | 7960 mm³ | PASS |
| Fillet | 2 mm on a box edge | 7982.82 mm³ | PASS |
| Fillet after hole | 5 mm hole, then 2 mm fillet | 7590.18 mm³ | PASS |
| Fillet after shell | 2 mm shell + 2 mm fillet | 3374.82 mm³ | PASS |
| Fillet on extrusion | 20 mm extruded square + 2 mm fillet | 7982.82 mm³ | PASS |
| Shell | 2 mm, +X face open | 3392 mm³ | PASS |
| Boolean cut | 6 mm cylinder through | 7434.61 mm³ | PASS |
| Boolean join | Extruded body joined to the cube | Union | PASS |
| Torus | Major 10, minor 2 | 789.45 mm³ | PASS |
| Mirror | YZ, combine with original | 16000 mm³ | PASS |
| Rectangular pattern | 2 copies, 20 mm spacing | 16000 mm³ | PASS |
| Circular pattern | 4 copies, 360° | 32000 mm³ | PASS |
| Coil | 20 mm, 5 turns, 50 mm, 2 mm wire | 986.47 mm³ | PASS (2% volume tolerance) |
| Bounding solid | Cube + 2 mm margin | 21824 mm³ | PASS |
| Revolve | — | — | Not yet |
| Sweep / Loft | — | — | Not yet |
| Pipe / Thread | — | — | Not yet |
| Boundary fill / Rib / Web / Emboss | — | — | Not yet |
| Pattern on path | — | — | Not yet |
| Sketch arcs, splines, holes | — | — | Not yet |
| Multi-profile extrusions | — | — | Not yet |

Multi-body results (patterns, bounding solids) are validated body by body, matching SolidCraft's
per-body measurements.

## Validation and tests

```bash
cd browser
npm test
npm run typecheck
node ../scripts/browser-smoke.mjs   # needs trunk serve running
```

The smoke test drives headless Chrome and checks:

- Test cube compilation and validation.
- Chamfer on an imported cube, including a previously broken edge orientation.
- Hole, fillet, shell, boolean cut, sphere cut and sketch extrusion cut.
- Complex `handle_support.scad` import.
- BOSL2 rendering.
- Write back through a stubbed writable handle.

Current checks use volume, surface area, bounding box and centroid. Surface deviation and
parameter-domain sweeps are tracked in the issue list.

## Repository layout

```text
browser/          TypeScript overlay, compiler and validator
  src/              window.solidcraft adapter, IR, emitter, planner, validator
  public/           BOSL2 bundle
scripts/          overlay installer and headless smoke test
integrations/     SolidCraft web app patch
examples/         reference SCAD files and expected values
docs/             specification, backlog, licensing
```

## Roadmap

The live backlog is in [docs/BACKLOG.md](docs/BACKLOG.md) and the issue tracker:
https://github.com/jegb/scadbridge/issues

Near-term:

- Revolve, torus, mirror, rectangular and circular patterns.
- Pipe and coil.
- Loft and sweep through BOSL2.
- Surface deviation validation.
- Managed-block SCAD writer that preserves user text.
- SolidCraft version and schema guard.
- CI with unit and browser tests.

Blender presentation and assembly kinematics remain future work.

## License

BSD 2-Clause. See [LICENSE](LICENSE) and [docs/LICENSING.md](docs/LICENSING.md).

OpenSCAD is GPL-2.0-or-later and is used as an external runtime. BOSL2 is BSD-2-Clause and
is bundled with its license file. SolidCraft is Apache-2.0 OR MIT and is patched only in the
local web checkout.
