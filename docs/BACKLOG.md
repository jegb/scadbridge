# SCADBridge backlog

Updated 18 October 2026. Browser-only strategy. Blender is future work.

## Strategy

- Runtime: SolidCraft web app only. Integration uses `window.solidcraft`.
- Language: TypeScript in the browser.
- Validation: OpenSCAD WebAssembly loaded at runtime from a CDN.
- No native desktop app, no `solidcraft-cli`, no MCP in the bridge.
- Blender is parked. It is not in the v0.1 path.
- Reverse SCAD import and write-back remain post-v0.1.

## Milestones

| Milestone | Status | Exit criterion |
|---|---|---|
| M0 Connectivity and inspection | Done | Chamfer feature retrieved before and after parameter changes |
| M1 Minimal compiler and validation | Done | Test cube compiles, validates, and survives a parameter change |
| M2 Chamfer round-trip | Done for box edges | Chamfer survives width and distance changes in generated SCAD |
| M3 Extended operations | In progress | Sketch polygons, holes, fillets, shells, booleans, trims, patterns, torus, coil, bounding solids and BOSL2 done; revolve, sweep, loft, pipe, thread and others open |
| M4 Production integration | Planned | Version guard, provenance, CI, packaging |
| M5 Reverse SCAD import | Partial | SCAD test cube imported and written back |
| Future Blender pipeline | Parked | Revisit after M2 |

## M0 Connectivity and inspection

| ID | Item | Status | Notes |
|---|---|---|---|
| SB-001 | Browser overlay scaffold | Done | TypeScript, Vite, panel, installer script |
| SB-002 | `window.solidcraft` adapter | Done | `request`, `execute`, `inspect`, command discovery |
| SB-003 | Test cube through browser API | Done | Box, cylinder, boolean cut; panel button removed in favour of sample tiles |
| SB-004 | Timeline inspection | Done | Parameters, timeline, feature definitions, measurements |
| SB-005 | SolidCraft version and schema guard | Open | No version field exposed by the browser API; needs a probe and compatibility record |
| SB-006 | Chamfer inspection experiment | Done | Edge midpoint, feature definition before and after size 20 to 30 and chamfer 2 to 3 |
| SB-007 | Fixtures and expected values | Done | `examples/test_cube.scad`, `examples/test_cube.json`, smoke test |
| SB-008 | Provenance record | Open | Source revision exists; app version and translator version need recording |
| SB-009 | CI baseline | Partial | Unit tests and browser smoke script exist; no CI workflow |

M0 evidence: the chamfer feature keeps its stored edge midpoint `[0, 10, -10]`, reports no
error after the box grows from 20 mm to 30 mm, and volume changes from 7960 to 26865 mm³.
This is stored in `examples/test_cube.json`.

## M1 Minimal compiler and validation

| ID | Item | Status | Notes |
|---|---|---|---|
| SB-101 | Geometry IR v0.1 | Done | Typed features, parameters, diagnostics |
| SB-102 | Expression preservation | Partial | Unit suffix sanitization; expressions preserved as text; no AST |
| SB-103 | Feature extraction | Done | Box, cylinder, sphere, combine, move, remove, chamfer, unsupported |
| SB-104 | Deterministic SCAD emitter | Done | Stable modules and ordering; determinism unit test |
| SB-105 | Box, cylinder, sphere | Done | Placement, axis rotation, `$fn` |
| SB-106 | Transforms | Partial | Move translation and axis/angle rotation; scale and mirror missing |
| SB-107 | Boolean CSG | Done | Combine features and primitive join/cut/intersect with participants |
| SB-108 | Simple planar extrusion | Done | Single straight-line loop or circle, any sketch plane, positive/negative/symmetric; holes and multiple profiles open |
| SB-109 | Readable source layout | Partial | Modules and comments; module call indentation fixed, no source map comments |
| SB-110 | Golden SCAD tests | Partial | Unit expectations, no committed golden files |
| SB-111 | OpenSCAD WASM runner | Done | `openscad-wasm@0.0.4`, runtime CDN, captured log |
| SB-112 | Mesh metrics | Done | Volume, area, bbox, centroid, triangle count |
| SB-113 | Surface deviation | Open | Only aggregate metrics now |
| SB-114 | Tolerance profiles | Partial | Defaults in code; not per fixture |
| SB-115 | Parametric sweep | Partial | Emitter accepts overrides; UI and API sweep not wired |
| SB-116 | Validation report and failure policy | Partial | Diagnostics and pass/fail; no artifact persistence |
| SB-117 | Browser commands | Done | `window.scadbridge` plus panel actions |
| SB-118 | Test cube acceptance | Done | Headless browser smoke: volume error 0.0018%, bbox error 7e-15 mm |

