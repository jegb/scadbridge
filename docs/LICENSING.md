# Licensing

SCADBridge is released under the BSD 2-Clause License. See [LICENSE](../LICENSE).

## Why BSD-2-Clause

The OpenSCAD ecosystem mixes licenses. OpenSCAD itself is GPL-2.0-or-later, BOSL2
is BSD-2-Clause, dotSCAD is MIT, and MCAD is LGPL-2.1. A permissive, GPL-compatible
license lets SCADBridge be used by anyone in that ecosystem without forcing a
license on the OpenSCAD files it generates.

BSD-2-Clause is compatible with GPL-2.0-or-later and GPL-3.0 in the direction that
matters here: GPL projects may include BSD-2-Clause code. SCADBridge does not
incorporate GPL code.

## OpenSCAD WebAssembly

Validation runs OpenSCAD WebAssembly in the browser. It is GPL-2.0 licensed and is
loaded at runtime from a CDN URL (`https://unpkg.com/openscad-wasm@0.0.4/openscad.js`
by default). It is not vendored, bundled, or modified in this repository. The
SCADBridge bundle remains BSD-2-Clause; users can point the loader at a different
build through `localStorage.scadbridge.openscadWasmUrl`.

Generated `.scad` files belong to the person or project that requested them.
SCADBridge claims no license over its output.

BOSL2 is bundled as a compressed zip for the browser validator. It is BSD-2-Clause
and its LICENSE file is included in the bundle.

## Upstream projects

- SolidCraft is Apache-2.0 OR MIT. SCADBridge runs inside its web app and calls the
  browser command API. No SolidCraft source is copied into this repository.
- OpenSCAD is GPL-2.0-or-later. In this version it is used as a WASM runtime loaded
  from a CDN.
- Blender is GPL-2.0-or-later and is not used by this version.

## Contribution policy

Contributions are accepted under BSD-2-Clause (inbound equal to outbound).
Do not submit GPL, LGPL, or AGPL code, and do not submit code copied from a
product whose license forbids reuse.
