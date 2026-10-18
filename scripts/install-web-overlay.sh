#!/usr/bin/env bash
# Add or remove the SCADBridge overlay from the local SolidCraft web app checkout.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX="${SOLIDCRAFT_WEB_INDEX:-$ROOT/../solidcraft/apps/solidcraft-web/index.html}"
MODE="${1:-install}"

if [[ ! -f "$INDEX" ]]; then
  echo "SolidCraft web index not found: $INDEX" >&2
  echo "Set SOLIDCRAFT_WEB_INDEX to the index.html of apps/solidcraft-web." >&2
  exit 1
fi

python3 - "$INDEX" "$MODE" "$ROOT/browser/dist" <<'PY'
import hashlib
import os
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
mode = sys.argv[2]
dist = Path(sys.argv[3])
text = path.read_text()

relative = os.path.relpath(dist, path.parent)
copy = f'  <link data-trunk rel="copy-dir" href="{relative}" data-target-path="scadbridge" />\n'
bundle = dist / "scadbridge.js"
version = hashlib.sha256(bundle.read_bytes()).hexdigest()[:12] if bundle.is_file() else "dev"
hashed = dist / f"scadbridge-{version}.js"
if bundle.is_file():
    hashed.write_bytes(bundle.read_bytes())
    for old in dist.glob("scadbridge-*.js"):
        if old != hashed:
            old.unlink()
script = f'  <script type="module" src="./scadbridge/scadbridge-{version}.js"></script>\n'
script_re = re.compile(r'\s*<script type="module" src="\./scadbridge/scadbridge(?:-[^"]+)?\.js[^"]*"></script>')
text = script_re.sub("", text)

if mode == "remove":
    text = text.replace(copy, "")
else:
    if copy not in text:
        text = text.replace("</head>", copy + "</head>")
    text = text.replace("</body>", script + "</body>")

path.write_text(text)
print(f"{mode}: {path} (overlay {version})")
PY