M1 evidence from the smoke test:

- Reference volume 7434.607 mm³, generated 7434.741 mm³.
- Volume relative difference 0.0000179.
- Bounding box difference 7.1e-15 mm.
- Centroid difference 1.6e-15 mm.
- Validation PASS.

## M2 Chamfer round-trip

| ID | Item | Status | Notes |
|---|---|---|---|
| SB-201 | Chamfer extraction and edge identity | Done | Box edges; stale midpoints after size changes fall back to the nearest faces |
| SB-202 | BOSL2 dependency and adapter | Partial | BOSL2 bundled and mounted in the validator; operation adapter registry still open |
| SB-203 | Primitive substitution | Done | Native `difference` with an extruded triangular cutter; polygon winding chosen per edge and extended past the box |
| SB-204 | Cutter strategy | Done | Straight edges on axis-aligned boxes |
| SB-205 | Unsupported topology diagnostics | Done | E121 for non-box or ambiguous edges |
| SB-206 | Rewrite-rule validation | Done | GUI-applied chamfer on an imported cube validates at 0% volume difference |
| SB-207 | Round-trip demo | Done | Imported cube, GUI-applied chamfer, compile, validate and write back |
| SB-208 | Chamfer fixtures and docs | Partial | Unit and smoke coverage; more limit values needed |

## M3 Extended operations

| ID | Item | Status | Notes |
|---|---|---|---|
| SB-301 | Through holes and cutters | Done | Simple and counterbore; countersink emitted; drilled tips, threads and sketch-point holes unsupported |
| SB-302 | Patterns | Open | Rectangular and circular |
| SB-303 | `rotate_extrude` | Open | Revolve-like features |
| SB-304 | Straight-edge fillets | Done | Constant radius on convex axis-aligned box edges; variable/chord/g2 unsupported |
| SB-305 | Shell subset | Done | Box bodies, inside direction, one or more open faces; outside/both and tangent chains unsupported |
| SB-306 | Capability probe and support matrix | Partial | README table; no runtime probe |
| SB-307 | Sketch as native 2D polygon | Done | `polygon()`/`circle()` modules; extrude references them |
| SB-308 | BOSL2 dependency | Done | 68-file BSD-2 bundle, mounted in OpenSCAD WASM, native symlink |
| SB-309 | Revolve | Open | `rotate_extrude()` |
| SB-310 | Torus | Done | `rotate_extrude()` of a circle; 789.45 mm³ fixture passes |
| SB-311 | Mirror | Done | Native `mirror()`, combine and separate copy; 16000 mm³ fixture passes |
| SB-312 | Rectangular pattern | Done | Separate bodies named like SolidCraft; 16000 mm³ fixture passes |
| SB-313 | Circular pattern | Done | Separate bodies; 32000 mm³ fixture passes |
| SB-314 | Pattern on path | Open | BOSL2 `path_sweep`/`distribute` |
| SB-315 | Sweep | Open | BOSL2 `sweep`/`path_sweep` |
| SB-316 | Loft | Open | BOSL2 `skin`/`loft`; closes imported hull write-back |
| SB-317 | Pipe | Open | Direct difference for straight, BOSL2 for bends |
| SB-318 | Bounding solid | Done | Measured cube and per-body validation; 21824 mm³ fixture passes |
| SB-319 | Thread | Open | BOSL2 threading |
| SB-320 | Boundary fill | Open | Boolean intersection/union |
| SB-321 | Coil | Done | BOSL2 `path_sweep` along a helix; 986.47 mm³ fixture passes at 2% volume tolerance |
| SB-322 | Rib | Open | Generated profile extrusion + boolean |
| SB-323 | Web | Open | Repeated ribs/lofts |
| SB-324 | Emboss | Open | `text()`/profile + extrusion + boolean |
| SB-325 | Joint origin | Out of scope | Assembly constraint, not part geometry |
| SB-326 | Sketch arcs, splines and holes | Open | Tessellate or BOSL2 path handling |
| SB-327 | Multi-profile extrusions | Open | Multiple outer loops and holes |
| SB-328 | Pattern/mirror/copy body creation | Done | Move copies, mirror copies and pattern copies become separate named bodies |
| SB-329 | Primitive component body inference | Done | Sphere, box and cylinder bodies in components are inferred from topology and measured placement; move features are not applied twice |

