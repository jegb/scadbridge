import { unzipSync } from 'fflate';
import type { BodyMeasurement, DesignInspection } from './types';
import type { Diagnostic } from './ir';

export const DEFAULT_OPENSCAD_WASM_URL =
  'https://unpkg.com/openscad-wasm@0.0.4/openscad.js';

interface OpenScadFs {
  mkdir(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
}

interface OpenScadInstance {
  renderToStl(code: string): Promise<string>;
  getInstance(): { FS: OpenScadFs };
}

interface OpenScadModule {
  createOpenSCAD(options?: {
    noInitialRun?: boolean;
    print?: (text: string) => void;
    printErr?: (text: string) => void;
  }): Promise<OpenScadInstance>;
}

let factoryPromise: Promise<OpenScadModule> | null = null;
let boslEntries: Record<string, Uint8Array> | null = null;

export function openScadWasmUrl(): string {
  return (
    window.localStorage.getItem('scadbridge.openscadWasmUrl') ??
    DEFAULT_OPENSCAD_WASM_URL
  );
}

export function setOpenScadWasmUrl(url: string): void {
  if (url.trim()) {
    window.localStorage.setItem('scadbridge.openscadWasmUrl', url.trim());
  } else {
    window.localStorage.removeItem('scadbridge.openscadWasmUrl');
  }
  factoryPromise = null;
}

async function loadOpenScad(url = openScadWasmUrl()): Promise<OpenScadModule> {
  if (!factoryPromise) {
    factoryPromise = import(/* @vite-ignore */ url) as Promise<OpenScadModule>;
  }
  return factoryPromise;
}

export interface RenderResult {
  stl: string;
  log: string[];
}

function mkdirp(fs: OpenScadFs, path: string): void {
  if (!path || path === '/') return;
  let current = '';
  for (const part of path.split('/').filter(Boolean)) {
    current += `/${part}`;
    try {
      fs.mkdir(current);
    } catch {
      // Already there.
    }
  }
}

async function bosl2Files(): Promise<Record<string, Uint8Array>> {
  if (!boslEntries) {
    const response = await fetch(new URL('./bosl2.zip', import.meta.url));
    if (!response.ok) throw new Error(`BOSL2 bundle: HTTP ${response.status}`);
    boslEntries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  }
  return boslEntries;
}

async function mountBosl2(instance: OpenScadInstance, log: string[]): Promise<void> {
  const files = await bosl2Files();
  const fs = instance.getInstance().FS;
  mkdirp(fs, '/BOSL2');
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith('/')) continue;
    const path = `/BOSL2/${name}`;
    mkdirp(fs, path.slice(0, path.lastIndexOf('/')));
    fs.writeFile(path, data);
  }
  log.push(`BOSL2 mounted: ${Object.keys(files).length} files`);
}

export async function renderScad(code: string): Promise<RenderResult> {
  const module = await loadOpenScad();
  const log: string[] = [];
  const instance = await module.createOpenSCAD({
    noInitialRun: true,
    print: (text) => log.push(text),
    printErr: (text) => log.push(text),
  });
  if (code.includes('BOSL2')) {
    await mountBosl2(instance, log);
  }
  try {
    const stl = await instance.renderToStl(code);
    if (!stl || stl.length === 0) {
      throw new Error('OpenSCAD returned no STL.');
    }
    return { stl, log };
  } catch (error) {
    const details = log.slice(-20).join('\n');
    if (details.includes('Current top level object is empty')) {
      throw new Error(
        'OpenSCAD produced no geometry. The design has no bodies to validate.',
      );
    }
    const reason =
      error instanceof Error
        ? error.message
        : error && typeof error === 'object'
          ? `exit ${(error as { status?: number }).status ?? 'unknown'}`
          : String(error);
    throw new Error(`OpenSCAD render failed: ${reason}\n${details}`);
  }
}

export interface Metrics {
  volume: number;
  area: number;
  bbox: { min: [number, number, number]; max: [number, number, number] };
  centroid: [number, number, number];
  triangles: number;
}

const VERTEX = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;

export function parseAsciiStl(text: string): Metrics {
  const vertices: Array<[number, number, number]> = [];
  VERTEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VERTEX.exec(text)) !== null) {
    vertices.push([
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ]);
  }
  if (vertices.length < 3 || vertices.length % 3 !== 0) {
    throw new Error('The OpenSCAD output is not a readable ASCII STL.');
  }

  let volume = 0;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < vertices.length; i += 3) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const c = vertices[i + 2];
    for (const vertex of [a, b, c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis]);
        max[axis] = Math.max(max[axis], vertex[axis]);
      }
    }
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const acx = c[0] - a[0];
    const acy = c[1] - a[1];
    const acz = c[2] - a[2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    area += Math.hypot(nx, ny, nz) / 2;

    const tetra = a[0] * (b[1] * c[2] - b[2] * c[1])
      + a[1] * (b[2] * c[0] - b[0] * c[2])
      + a[2] * (b[0] * c[1] - b[1] * c[0]);
    volume += tetra / 6;
    cx += ((a[0] + b[0] + c[0]) / 4) * (tetra / 6);
    cy += ((a[1] + b[1] + c[1]) / 4) * (tetra / 6);
    cz += ((a[2] + b[2] + c[2]) / 4) * (tetra / 6);
  }

  const signedVolume = volume;
  const divisor = signedVolume === 0 ? 1 : signedVolume;
  return {
    volume: Math.abs(volume),
    area,
    bbox: { min, max },
    centroid: [
      cx / divisor,
      cy / divisor,
      cz / divisor,
    ],
    triangles: vertices.length / 3,
  };
}

