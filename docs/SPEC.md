# SCADBridge specification

## Governing requirement

SCADBridge shall translate parametric part definitions and modeling operations from
SolidCraft into independently reproducible, human-readable OpenSCAD programs, selecting
geometrically equivalent constructions from native CSG, hull, Minkowski sums, offsets,
extrusions, and approved external libraries. The compiler shall preserve parameter
dependencies, validate geometric equivalence, and avoid nonparametric fallbacks unless
explicitly requested.

Chamfer conversion is one application of the compiler, not its defining purpose.

## Design stance

SCADBridge is a geometry-aware compiler targeting OpenSCAD, not a feature-by-feature
converter from SolidCraft commands. SolidCraft and OpenSCAD can represent the same
geometry through different constructions. The compiler selects the most appropriate
construction, subject to geometric equivalence.

Examples of equivalent constructions for a rounded enclosure:

- `minkowski()` with a sphere or cylinder
- `hull()` over positioned primitives
- `offset()` on a 2D profile followed by `linear_extrude()`
- `difference()` with constructed cutting geometry
- a specialized library such as BOSL2
- a combination of the above

These differ in geometric correctness, computational cost, readability, and behavior
under parameter changes.

## Pipeline

```
SolidCraft feature timeline
          |
          v
  Semantic geometry extraction
          |
          v
  Geometry intermediate representation
          |
          v
  Construction planner
          |
          +-- CSG primitives (union, difference, intersection)
          +-- Geometric operators (hull, minkowski, offset)
          +-- Extrusion and transforms
          +-- Library-backed constructions (BOSL2 and approved libraries)
          +-- Specialized generated geometry
          |
          v
  Candidate SCAD constructions
          |
          v
  Cost and correctness evaluation
          |
          v
  OpenSCAD code generation
          |
          v
  Parametric geometry validation
```

## Supported OpenSCAD vocabulary

| Category | Constructs | Importance |
|---|---|---|
| Primitive solids | `cube`, `sphere`, `cylinder`, `polyhedron` | Fundamental |
| Boolean CSG | `union`, `difference`, `intersection` | Critical |
| Convex geometry | `hull` | Critical |
| Minkowski operations | `minkowski` | Critical |
| 2D geometric offsets | `offset` | High |
| Extrusions | `linear_extrude`, `rotate_extrude` | Critical |
| Transformations | `translate`, `rotate`, `scale`, `mirror`, `multmatrix` | Critical |
| 2D profiles | `circle`, `square`, `polygon`, `text`, `projection` | High |
| Program structure | modules, functions, loops, conditionals, variables | Critical |
| Mathematics | vector operations, trigonometry, interpolation | High |
| External libraries | BOSL2 and selected others | High |
| Imported geometry | STL, 3MF, DXF, SVG | Explicit fallback only |

The compiler must treat these as distinct operators. `minkowski()` is a geometric sum,
`hull()` builds a convex hull, and `offset()` operates on 2D geometry.

## Geometric recognition, not literal translation

A literal translator maps each SolidCraft operation to a similarly named OpenSCAD
function. That is not sufficient. For a connecting rod built as two extruded circles
plus a union, a more useful SCAD expression is a `hull()` of two cylinders. That rewrite
is valid only when the source geometry actually includes the connecting material.

Principle: optimization must preserve geometry, not merely produce a plausible shape.
The convex hull of two cylinders is not equivalent to their Boolean union unless the
source solid is convex between them.

## Candidate evaluation

For each recognized feature the planner may evaluate multiple candidates:

| Candidate | Parametric quality | Cost | Limitation |
|---|---|---|---|
| Extruded rounded 2D profile | Excellent | Low | Constant cross-section only |
| BOSL2 rounded cuboid | Excellent | Library-dependent | Must match supported semantics |
| Minkowski sum with sphere | Good | Potentially high | Rounds all directions, changes extents |
| Boolean cutters | Good | Moderate to high | Requires correct edges and corners |
| Imported mesh | Poor | Fast to display | Loses parametric editability |

Geometric equivalence is a hard requirement. A candidate that fails validation cannot
win because it is faster or shorter.

For candidates that pass validation, the planner minimizes:

```
C = w1 * complexity + w2 * evaluation + w3 * dependencies + w4 * maintenance
```

- `complexity`: complexity of the generated SCAD construction.
- `evaluation`: estimated OpenSCAD evaluation time.
- `dependencies`: external library requirements.
- `maintenance`: sensitivity to parameter changes and geometric topology.