M3 evidence from the browser smoke test:

- Hole: 7607.37 mm³, validation PASS.
- Constant fillet: 7982.82 mm³, validation PASS.
- Open shell: 3392.00 mm³, validation PASS.
- Primitive boolean cut: 7434.61 mm³, validation PASS.
- Chamfer remains 7960.00 mm³, validation PASS.
- Sketch extrusion cut into the cube: 7875.00 mm³, validation PASS.

M3 UAT evidence:

- Sketch, extrude, hole, counterbore, chamfer, fillet (plain, after hole, after shell, on extrusion), shell, sphere cut, boolean cut/join, extrude cut: volumes match and validation passes.
- Torus 789.45, mirror 16000, rectangular pattern 16000, circular pattern 32000, bounding 21824: validation passes.
- Coil 986.47 mm³ reference, 997.42 mm³ generated (1.1% helix-length difference), accepted at 2% volume tolerance.
- Multi-body validation renders each body separately, matching SolidCraft's per-body area and volume totals.
- Cube plus separate sphere and sphere inside a component: 8523.56 mm³, validation passes.
- The overlay hides itself while a SolidCraft dialog or file picker is open.

## M4 Production integration

| ID | Item | Status | Notes |
|---|---|---|---|
| SB-501 | Provenance sidecar | Open | Source hash, feature mapping, versions |
| SB-502 | Divergence detection | Open | Edited SCAD detection |
| SB-503 | `diff`, `report`, `connect` | Partial | Connect and inspect exist in the panel |
| SB-504 | Error code registry | Partial | E100, E101, E102, E110, E111, E120, E320; needs a table |
| SB-505 | Packaging and documentation | Partial | Build and install script documented |
| SB-506 | CI regression and release checklist | Open | GitHub Actions on macOS with Chrome |
| SB-507 | Performance benchmarks | Open | Compile and validate timing |

## M5 Reverse SCAD import

| ID | Item | Status | Notes |
|---|---|---|---|
| SB-601 | SCAD subset parser | Done | Assignments, zero-arg modules, primitives, transforms, booleans, hull, for, tapered cylinders |
| SB-602 | SCAD to SolidCraft command plan | Done | Parameter expressions preserved; hull and loops unrolled; unsupported syntax rejected |
| SB-603 | Import test cube | Done | Imported volume 7434.607 mm3, bbox exact, timeline box/move/cylinder/move/combine |
| SB-604 | SCAD writer and update | Partial | Writes in place through the retained handle, or the save dialog when no handle; managed blocks and user text preservation still open |
| SB-605 | Round-trip tests | Done | Import, change size 20 to 30, recompile uses size 30; chamfer write-back validated; handle_support imports at 0.03% volume difference |

File open status: SolidCraft's own **File > Open...** accepts `.scad`. The browser shell
hands the text to `window.scadbridgeOpenFile`, which rebuilds the timeline and updates the
viewport. The panel has **Update SCAD**; **Export SCAD…** is in SolidCraft's File menu.
The opened source and writable file handle are retained for write-back.

## Future Blender pipeline

| ID | Item | Status |
|---|---|---|
| SB-401 | Blender adapter and version check | Future |
| SB-402 | Export with object identity | Future |
| SB-403 | Scene reconciliation | Future |
| SB-404 | Cycles render command | Future |
| SB-405 | Example presentation scene | Future |
| SB-406 | Assembly instances and transforms | Future |

## Critical path

```
SB-005 (version guard)
        -> SB-108 (extrusion)
        -> SB-113 (surface deviation)
        -> SB-115 (parameter sweep)
        -> SB-201..207 (M2 chamfer round-trip)
        -> M3 / M4
```

## Open decisions

1. Chamfer strategy: BOSL2 rounded cuboid, generated cutter, or both behind the planner.
2. Version guard: what the browser API can expose today, and whether a small upstream
   SolidCraft change is needed.
3. Extrusion scope for M1: rectangle and circle profiles only, or arbitrary sketch loops.
4. Tolerance model: per-fixture values or a tolerance profile chosen by geometry type.

## Definition of done

Code, unit tests, browser smoke coverage, explicit diagnostics for unsupported geometry,
and no silent mesh fallback. A failed validation must never be presented as a verified
SCAD artifact.