export function referenceMetrics(bodies: BodyMeasurement[]): Metrics {
  let volume = 0;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (const body of bodies) {
    if (body.visible === false) continue;
    const bodyVolume = body.volume_mm3 ?? 0;
    volume += bodyVolume;
    area += body.area_mm2 ?? 0;
    cx += (body.center_of_mass?.[0] ?? 0) * bodyVolume;
    cy += (body.center_of_mass?.[1] ?? 0) * bodyVolume;
    cz += (body.center_of_mass?.[2] ?? 0) * bodyVolume;
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], body.bbox.min[axis]);
      max[axis] = Math.max(max[axis], body.bbox.max[axis]);
    }
  }

  const divisor = volume === 0 ? 1 : volume;
  return {
    volume,
    area,
    bbox: { min, max },
    centroid: [cx / divisor, cy / divisor, cz / divisor],
    triangles: 0,
  };
}

export interface Tolerance {
  volumeRelative: number;
  areaRelative: number;
  bboxAbsolute: number;
  centroidAbsolute: number;
}

export const DEFAULT_TOLERANCE: Tolerance = {
  volumeRelative: 0.005,
  areaRelative: 0.02,
  bboxAbsolute: 0.05,
  centroidAbsolute: 0.1,
};

export interface MetricComparison {
  volumeRelative: number;
  areaRelative: number;
  bboxAbsolute: number;
  centroidAbsolute: number;
  within: boolean;
}

export interface ValidationReport {
  ok: boolean;
  reference: Metrics;
  generated: Metrics;
  comparison: MetricComparison;
  diagnostics: Diagnostic[];
  openscadLog: string[];
}

export function compareMetrics(
  reference: Metrics,
  generated: Metrics,
  tolerance: Tolerance = DEFAULT_TOLERANCE,
): MetricComparison {
  const volumeRelative =
    Math.abs(generated.volume - reference.volume) /
    Math.max(Math.abs(reference.volume), 1);
  const areaRelative =
    Math.abs(generated.area - reference.area) /
    Math.max(Math.abs(reference.area), 1);
  let bboxAbsolute = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    bboxAbsolute = Math.max(
      bboxAbsolute,
      Math.abs(generated.bbox.min[axis] - reference.bbox.min[axis]),
      Math.abs(generated.bbox.max[axis] - reference.bbox.max[axis]),
    );
  }
  const centroidAbsolute = Math.hypot(
    generated.centroid[0] - reference.centroid[0],
    generated.centroid[1] - reference.centroid[1],
    generated.centroid[2] - reference.centroid[2],
  );
  const within =
    volumeRelative <= tolerance.volumeRelative &&
    areaRelative <= tolerance.areaRelative &&
    bboxAbsolute <= tolerance.bboxAbsolute &&
    centroidAbsolute <= tolerance.centroidAbsolute;
  return {
    volumeRelative,
    areaRelative,
    bboxAbsolute,
    centroidAbsolute,
    within,
  };
}

export async function validateScad(
  code: string,
  inspection: DesignInspection,
  diagnostics: Diagnostic[] = [],
  tolerance: Tolerance = DEFAULT_TOLERANCE,
  bodyModules?: Record<string, string>,
): Promise<ValidationReport> {
  const reference = referenceMetrics(inspection.bodies);
  const modules = bodyModules ? Object.values(bodyModules) : [];
  let generated: Metrics;
  let log: string[] = [];
  if (modules.length > 1) {
    const prefix = code.slice(0, code.lastIndexOf('part();'));
    let volume = 0;
    let area = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const min: [number, number, number] = [Infinity, Infinity, Infinity];
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
    for (const module of modules) {
      const rendered = await renderScad(`${prefix}${module}();\n`);
      const metrics = parseAsciiStl(rendered.stl);
      log = [...log, ...rendered.log];
      volume += metrics.volume;
      area += metrics.area;
      cx += metrics.centroid[0] * metrics.volume;
      cy += metrics.centroid[1] * metrics.volume;
      cz += metrics.centroid[2] * metrics.volume;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], metrics.bbox.min[axis]);
        max[axis] = Math.max(max[axis], metrics.bbox.max[axis]);
      }
    }
    const divisor = volume === 0 ? 1 : volume;
    generated = {
      volume,
      area,
      bbox: { min, max },
      centroid: [cx / divisor, cy / divisor, cz / divisor],
      triangles: 0,
    };
  } else {
    const rendered = await renderScad(code);
    log = rendered.log;
    generated = parseAsciiStl(rendered.stl);
  }
  const comparison = compareMetrics(reference, generated, tolerance);
  const all = [...diagnostics];
  if (!comparison.within) {
    all.push({
      code: 'E320',
      severity: 'error',
      message:
        'Parametric equivalence failed. Generated geometry differs beyond the configured tolerance.',
    });
  }
  return {
    ok: all.every((item) => item.severity !== 'error'),
    reference,
    generated,
    comparison,
    diagnostics: all,
    openscadLog: log,
  };
}