Default priority order:

1. Native OpenSCAD expressions that represent the geometry naturally.
2. Recognized geometric constructions (`hull`, `minkowski`, `offset`, CSG combinations).
3. Library-assisted solutions when they improve correctness or maintainability.
4. Generated parametric cutters or helper modules.
5. Explicitly unsupported features when no robust construction exists.

Imported meshes are an optional, clearly identified nonparametric export mode. They are
never a silent substitute for successful translation.

## Library registry

External libraries are adapters behind a registry, not hard-coded dependencies.

```
Library registry
    +-- OpenSCAD core
    +-- BOSL2 (rounded cuboids, chamfers, edge treatments, anchors)
    +-- SCADBridge geometry library (specialized cutters, reusable constructions)
```

Each adapter declares supported operations, parameter constraints, expected geometric
behavior, required library version, and licensing terms. Generated code and required
libraries must remain compatible with the project distribution model. SolidCraft's
contribution policy excludes certain licensed code, which reinforces keeping the SCAD
compiler external.

## Parametric-domain validation

Matching one model is insufficient. A `minkowski()` construction can expand external
dimensions; a `hull()` can fill concavities. Every translation rule must specify:

| Property | Example |
|---|---|
| Applicable geometry | Rectangular prism with uniform external edge rounds |
| Required assumptions | Equal radius, supported edge configuration |
| Parameter restrictions | Positive dimensions, radius below geometric limits |
| Generated construction | 2D `offset()` then `linear_extrude()` |
| Validation | Geometry comparison across parameter combinations |
| Failure behavior | Reject if topology or equivalence changes |

Rules are verified geometric rewrite rules, not ad hoc code-generation templates.

## Compilation modes

- `faithful` (default): preserve the SolidCraft feature sequence and parameter
  dependencies wherever the supported OpenSCAD vocabulary allows it. Use this mode for
  debugging and for comparing the timeline with generated SCAD.
- `optimized`: apply verified geometric rewrite rules to produce more compact, efficient
  or readable constructions. Enable only after the rules pass validation.

Generating mathematically equivalent geometry is not the same as recovering the original
design intent. A compact hull-based construction is not evidence that the designer
intended a hull.

## Development phases

| Phase | Objective |
|---|---|
| 0 | SolidCraft browser command access to feature history, parameters and topology |
| 1 | Geometry IR for primitives, CSG, transforms, profiles and dependencies |
| 2 | OpenSCAD core compiler with faithful CSG, extrusions and modules |
| 3 | Construction planner for `hull`, `minkowski`, `offset` and equivalent CSG |
| 4 | Library adapters, starting with BOSL2 |
| 5 | Advanced features: chamfers, fillets, shells, holes, patterns |
| 6 | Comprehensive geometric verification and parameter-domain regression |
| 7 | Blender adapter for presentation geometry and renderings |
| 8 | Optimization benchmarks for source complexity and evaluation time |

Basic validation is built alongside phase 2. Phase 6 is the full regression system, not
the first validation.

## Components

| Component | Responsibility |
|---|---|
| SolidCraft browser adapter | Retrieve parametric construction information through `window.solidcraft` |
| Geometry IR | Normalize construction semantics |
| Geometric recognition engine | Identify primitives, profiles and equivalent structures |
| Construction planner | Select OpenSCAD operators and libraries |
| SCAD compiler | Generate declarative, maintainable source |
| Geometric validator | Prove equivalence within tolerances and parameter domains |
| Blender adapter | Produce presentation geometry and renderings independently |

## Runtime decision (2026-10-18)

The first implementation targets the SolidCraft web application only. SCADBridge runs as a
browser module inside the app tab and uses `window.solidcraft` for commands and inspection.
The local web build loads the overlay with a script tag and has a small shell hook that routes
`.scad` files from File > Open to the bridge. The native desktop app, the `solidcraft-cli`, and
MCP are deferred until the browser compiler and validator are stable.

Validation runs in the browser with OpenSCAD WebAssembly loaded at runtime. Blender remains a
future milestone and is not part of the v0.1 critical path.

A first reverse-import path is implemented for a SCAD subset: SolidCraft's `File > Open`
rebuilds primitives, transforms, booleans, hulls, loops and tapered cylinders as a
parametric SolidCraft timeline. Chamfered box edges compile back to SCAD, and Update
SCAD updates the opened file through a retained File System Access handle. `Export SCAD…`
is in SolidCraft's File menu.
