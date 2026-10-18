import type {
  ChamferFeature,
  Diagnostic,
  Expr,
  ExtrudeFeature,
  FeatureIR,
  FilletFeature,
  HoleFeature,
  PartIR,
  ShellFeature,
  Vec3Expr,
} from './ir';

export interface ScadOptions {
  fn?: number;
  overrides?: Record<string, string>;
}

export interface ScadResult {
  code: string;
  diagnostics: Diagnostic[];
  bodies: string[];
  bodyModules: Record<string, string>;
}

const UNIT_SUFFIX = /(\d+(?:\.\d+)?)\s*(mm|cm|in|ft|deg|rad)\b/g;
const UNIT_AFTER_PAREN = /\)\s*(mm|cm|in|ft|deg|rad)\b/g;
const UNIT_LEFT = /\b(mm|cm|ft|deg|rad)\b/g;

export function sanitizeExpression(input: string): string {
  let text = input.replace(/°/g, '');
  text = text.replace(UNIT_SUFFIX, '$1');
  text = text.replace(UNIT_AFTER_PAREN, ')');
  text = text.replace(UNIT_LEFT, '');
  return text.replace(/\s+/g, ' ').trim();
}

function expr(value: Expr | number | undefined, fallback = '0'): string {
  if (value === undefined) return fallback;
  return sanitizeExpression(String(value));
}

function vec(value: Vec3Expr | undefined, fallback: Vec3Expr = ['0', '0', '0']): string {
  const source = value ?? fallback;
  return `[${source.map((part) => expr(part)).join(', ')}]`;
}

function isZero(value: Expr | undefined): boolean {
  if (value === undefined) return true;
  const cleaned = expr(value).replace(/[()\s]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) && number === 0;
}

function zeroVec(value: Vec3Expr | undefined): boolean {
  if (!value) return true;
  return value.every((part) => isZero(part));
}

function indent(text: string, levels: number): string {
  const pad = '  '.repeat(levels);
  return text
    .split('\n')
    .map((line) => (line.length ? pad + line : line))
    .join('\n');
}

function moduleName(body: string, used: Set<string>): string {
  const base =
    body
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'body';
  let name = `body_${base}`;
  let suffix = 2;
  while (used.has(name)) {
    name = `body_${base}_${suffix}`;
    suffix += 1;
  }
  used.add(name);
  return name;
}

function axisRotation(axis: Vec3Expr | undefined): string | null {
  if (!axis) return null;
  const [x, y, z] = axis.map((part) => Number(expr(part)));
  if (![x, y, z].every((value) => Number.isFinite(value))) return null;
  const length = Math.hypot(x, y, z);
  if (length === 0) return null;
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && z > 0) return null;
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9 && z < 0) return 'rotate([180, 0, 0])';
  if (Math.abs(x - 1) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z) < 1e-9) {
    return 'rotate([0, 90, 0])';
  }
  if (Math.abs(x + 1) < 1e-9 && Math.abs(y) < 1e-9 && Math.abs(z) < 1e-9) {
    return 'rotate([0, -90, 0])';
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y - 1) < 1e-9 && Math.abs(z) < 1e-9) {
    return 'rotate([-90, 0, 0])';
  }
  if (Math.abs(x) < 1e-9 && Math.abs(y + 1) < 1e-9 && Math.abs(z) < 1e-9) {
    return 'rotate([90, 0, 0])';
  }
  const ax = x / length;
  const ay = y / length;
  const az = z / length;
  const angle = (Math.acos(az) * 180) / Math.PI;
  return `rotate(a = ${angle.toFixed(6)}, v = [${(-ay).toFixed(6)}, ${ax.toFixed(6)}, 0])`;
}

function wrap(transform: string | null, body: string): string {
  if (!transform) return body;
  return `${transform} {\n${indent(body, 1)}\n}`;
}

function primitiveBody(feature: FeatureIR, fn: number): string | null {
  switch (feature.kind) {
    case 'box': {
      const size = `[${expr(feature.length)}, ${expr(feature.width)}, ${expr(feature.height)}]`;
      let body = `cube(${size}, center = false);`;
      if (feature.center && !feature.corner) {
        body = `cube(${size}, center = true);`;
        return wrap(`translate(${vec(feature.center)})`, body);
      }
      if (feature.corner && !zeroVec(feature.corner)) {
        return wrap(`translate(${vec(feature.corner)})`, body);
      }
      return body;
    }
    case 'cylinder': {
      const radius = feature.radius
        ? expr(feature.radius)
        : `(${expr(feature.diameter)}) / 2`;
      let body = `cylinder(h = ${expr(feature.height)}, r = ${radius}, center = false, $fn = ${fn});`;
      const rotation = axisRotation(feature.axis);
      if (rotation) body = wrap(rotation, body);
      if (feature.base && !zeroVec(feature.base)) {
        body = wrap(`translate(${vec(feature.base)})`, body);
      }
      return body;
    }
    case 'sphere': {
      const radius = feature.radius
        ? expr(feature.radius)
        : `(${expr(feature.diameter)}) / 2`;
      let body = `sphere(r = ${radius}, $fn = ${fn});`;
      if (feature.center && !zeroVec(feature.center)) {
        body = wrap(`translate(${vec(feature.center)})`, body);
      }
      return body;
    }
    default:
      return null;
  }
}

function booleanOp(operation: string): string {
  if (operation === 'join') return 'union';
  if (operation === 'cut') return 'difference';
  return 'intersection';
}

interface BoxInfo {
  x0: string;
  x1: string;
  y0: string;
  y1: string;
  z0: string;
  z1: string;
}

function boxInfo(feature: {
  length: string;
  width: string;
  height: string;
  corner?: [string, string, string];
  center?: [string, string, string];
}): BoxInfo {
  const length = expr(feature.length);
  const width = expr(feature.width);
  const height = expr(feature.height);
  if (feature.center && !feature.corner) {
    const [cx, cy, cz] = feature.center.map((part) => expr(part));
    return {
      x0: `(${cx}) - (${length}) / 2`,
      x1: `(${cx}) + (${length}) / 2`,
      y0: `(${cy}) - (${width}) / 2`,
      y1: `(${cy}) + (${width}) / 2`,
      z0: `(${cz}) - (${height}) / 2`,
      z1: `(${cz}) + (${height}) / 2`,
    };
  }
  const [x0, y0, z0] = (feature.corner ?? ['0', '0', '0']).map((part) => expr(part));
  return {
    x0,
    x1: `(${x0}) + (${length})`,
    y0,
    y1: `(${y0}) + (${width})`,
    z0,
    z1: `(${z0}) + (${height})`,
  };
}

function shiftBox(info: BoxInfo, translate: [string, string, string]): BoxInfo {
  const [tx, ty, tz] = translate.map((part) => expr(part));
  return {
    x0: `(${info.x0}) + (${tx})`,
    x1: `(${info.x1}) + (${tx})`,
    y0: `(${info.y0}) + (${ty})`,
    y1: `(${info.y1}) + (${ty})`,
    z0: `(${info.z0}) + (${tz})`,
    z1: `(${info.z1}) + (${tz})`,
  };
}

function evalArithmetic(input: string, params: Map<string, number>): number | null {
  const text = sanitizeExpression(input);
  let index = 0;
  const skip = () => {
    while (index < text.length && /\s/.test(text[index])) index += 1;
  };
  function parseExpression(): number | null {
    let value = parseProduct();
    while (value !== null) {
      skip();
      const op = text[index];
      if (op !== '+' && op !== '-') break;
      index += 1;
      const right = parseProduct();
      if (right === null) return null;
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }
  function parseProduct(): number | null {
    let value = parseUnary();
    while (value !== null) {
      skip();
      const op = text[index];
      if (op !== '*' && op !== '/' && op !== '%') break;
      index += 1;
      const right = parseUnary();
      if (right === null) return null;
      if ((op === '/' || op === '%') && right === 0) return null;
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  }
  function parseUnary(): number | null {
    skip();
    const op = text[index];
    if (op === '-' || op === '+') {
      index += 1;
      const value = parseUnary();
      if (value === null) return null;
      return op === '-' ? -value : value;
    }
    return parsePrimary();
  }
  function parsePrimary(): number | null {
    skip();
    if (text[index] === '(') {
      index += 1;
      const value = parseExpression();
      skip();
      if (text[index] !== ')') return null;
      index += 1;
      return value;
    }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(index));
    if (number) {
      index += number[0].length;
      return Number(number[0]);
    }
    const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(text.slice(index));
    if (identifier) {
      index += identifier[0].length;
      if (identifier[0] === 'PI') return Math.PI;
      return params.get(identifier[0]) ?? null;
    }
    return null;
  }
  const value = parseExpression();
  skip();
  return index === text.length ? value : null;
}

function boundExpression(info: BoxInfo, axis: number, sign: number): string {
  const pair = axis === 0
    ? [info.x0, info.x1]
    : axis === 1
      ? [info.y0, info.y1]
      : [info.z0, info.z1];
  return sign > 0 ? pair[1] : pair[0];
}

function boxMatchesEdge(info: BoxInfo, edge: unknown, params: Map<string, number>): boolean {
  if (!Array.isArray(edge) || edge.length !== 3 || edge.some((value) => typeof value !== 'number')) {
    return false;
  }
  const mins = [
    evalArithmetic(info.x0, params),
    evalArithmetic(info.y0, params),
    evalArithmetic(info.z0, params),
  ];
  const maxs = [
    evalArithmetic(info.x1, params),
    evalArithmetic(info.y1, params),
    evalArithmetic(info.z1, params),
  ];
  if (mins.some((value) => value === null) || maxs.some((value) => value === null)) {
    return false;
  }
  let atBounds = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const min = mins[axis] as number;
    const max = maxs[axis] as number;
    const value = edge[axis] as number;
    const tolerance = Math.max(Math.abs(max - min) * 1e-6, 1e-6);
    if (value < min - tolerance || value > max + tolerance) return false;
    if (Math.abs(value - min) <= tolerance || Math.abs(value - max) <= tolerance) {
      atBounds += 1;
    }
  }
  return atBounds >= 2;
}

function chamferCutter(
  info: BoxInfo,
  edge: unknown,
  distance: string,
  params: Map<string, number>,
  diagnostics: Diagnostic[],
  feature: ChamferFeature,
): string | null {
  if (!Array.isArray(edge) || edge.length !== 3 || edge.some((value) => typeof value !== 'number')) {
    diagnostics.push({
      code: 'E121',
      severity: 'error',
      message: 'Chamfer edges must be three-component midpoints.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return null;
  }
  const values = edge as [number, number, number];
  const mins = [
    evalArithmetic(info.x0, params),
    evalArithmetic(info.y0, params),
    evalArithmetic(info.z0, params),
  ];
  const maxs = [
    evalArithmetic(info.x1, params),
    evalArithmetic(info.y1, params),
    evalArithmetic(info.z1, params),
  ];
  if (mins.some((value) => value === null) || maxs.some((value) => value === null)) {
    diagnostics.push({
      code: 'E121',
      severity: 'error',
      message: 'Chamfer emission needs numeric box bounds and parameters.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return null;
  }
  let boundaries: Array<{ axis: number; sign: number }> = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const min = mins[axis] as number;
    const max = maxs[axis] as number;
    const tolerance = Math.max(Math.abs(max - min) * 1e-9, 1e-6);
    if (Math.abs(values[axis] - min) <= tolerance) boundaries.push({ axis, sign: -1 });
    else if (Math.abs(values[axis] - max) <= tolerance) boundaries.push({ axis, sign: 1 });
  }
  if (boundaries.length !== 2) {
    // A stored edge midpoint can sit off the surface after an upstream dimension change.
    // SolidCraft resolves it by history; mirror that by keeping the two axes farthest from
    // the center and taking the side each coordinate is on.
    const scored = [0, 1, 2]
      .map((axis) => {
        const center = ((mins[axis] as number) + (maxs[axis] as number)) / 2;
        const half = Math.max(((maxs[axis] as number) - (mins[axis] as number)) / 2, 1e-9);
        return {
          axis,
          score: Math.abs(values[axis] - center) / half,
          sign: values[axis] >= center ? 1 : -1,
        };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0].score < 0.5 || scored[1].score < 0.5) {
      diagnostics.push({
        code: 'E121',
        severity: 'error',
        message: 'Chamfer emission supports straight edges between two planar box faces.',
        featureId: feature.id,
        featureName: feature.name,
      });
      return null;
    }
    boundaries = [
      { axis: scored[0].axis, sign: scored[0].sign },
      { axis: scored[1].axis, sign: scored[1].sign },
    ];
  }
  const edgeAxis = [0, 1, 2].find((axis) => !boundaries.some((entry) => entry.axis === axis));
  if (edgeAxis === undefined) return null;
  const [u, v] = boundaries;
  const edgeMin = boundExpression(info, edgeAxis, -1);
  const edgeMax = boundExpression(info, edgeAxis, 1);
  const uValue = boundExpression(info, u.axis, u.sign);
  const vValue = boundExpression(info, v.axis, v.sign);
  const uInward = u.sign > 0 ? `-(${distance})` : `(${distance})`;
  const vInward = v.sign > 0 ? `-(${distance})` : `(${distance})`;
  const uInner = `(${uValue}) + (${uInward})`;
  const vInner = `(${vValue}) + (${vInward})`;
  // Keep the chamfer plane exactly between the two inward points, but put the third
  // point and the ends just outside the box. Coplanar cutter faces make OpenSCAD's
  // preview z-fight along the chamfer.
  const epsilon = '0.001';
  const uOuter = u.sign > 0 ? `(${uValue}) + (${epsilon})` : `(${uValue}) - (${epsilon})`;
  const vOuter = v.sign > 0 ? `(${vValue}) + (${epsilon})` : `(${vValue}) - (${epsilon})`;
  const edgeMinExt = `(${edgeMin}) - (${epsilon})`;
  const edgeMaxExt = `(${edgeMax}) + (${epsilon})`;
  const axisUnit = (axis: number): [string, string, string] =>
    axis === 0 ? ['1', '0', '0'] : axis === 1 ? ['0', '1', '0'] : ['0', '0', '1'];
  const uDir = axisUnit(u.axis);
  const vDir = axisUnit(v.axis);
  const edgeDir = axisUnit(edgeAxis);
  const determinant =
    (Number(uDir[1]) * Number(vDir[2]) - Number(uDir[2]) * Number(vDir[1])) * Number(edgeDir[0]) +
    (Number(uDir[2]) * Number(vDir[0]) - Number(uDir[0]) * Number(vDir[2])) * Number(edgeDir[1]) +
    (Number(uDir[0]) * Number(vDir[1]) - Number(uDir[1]) * Number(vDir[0])) * Number(edgeDir[2]);
  const area = (() => {
    const bu = evalArithmetic(uInner, params);
    const bv = evalArithmetic(vValue, params);
    const cu = evalArithmetic(uValue, params);
    const cv = evalArithmetic(vInner, params);
    const eu = evalArithmetic(uOuter, params);
    const ev = evalArithmetic(vOuter, params);
    if (bu === null || bv === null || cu === null || cv === null || eu === null || ev === null) {
      return 1;
    }
    return (cu - bu) * (ev - bv) - (cv - bv) * (eu - bu);
  })();
  const triangle: Array<[string, string]> = [
    [uInner, vValue],
    [uValue, vInner],
    [uOuter, vOuter],
  ];
  if ((area > 0) !== (determinant > 0)) triangle.reverse();
  const tx = edgeDir[0] === '1' ? edgeMinExt : '0';
  const ty = edgeDir[1] === '1' ? edgeMinExt : '0';
  const tz = edgeDir[2] === '1' ? edgeMinExt : '0';
  const matrix = `[[${uDir[0]}, ${vDir[0]}, ${edgeDir[0]}, ${tx}], [${uDir[1]}, ${vDir[1]}, ${edgeDir[1]}, ${ty}], [${uDir[2]}, ${vDir[2]}, ${edgeDir[2]}, ${tz}], [0, 0, 0, 1]]`;
  const polygon = `polygon(points = [${triangle.map(([uu, vv]) => `[${uu}, ${vv}]`).join(', ')}]);`;
  const length = `(${edgeMaxExt}) - (${edgeMinExt})`;
  return `multmatrix(${matrix}) linear_extrude(height = ${length}) ${polygon}`;
}

interface NumericBounds {
  min: [number, number, number];
  max: [number, number, number];
}

function numericBounds(info: BoxInfo, params: Map<string, number>): NumericBounds | null {
  const mins = [
    evalArithmetic(info.x0, params),
    evalArithmetic(info.y0, params),
    evalArithmetic(info.z0, params),
  ];
  const maxs = [
    evalArithmetic(info.x1, params),
    evalArithmetic(info.y1, params),
    evalArithmetic(info.z1, params),
  ];
  if (mins.some((value) => value === null) || maxs.some((value) => value === null)) {
    return null;
  }
  return { min: mins as [number, number, number], max: maxs as [number, number, number] };
}

function pointFaces(
  info: BoxInfo,
  point: unknown,
  params: Map<string, number>,
): Array<{ axis: number; sign: number }> | null {
  if (!Array.isArray(point) || point.length !== 3) return null;
  const values = point.map((value) =>
    typeof value === 'number' ? value : evalArithmetic(String(value), params),
  );
  if (values.some((value) => value === null)) return null;
  const bounds = numericBounds(info, params);
  if (!bounds) return null;
  const faces: Array<{ axis: number; sign: number }> = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const min = bounds.min[axis];
    const max = bounds.max[axis];
    const value = values[axis] as number;
    const tolerance = Math.max(Math.abs(max - min) * 1e-6, 1e-6);
    if (Math.abs(value - min) <= tolerance) faces.push({ axis, sign: -1 });
    else if (Math.abs(value - max) <= tolerance) faces.push({ axis, sign: 1 });
  }
  return faces;
}

function boxHasPoint(
  info: BoxInfo,
  point: unknown,
  params: Map<string, number>,
): boolean {
  const faces = pointFaces(info, point, params);
  if (!faces || faces.length === 0) return false;
  if (!Array.isArray(point)) return false;
  const bounds = numericBounds(info, params);
  if (!bounds) return false;
  const values = point.map((value) =>
    typeof value === 'number' ? value : evalArithmetic(String(value), params),
  );
  if (values.some((value) => value === null)) return false;
  for (let axis = 0; axis < 3; axis += 1) {
    const tolerance = Math.max(Math.abs(bounds.max[axis] - bounds.min[axis]) * 1e-6, 1e-6);
    const value = values[axis] as number;
    if (value < bounds.min[axis] - tolerance || value > bounds.max[axis] + tolerance) return false;
  }
  return true;
}

function inferBodyFromPoint(
  infos: Map<string, BoxInfo>,
  bodies: Map<string, string>,
  point: unknown,
  params: Map<string, number>,
): string | null {
  const matches = Array.from(infos.entries())
    .filter(([, info]) => boxHasPoint(info, point, params))
    .map(([name]) => name);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return null;
  if (bodies.size === 1) return Array.from(bodies.keys())[0];
  return null;
}

function inwardNormalAt(
  info: BoxInfo,
  point: unknown,
  params: Map<string, number>,
): Vec3Expr | null {
  const faces = pointFaces(info, point, params);
  if (!faces || faces.length !== 1) return null;
  const direction: Vec3Expr = ['0', '0', '0'];
  direction[faces[0].axis] = String(-faces[0].sign);
  return direction;
}

function holeCutters(
  feature: HoleFeature,
  info: BoxInfo,
  params: Map<string, number>,
  fn: number,
  diagnostics: Diagnostic[],
): string[] {
  const diameter = feature.diameter;
  if (!diameter) {
    diagnostics.push({
      code: 'E124',
      severity: 'error',
      message: 'Hole emission needs a resolved diameter or thread size.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return [];
  }
  const diameterText = expr(diameter);
  if ((feature.raw.thread || feature.raw.clearance) && evalArithmetic(diameterText, params) === null) {
    diagnostics.push({
      code: 'E124',
      severity: 'error',
      message: 'Thread and clearance holes need a resolved numeric diameter.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return [];
  }
  const direction = feature.direction ?? inwardNormalAt(info, feature.position, params);
  if (!direction) {
    diagnostics.push({
      code: 'E124',
      severity: 'error',
      message: 'The hole position must lie on exactly one planar box face.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return [];
  }
  if (feature.holeType === 'drilled') {
    diagnostics.push({
      code: 'E124',
      severity: 'error',
      message: 'Drilled hole tips are not emitted yet.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return [];
  }
  const epsilon = '0.001';
  const position = feature.position.map((part) => expr(part));
  const dir = direction.map((part) => expr(part));
  const start = position.map(
    (part, axis) => `(${part}) - (${dir[axis]}) * (${epsilon})`,
  );
  const rotation = axisRotation(dir as Vec3Expr);
  const rotate = rotation ? `${rotation} ` : '';
  const radius = `(${diameterText}) / 2`;
  const bounds = numericBounds(info, params);
  const throughLength = bounds
    ? String(
        Math.hypot(
          bounds.max[0] - bounds.min[0],
          bounds.max[1] - bounds.min[1],
          bounds.max[2] - bounds.min[2],
        ) *
          2 +
          10,
      )
    : '1000';
  const length = feature.depth
    ? `(${expr(feature.depth)}) + (2 * ${epsilon})`
    : throughLength;
  const cutters: string[] = [
    `translate([${start.join(', ')}]) ${rotate}cylinder(h = ${length}, r = ${radius}, center = false, $fn = ${fn});`,
  ];

  if (feature.holeType === 'counterbore') {
    if (!feature.counterboreDiameter || !feature.counterboreDepth) {
      diagnostics.push({
        code: 'E124',
        severity: 'error',
        message: 'Counterbore needs both its diameter and depth.',
        featureId: feature.id,
        featureName: feature.name,
      });
      return [];
    }
    const cbDiameter = `(${expr(feature.counterboreDiameter)}) / 2`;
    const cbLength = `(${expr(feature.counterboreDepth)}) + (${epsilon})`;
    cutters.push(
      `translate([${start.join(', ')}]) ${rotate}cylinder(h = ${cbLength}, r = ${cbDiameter}, center = false, $fn = ${fn});`,
    );
  } else if (feature.holeType === 'countersink') {
    if (!feature.countersinkDiameter || !feature.countersinkAngle) {
      diagnostics.push({
        code: 'E124',
        severity: 'error',
        message: 'Countersink needs its diameter and angle.',
        featureId: feature.id,
        featureName: feature.name,
      });
      return [];
    }
    const csDiameter = `(${expr(feature.countersinkDiameter)}) / 2`;
    const mainRadius = `(${expr(diameter)}) / 2`;
    const depth = `((${csDiameter}) - (${mainRadius})) / tan((${expr(feature.countersinkAngle)}) / 2)`;
    cutters.push(
      `translate([${start.join(', ')}]) ${rotate}cylinder(h = ${depth}, r1 = ${csDiameter}, r2 = ${mainRadius}, center = false, $fn = ${fn});`,
    );
  } else if (feature.holeType !== 'simple' && feature.holeType !== '') {
    diagnostics.push({
      code: 'E124',
      severity: 'error',
      message: `Hole type "${feature.holeType}" is not emitted yet.`,
      featureId: feature.id,
      featureName: feature.name,
    });
    return [];
  }

  return cutters;
}

function edgeBoundaries(
  info: BoxInfo,
  edge: unknown,
  params: Map<string, number>,
): { edgeAxis: number; u: { axis: number; sign: number }; v: { axis: number; sign: number } } | null {
  if (!Array.isArray(edge) || edge.length !== 3 || edge.some((value) => typeof value !== 'number')) {
    return null;
  }
  const bounds = numericBounds(info, params);
  if (!bounds) return null;
  let boundaries: Array<{ axis: number; sign: number }> = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const min = bounds.min[axis];
    const max = bounds.max[axis];
    const value = edge[axis] as number;
    const tolerance = Math.max(Math.abs(max - min) * 1e-6, 1e-6);
    if (Math.abs(value - min) <= tolerance) boundaries.push({ axis, sign: -1 });
    else if (Math.abs(value - max) <= tolerance) boundaries.push({ axis, sign: 1 });
  }
  if (boundaries.length !== 2) {
    const scored = [0, 1, 2]
      .map((axis) => {
        const center = (bounds.min[axis] + bounds.max[axis]) / 2;
        const half = Math.max((bounds.max[axis] - bounds.min[axis]) / 2, 1e-9);
        return {
          axis,
          score: Math.abs((edge[axis] as number) - center) / half,
          sign: (edge[axis] as number) >= center ? 1 : -1,
        };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0].score < 0.5 || scored[1].score < 0.5) return null;
    boundaries = [
      { axis: scored[0].axis, sign: scored[0].sign },
      { axis: scored[1].axis, sign: scored[1].sign },
    ];
  }
  const edgeAxis = [0, 1, 2].find((axis) => !boundaries.some((entry) => entry.axis === axis));
  if (edgeAxis === undefined) return null;
  return { edgeAxis, u: boundaries[0], v: boundaries[1] };
}

function filletCutters(
  feature: FilletFeature,
  info: BoxInfo,
  params: Map<string, number>,
  fn: number,
  diagnostics: Diagnostic[],
): string[] {
  if (feature.filletType && feature.filletType !== 'constant') {
    diagnostics.push({
      code: 'E125',
      severity: 'error',
      message: `Fillet type "${feature.filletType}" is not emitted yet. Only constant radius is supported.`,
      featureId: feature.id,
      featureName: feature.name,
    });
    return [];
  }
  const cutters: string[] = [];
  const radius = `(${expr(feature.radius)})`;
  const epsilon = '0.001';
  for (const edge of feature.edges) {
    const faces = edgeBoundaries(info, edge, params);
    if (!faces) {
      diagnostics.push({
        code: 'E125',
        severity: 'error',
        message: 'Fillet emission supports straight edges between two planar box faces.',
        featureId: feature.id,
        featureName: feature.name,
      });
      continue;
    }
    const { edgeAxis, u, v } = faces;
    const uFace = boundExpression(info, u.axis, u.sign);
    const vFace = boundExpression(info, v.axis, v.sign);
    const uInner = u.sign > 0 ? `(${uFace}) - (${radius})` : `(${uFace}) + (${radius})`;
    const vInner = v.sign > 0 ? `(${vFace}) - (${radius})` : `(${vFace}) + (${radius})`;
    const uLo = u.sign > 0 ? uInner : `(${uFace}) - (${epsilon})`;
    const uHi = u.sign > 0 ? `(${uFace}) + (${epsilon})` : uInner;
    const vLo = v.sign > 0 ? vInner : `(${vFace}) - (${epsilon})`;
    const vHi = v.sign > 0 ? `(${vFace}) + (${epsilon})` : vInner;
    const edgeMin = boundExpression(info, edgeAxis, -1);
    const edgeMax = boundExpression(info, edgeAxis, 1);
    const edgeMinExt = `(${edgeMin}) - (${epsilon})`;
    const edgeMaxExt = `(${edgeMax}) + (${epsilon})`;
    const edgeLength = `(${edgeMaxExt}) - (${edgeMinExt})`;
    const cubeMin = ['0', '0', '0'];
    const cubeDim = ['0', '0', '0'];
    cubeMin[edgeAxis] = edgeMinExt;
    cubeMin[u.axis] = uLo;
    cubeMin[v.axis] = vLo;
    cubeDim[edgeAxis] = edgeLength;
    cubeDim[u.axis] = `(${uHi}) - (${uLo})`;
    cubeDim[v.axis] = `(${vHi}) - (${vLo})`;
    const square = `translate([${cubeMin.join(', ')}]) cube([${cubeDim.join(', ')}]);`;
    const cylinderBase = ['0', '0', '0'];
    cylinderBase[edgeAxis] = edgeMinExt;
    cylinderBase[u.axis] = uInner;
    cylinderBase[v.axis] = vInner;
    const rotation =
      edgeAxis === 0 ? 'rotate([0, 90, 0])' : edgeAxis === 1 ? 'rotate([-90, 0, 0])' : '';
    const cylinder = `translate([${cylinderBase.join(', ')}]) ${rotation ? `${rotation} ` : ''}cylinder(h = ${edgeLength}, r = ${radius}, center = false, $fn = ${fn});`;
    cutters.push(`difference() {
${indent(square, 1)}
${indent(cylinder, 1)}
}`);
  }
  return cutters;
}

function shellInnerBox(
  feature: ShellFeature,
  info: BoxInfo,
  params: Map<string, number>,
  diagnostics: Diagnostic[],
): string | null {
  if (feature.direction && feature.direction !== 'inside') {
    diagnostics.push({
      code: 'E126',
      severity: 'error',
      message: `Shell direction "${feature.direction}" is not emitted yet. Only inside is supported.`,
      featureId: feature.id,
      featureName: feature.name,
    });
    return null;
  }
  if (feature.raw.tangent_chain === true) {
    diagnostics.push({
      code: 'E126',
      severity: 'error',
      message: 'Shell tangent chains are not emitted yet.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return null;
  }
  const open = new Map<string, boolean>();
  for (const face of feature.faces) {
    const faces = pointFaces(info, face, params);
    if (!faces || faces.length !== 1) {
      diagnostics.push({
        code: 'E126',
        severity: 'error',
        message: 'Each shell face must be a point on exactly one box face.',
        featureId: feature.id,
        featureName: feature.name,
      });
      return null;
    }
    open.set(`${faces[0].axis}:${faces[0].sign}`, true);
  }
  if (open.size === 0) {
    diagnostics.push({
      code: 'E126',
      severity: 'error',
      message: 'Shell needs at least one open face.',
      featureId: feature.id,
      featureName: feature.name,
    });
    return null;
  }
  const thickness = `(${expr(feature.thickness)})`;
  const epsilon = '0.001';
  const base = [
    [info.x0, info.x1],
    [info.y0, info.y1],
    [info.z0, info.z1],
  ];
  const lo: string[] = [];
  const hi: string[] = [];
  const dim: string[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    let low = `(${base[axis][0]}) + (${thickness})`;
    let high = `(${base[axis][1]}) - (${thickness})`;
    if (open.has(`${axis}:-1`)) low = `(${base[axis][0]}) - (${epsilon})`;
    if (open.has(`${axis}:1`)) high = `(${base[axis][1]}) + (${epsilon})`;
    lo.push(low);
    hi.push(high);
    dim.push(`(${high}) - (${low})`);
  }
  const bounds = numericBounds(info, params);
  const t = evalArithmetic(thickness, params);
  if (bounds && t !== null) {
    for (let axis = 0; axis < 3; axis += 1) {
      const openMin = open.has(`${axis}:-1`);
      const openMax = open.has(`${axis}:1`);
      const size = bounds.max[axis] - bounds.min[axis];
      const inner = size - (openMin ? 0 : t) - (openMax ? 0 : t);
      if (inner <= 0) {
        diagnostics.push({
          code: 'E126',
          severity: 'error',
          message: 'Shell thickness is too large for the body.',
          featureId: feature.id,
          featureName: feature.name,
        });
        return null;
      }
    }
  }
  return `translate([${lo.join(', ')}]) cube([${dim.join(', ')}]);`;
}

function extrudeBoxInfo(
  feature: ExtrudeFeature,
  params: Map<string, number>,
): BoxInfo | null {
  if (feature.profile.kind !== 'polygon' || feature.profile.points.length !== 4) return null;
  const xDir = feature.plane.xDir.map((value) => Number(expr(value)));
  const yDir = feature.plane.yDir.map((value) => Number(expr(value)));
  const origin = feature.plane.origin.map((value) => Number(expr(value)));
  if (![...xDir, ...yDir, ...origin].every(Number.isFinite)) return null;
  const isAxis = (vector: number[]) =>
    vector.filter((value) => Math.abs(value) > 1e-9).length === 1 &&
    Math.abs(Math.max(...vector.map((value) => Math.abs(value))) - 1) < 1e-9;
  if (!isAxis(xDir) || !isAxis(yDir)) return null;
  const normal = [
    xDir[1] * yDir[2] - xDir[2] * yDir[1],
    xDir[2] * yDir[0] - xDir[0] * yDir[2],
    xDir[0] * yDir[1] - xDir[1] * yDir[0],
  ];
  const world = feature.profile.points.map(([u, v]) =>
    [0, 1, 2].map((axis) => origin[axis] + xDir[axis] * u + yDir[axis] * v),
  );
  const min = [0, 1, 2].map((axis) => Math.min(...world.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...world.map((point) => point[axis])));
  for (const point of world) {
    for (let axis = 0; axis < 3; axis += 1) {
      const tolerance = Math.max(Math.abs(max[axis] - min[axis]) * 1e-9, 1e-9);
      if (
        Math.abs(point[axis] - min[axis]) > tolerance &&
        Math.abs(point[axis] - max[axis]) > tolerance
      ) {
        return null;
      }
    }
  }
  const distance = evalArithmetic(feature.distance, params);
  if (distance === null) return null;
  const symmetric = feature.direction === 'symmetric';
  const sign = feature.direction === 'negative' ? -1 : 1;
  const low = [...min];
  const high = [...max];
  for (let axis = 0; axis < 3; axis += 1) {
    if (symmetric) {
      low[axis] -= Math.abs(normal[axis]) * distance / 2;
      high[axis] += Math.abs(normal[axis]) * distance / 2;
    } else if (normal[axis] * sign > 0) {
      high[axis] += Math.abs(normal[axis]) * distance;
    } else if (normal[axis] !== 0) {
      low[axis] -= Math.abs(normal[axis]) * distance;
    }
  }
  return {
    x0: String(low[0]),
    x1: String(high[0]),
    y0: String(low[1]),
    y1: String(high[1]),
    z0: String(low[2]),
    z1: String(high[2]),
  };
}

function extrudeNode(
  feature: ExtrudeFeature,
  fn: number,
  sketchNames: Map<number, string>,
): string | null {
  const origin = feature.plane.origin.map((value) => expr(value));
  const xDir = feature.plane.xDir.map((value) => Number(expr(value)));
  const yDir = feature.plane.yDir.map((value) => Number(expr(value)));
  const normal = [
    xDir[1] * yDir[2] - xDir[2] * yDir[1],
    xDir[2] * yDir[0] - xDir[0] * yDir[2],
    xDir[0] * yDir[1] - xDir[1] * yDir[0],
  ];
  const distance = expr(feature.distance);
  const direction = feature.direction || 'positive';
  const centered = direction === 'symmetric';
  const sketchModule = sketchNames.get(feature.sketchId);
  const profile = sketchModule
    ? `${sketchModule}();`
    : feature.profile.kind === 'circle'
      ? `circle(r = ${feature.profile.radius}, $fn = ${fn});`
      : `polygon(points = [${feature.profile.points
          .map(([x, y]) => `[${x}, ${y}]`)
          .join(', ')}]);`;
  const matrix = `[[${xDir[0]}, ${yDir[0]}, ${normal[0]}, ${origin[0]}], [${xDir[1]}, ${yDir[1]}, ${normal[1]}, ${origin[1]}], [${xDir[2]}, ${yDir[2]}, ${normal[2]}, ${origin[2]}], [0, 0, 0, 1]]`;
  const extrude = `multmatrix(${matrix}) linear_extrude(height = ${distance}, center = ${centered}) ${profile}`;
  if (direction === 'negative') {
    const shift = normal.map((value) => `${-value} * (${distance})`);
    return `translate([${shift.join(', ')}]) ${extrude}`;
  }
  return extrude;
}

export function emitScad(part: PartIR, options: ScadOptions = {}): ScadResult {
  const fn = options.fn ?? 128;
  const overrides = options.overrides ?? {};
  const diagnostics: Diagnostic[] = [...part.diagnostics];
  const bodies = new Map<string, string>();
  const infos = new Map<string, BoxInfo>();
  const boxLike = new Set<string>();
  let usesBosl2 = false;
  const order: string[] = [];
  const comments = new Map<string, string[]>();
  const bodyCreators = part.features
    .filter((feature) => 'bodies' in feature && Array.isArray(feature.bodies) && feature.bodies.length > 0)
    .map((feature) => `${feature.name} (${feature.type}) -> ${(feature as { bodies: string[] }).bodies.join(', ')}`);
  const missing = (feature: FeatureIR, body: string) =>
    missingBody(feature, body, Array.from(bodies.keys()), bodyCreators);
  const sketchNames = new Map<number, string>();
  const sketchBlocks: string[] = [];
  for (const feature of part.features) {
    if (feature.kind !== 'sketch' || !feature.profile) continue;
    const name = `sketch_${feature.sketchId}`;
    sketchNames.set(feature.sketchId, name);
    const body =
      feature.profile.kind === 'circle'
        ? `circle(r = ${feature.profile.radius}, $fn = ${fn});`
        : `polygon(points = [${feature.profile.points
            .map(([x, y]) => `[${x}, ${y}]`)
            .join(', ')}]);`;
    sketchBlocks.push(
      `// ${feature.name} (sketch ${feature.sketchId})\nmodule ${name}() {\n${indent(body, 1)}\n}`,
    );
  }
  const numericParams = new Map<string, number>();
  for (const param of part.parameters) {
    if (param.value !== undefined) numericParams.set(param.name, param.value);
  }
  for (const [name, value] of Object.entries(overrides)) {
    const number = evalArithmetic(value, numericParams);
    if (number !== null) numericParams.set(name, number);
  }

  const setBody = (name: string, code: string, comment: string) => {
    if (!bodies.has(name)) order.push(name);
    bodies.set(name, code);
    const list = comments.get(name) ?? [];
    list.push(comment);
    comments.set(name, list);
  };

  for (const feature of part.features) {
    const comment = `// ${feature.name} (${feature.type}, id ${feature.id})`;

    if (feature.kind === 'unsupported' || feature.kind === 'sketch') {
      continue;
    }

    if (feature.kind === 'chamfer') {
      const rawBody = feature.raw.body;
      let targets =
        feature.bodies.length > 0
          ? feature.bodies
          : typeof rawBody === 'string'
            ? [rawBody]
            : [];
      if (targets.length === 0) {
        const edge = feature.edges[0];
        const matches = Array.from(infos.entries())
          .filter(([, info]) => boxMatchesEdge(info, edge, numericParams))
          .map(([name]) => name);
        if (matches.length === 1) {
          targets = matches;
        } else if (matches.length > 1) {
          diagnostics.push({
            code: 'E122',
            severity: 'error',
            message: 'The chamfer edge matches more than one body.',
            featureId: feature.id,
            featureName: feature.name,
          });
        } else if (bodies.size === 1) {
          targets = Array.from(bodies.keys());
        }
      }
      let applied = false;
      for (const name of targets) {
        const info = infos.get(name);
        const body = bodies.get(name);
        if (!info || !body) continue;
        const cutters: string[] = [];
        for (const edge of feature.edges) {
          const cutter = chamferCutter(
            info,
            edge,
            expr(feature.distance),
            numericParams,
            diagnostics,
            feature,
          );
          if (cutter) cutters.push(cutter);
        }
        if (cutters.length === 0) continue;
        const children = [body, ...cutters].map((node) => indent(node, 1)).join('\n');
        setBody(name, `difference() {\n${children}\n}`, comment);
        applied = true;
      }
      if (!applied) diagnostics.push(chamferDiagnostic(feature));
      continue;
    }

    if (
      feature.kind === 'box' ||
      feature.kind === 'cylinder' ||
      feature.kind === 'sphere'
    ) {
      const body = primitiveBody(feature, fn);
      if (!body) continue;
      if (feature.operation === 'new_body' || !feature.operation) {
        for (const name of feature.bodies) {
          setBody(name, body, comment);
          if (feature.kind === 'box' && feature.bodies.length === 1) {
            infos.set(name, boxInfo(feature));
            boxLike.add(name);
          }
        }
        continue;
      }
      if (!['join', 'cut', 'intersect'].includes(feature.operation)) {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: `Primitive operation "${feature.operation}" is not supported.`,
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const targets = feature.targets ?? [];
      if (targets.length === 0) {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: 'Primitive boolean operation has no target body.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const op = booleanOp(feature.operation);
      for (const targetName of targets) {
        const target = bodies.get(targetName);
        if (!target) {
          diagnostics.push(missing(feature, targetName));
          continue;
        }
        const children = [target, body].map((node) => indent(node, 1)).join('\n');
        setBody(targetName, `${op}() {\n${children}\n}`, comment);
        if (feature.operation !== 'cut') infos.delete(targetName);
      }
      continue;
    }

    if (feature.kind === 'hole') {
      const target =
        feature.bodies[0] ??
        inferBodyFromPoint(infos, bodies, feature.position, numericParams);
      if (!target) {
        diagnostics.push({
          code: 'E124',
          severity: 'error',
          message: 'The hole does not match one box body unambiguously.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const info = infos.get(target);
      const body = bodies.get(target);
      if (!info || !body) {
        diagnostics.push({
          code: 'E124',
          severity: 'error',
          message: 'Hole emission supports axis-aligned box bodies only.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const cutters = holeCutters(feature, info, numericParams, fn, diagnostics);
      if (cutters.length === 0) continue;
      const children = [body, ...cutters].map((node) => indent(node, 1)).join('\n');
      setBody(target, `difference() {\n${children}\n}`, comment);
      continue;
    }

    if (feature.kind === 'fillet') {
      let target = feature.bodies[0] ?? null;
      if (!target) {
        const matches = Array.from(infos.entries())
          .filter(([, info]) => boxMatchesEdge(info, feature.edges[0], numericParams))
          .map(([name]) => name);
        if (matches.length === 1) target = matches[0];
        else if (matches.length === 0 && bodies.size === 1) {
          target = Array.from(bodies.keys())[0];
        }
      }
      let info = target ? infos.get(target) : undefined;
      const body = target ? bodies.get(target) : undefined;
      if (!info && target && boxLike.has(target) && part.bodyBounds?.[target]) {
        const bounds = part.bodyBounds[target];
        info = {
          x0: String(bounds.min[0]), x1: String(bounds.max[0]),
          y0: String(bounds.min[1]), y1: String(bounds.max[1]),
          z0: String(bounds.min[2]), z1: String(bounds.max[2]),
        };
      }
      if (!target || !info || !body) {
        diagnostics.push({
          code: 'E125',
          severity: 'error',
          message: 'Fillet emission supports axis-aligned box bodies only.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const cutters = filletCutters(feature, info, numericParams, fn, diagnostics);
      if (cutters.length === 0) continue;
      const children = [body, ...cutters].map((node) => indent(node, 1)).join('\n');
      setBody(target, `difference() {\n${children}\n}`, comment);
      continue;
    }

    if (feature.kind === 'shell') {
      const target =
        feature.bodies[0] ?? (bodies.size === 1 ? Array.from(bodies.keys())[0] : null);
      const info = target ? infos.get(target) : undefined;
      const body = target ? bodies.get(target) : undefined;
      if (!target || !info || !body) {
        diagnostics.push({
          code: 'E126',
          severity: 'error',
          message: 'Shell emission supports axis-aligned box bodies only.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const inner = shellInnerBox(feature, info, numericParams, diagnostics);
      if (!inner) continue;
      const children = [body, inner].map((node) => indent(node, 1)).join('\n');
      setBody(target, `difference() {\n${children}\n}`, comment);
      continue;
    }

    if (feature.kind === 'extrude') {
      const node = extrudeNode(feature, fn, sketchNames);
      if (!node) continue;
      if (feature.operation === 'new_body' || !feature.operation) {
        for (const name of feature.bodies) {
          setBody(name, node, comment);
          if (feature.bodies.length === 1) {
            const info = extrudeBoxInfo(feature, numericParams);
            if (info) {
              infos.set(name, info);
              boxLike.add(name);
            }
          }
        }
        continue;
      }
      if (!['join', 'cut', 'intersect'].includes(feature.operation)) {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: `Extrude operation "${feature.operation}" is not supported.`,
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const targets = feature.targets ?? [];
      if (targets.length === 0) {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: 'Extrude boolean operation has no target body.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const op = booleanOp(feature.operation);
      for (const targetName of targets) {
        const target = bodies.get(targetName);
        if (!target) {
          diagnostics.push(missing(feature, targetName));
          continue;
        }
        const children = [target, node].map((child) => indent(child, 1)).join('\n');
        setBody(targetName, `${op}() {\n${children}\n}`, comment);
        if (feature.operation !== 'cut') infos.delete(targetName);
      }
      continue;
    }

    if (feature.kind === 'torus') {
      if (feature.operation !== 'new_body' && feature.operation !== '') {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: `Torus operation "${feature.operation}" is not supported yet.`,
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const node = `translate(${vec(feature.center)}) rotate_extrude($fn = ${fn}) translate([${expr(feature.major)}, 0, 0]) circle(r = ${expr(feature.minor)}, $fn = ${fn});`;
      for (const name of feature.bodies) setBody(name, node, comment);
      continue;
    }

    if (feature.kind === 'mirror') {
      const normal = vec(feature.normal);
      const origin = vec(feature.origin);
      const inverseOrigin = `[${feature.origin.map((value) => `-(${expr(value)})`).join(', ')}]`;
      for (const name of feature.bodies) {
        const current = bodies.get(name);
        if (!current) {
          diagnostics.push(missing(feature, name));
          continue;
        }
        const mirrored = `translate(${origin}) mirror(${normal}) translate(${inverseOrigin}) {\n${indent(current, 1)}\n}`;
        if (feature.combine) {
          setBody(
            name,
            `union() {\n${indent(current, 1)}\n${indent(mirrored, 1)}\n}`,
            comment,
          );
        } else {
          let newName = `${name} (2)`;
          let suffix = 3;
          while (bodies.has(newName)) {
            newName = `${name} (${suffix})`;
            suffix += 1;
          }
          setBody(newName, mirrored, comment);
        }
        infos.delete(name);
        boxLike.delete(name);
      }
      continue;
    }

    if (feature.kind === 'pattern_rect') {
      const count1Text = expr(feature.count1);
      const count2Text = feature.count2 ? expr(feature.count2) : '1';
      const count1 = evalArithmetic(count1Text, numericParams);
      const count2 = evalArithmetic(count2Text, numericParams);
      const spacing1 = expr(feature.spacing1);
      const spacing2 = feature.spacing2 ? expr(feature.spacing2) : '0';
      const dir1 = feature.dir1.map((value) => expr(value));
      const dir2 = (feature.dir2 ?? ['0', '0', '0']).map((value) => expr(value));
      if (count1 === null || count2 === null) {
        diagnostics.push({
          code: 'E128',
          severity: 'warning',
          message: 'Rectangular pattern counts must be numeric to emit separate bodies; using a single union.',
          featureId: feature.id,
          featureName: feature.name,
        });
        const loops = `for (i = [0 : (${count1Text}) - 1]) {\n  translate([${dir1.map((value) => `(${value}) * (${spacing1}) * i`).join(', ')}]) {\n${indent(bodies.get(feature.bodies[0]) ?? '', 2)}\n  }\n}`;
        for (const name of feature.bodies) {
          const current = bodies.get(name);
          if (!current) continue;
          setBody(name, `union() {\n${indent(loops, 1)}\n}`, comment);
          infos.delete(name);
          boxLike.delete(name);
        }
        continue;
      }
      for (const name of feature.bodies) {
        const current = bodies.get(name);
        if (!current) {
          diagnostics.push(missing(feature, name));
          continue;
        }
        const info = infos.get(name);
        const isBox = boxLike.has(name);
        let suffix = 2;
        for (let i = 0; i < count1; i += 1) {
          for (let j = 0; j < count2; j += 1) {
            if (i === 0 && j === 0) continue;
            let copyName = `${name} (${suffix})`;
            while (bodies.has(copyName)) {
              suffix += 1;
              copyName = `${name} (${suffix})`;
            }
            suffix += 1;
            const shifts = [0, 1, 2].map(
              (axis) =>
                `(${dir1[axis]}) * (${spacing1}) * ${i} + (${dir2[axis]}) * (${spacing2}) * ${j}`,
            );
            const transformed = `translate([${shifts.join(', ')}]) {\n${indent(current, 1)}\n}`;
            setBody(copyName, transformed, comment);
            if (info) {
              infos.set(copyName, shiftBox(info, shifts as [string, string, string]));
              if (isBox) boxLike.add(copyName);
            }
          }
        }
      }
      continue;
    }

    if (feature.kind === 'pattern_circ') {
      const countText = expr(feature.count);
      const angleText = expr(feature.angle);
      const count = evalArithmetic(countText, numericParams);
      const angleNumber = evalArithmetic(angleText, numericParams);
      const axis = vec(feature.axis);
      const origin = vec(feature.origin);
      const inverseOrigin = `[${feature.origin.map((value) => `-(${expr(value)})`).join(', ')}]`;
      const step =
        angleNumber !== null && Math.abs(angleNumber - 360) < 1e-6
          ? `(${angleText}) / (${countText})`
          : `(${angleText}) / ((${countText}) - 1)`;
      if (count === null || count < 1) {
        diagnostics.push({
          code: 'E128',
          severity: 'warning',
          message: 'Circular pattern count must be numeric to emit separate bodies; using a single union.',
          featureId: feature.id,
          featureName: feature.name,
        });
        const loop = `for (i = [0 : (${countText}) - 1]) {\n  translate(${origin}) rotate(a = (${step}) * i, v = ${axis}) translate(${inverseOrigin}) {\n${indent(bodies.get(feature.bodies[0]) ?? '', 2)}\n  }\n}`;
        for (const name of feature.bodies) {
          const current = bodies.get(name);
          if (!current) continue;
          setBody(name, `union() {\n${indent(loop, 1)}\n}`, comment);
          infos.delete(name);
          boxLike.delete(name);
        }
        continue;
      }
      for (const name of feature.bodies) {
        const current = bodies.get(name);
        if (!current) {
          diagnostics.push(missing(feature, name));
          continue;
        }
        let suffix = 2;
        for (let i = 1; i < count; i += 1) {
          let copyName = `${name} (${suffix})`;
          while (bodies.has(copyName)) {
            suffix += 1;
            copyName = `${name} (${suffix})`;
          }
          suffix += 1;
          const transformed = `translate(${origin}) rotate(a = (${step}) * ${i}, v = ${axis}) translate(${inverseOrigin}) {\n${indent(current, 1)}\n}`;
          setBody(copyName, transformed, comment);
        }
      }
      continue;
    }

    if (feature.kind === 'coil') {
      if (feature.operation !== 'new_body' && feature.operation !== '') {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: `Coil operation "${feature.operation}" is not supported yet.`,
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      usesBosl2 = true;
      const radius = `(${expr(feature.diameter)}) / 2`;
      const profile =
        feature.section === 'square'
          ? `square(${expr(feature.sectionSize)}, center = true)`
          : feature.section === 'circular'
            ? `circle(d = ${expr(feature.sectionSize)}, $fn = ${fn})`
            : null;
      if (!profile) {
        diagnostics.push({
          code: 'E110',
          severity: 'error',
          message: `Coil section "${feature.section}" is not supported yet.`,
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const turnsText = expr(feature.turns);
      const heightText = expr(feature.height);
      const samples = `((${turnsText}) * 64)`;
      const startAngle = feature.startAngle ? expr(feature.startAngle) : '0';
      const direction = feature.clockwise ? '-1' : '1';
      const angle = `(${startAngle}) + (${direction}) * 360 * (${turnsText}) * i / (${samples})`;
      const path = `[for (i = [0 : ${samples}]) [(${radius}) * cos(${angle}), (${radius}) * sin(${angle}), (${heightText}) * i / (${samples})]]`;
      let node = `path_sweep(${profile}, ${path}, closed = false);`;
      const rotation = axisRotation(feature.axis);
      if (rotation) node = `${rotation} {\n${indent(node, 1)}\n}`;
      if (!zeroVec(feature.base)) {
        node = `translate(${vec(feature.base)}) {\n${indent(node, 1)}\n}`;
      }
      for (const name of feature.bodies) setBody(name, node, comment);
      continue;
    }

    if (feature.kind === 'bounding') {
      const bounds = feature.targetBodies
        .map((name) => part.bodyBounds?.[name])
        .filter((value): value is { min: [number, number, number]; max: [number, number, number] } => Boolean(value));
      if (bounds.length === 0) {
        diagnostics.push({
          code: 'E127',
          severity: 'error',
          message: 'Bounding solid has no measured target bodies.',
          featureId: feature.id,
          featureName: feature.name,
        });
        continue;
      }
      const min = [0, 1, 2].map((axis) => Math.min(...bounds.map((bound) => bound.min[axis])));
      const max = [0, 1, 2].map((axis) => Math.max(...bounds.map((bound) => bound.max[axis])));
      const margin = feature.margin ? expr(feature.margin) : '0';
      const low = min.map((value) => `(${value}) - (${margin})`);
      const size = max.map(
        (value, axis) => `(${value}) - (${min[axis]}) + 2 * (${margin})`,
      );
      const node = `translate([${low.join(', ')}]) cube([${size.join(', ')}]);`;
      const info: BoxInfo = {
        x0: low[0], x1: `(${low[0]}) + (${size[0]})`,
        y0: low[1], y1: `(${low[1]}) + (${size[1]})`,
        z0: low[2], z1: `(${low[2]}) + (${size[2]})`,
      };
      for (const name of feature.bodies) {
        setBody(name, node, comment);
        infos.set(name, info);
        boxLike.add(name);
      }
      continue;
    }

    if (feature.kind === 'move') {
      for (const name of feature.bodies) {
        if (!feature.copy && part.inferredBodies?.includes(name)) {
          // Inferred component bodies are already at their measured world position.
          continue;
        }
        const current = bodies.get(name);
        if (!current) {
          diagnostics.push(missing(feature, name));
          continue;
        }
        let transformed = current;
        if (feature.axis && feature.angle) {
          transformed = wrap(
            `rotate(a = ${expr(feature.angle)}, v = ${vec(feature.axis)})`,
            transformed,
          );
        }
        if (feature.translate && !zeroVec(feature.translate)) {
          transformed = wrap(`translate(${vec(feature.translate)})`, transformed);
        }
        if (feature.copy) {
          let newName = `${name} (2)`;
          let suffix = 3;
          while (bodies.has(newName)) {
            newName = `${name} (${suffix})`;
            suffix += 1;
          }
          setBody(newName, transformed, comment);
          const info = infos.get(name);
          if (info && feature.translate && !(feature.axis && feature.angle)) {
            infos.set(newName, shiftBox(info, [
              expr(feature.translate[0]),
              expr(feature.translate[1]),
              expr(feature.translate[2]),
            ]));
          }
          if (!(feature.axis && feature.angle) && boxLike.has(name)) {
            boxLike.add(newName);
          }
          continue;
        }
        const info = infos.get(name);
        if (info && feature.translate && !(feature.axis && feature.angle)) {
          infos.set(name, shiftBox(info, [
            expr(feature.translate[0]),
            expr(feature.translate[1]),
            expr(feature.translate[2]),
          ]));
        } else {
          infos.delete(name);
        }
        if (feature.axis && feature.angle) boxLike.delete(name);
        setBody(name, transformed, comment);
      }
      continue;
    }

    if (feature.kind === 'combine') {
      const target = bodies.get(feature.target);
      if (!target) {
        diagnostics.push(missing(feature, feature.target));
        continue;
      }
      const tools: string[] = [];
      for (const tool of feature.tools) {
        const node = bodies.get(tool);
        if (!node) {
          diagnostics.push(missing(feature, tool));
          continue;
        }
        tools.push(node);
      }
      if (tools.length === 0) continue;
      const op = booleanOp(feature.operation);
      const children = [target, ...tools]
        .map((node) => indent(node, 1))
        .join('\n');
      setBody(feature.target, `${op}() {\n${children}\n}`, comment);
      if (feature.operation !== 'cut') {
        infos.delete(feature.target);
        boxLike.delete(feature.target);
      }
      if (!feature.keepTools) {
        for (const tool of feature.tools) {
          bodies.delete(tool);
          comments.delete(tool);
        }
      }
      continue;
    }

    if (feature.kind === 'remove') {
      for (const name of feature.bodies) {
        bodies.delete(name);
        comments.delete(name);
        infos.delete(name);
        boxLike.delete(name);
      }
      continue;
    }
  }

  const surviving = order.filter((name) => bodies.has(name));
  const usedNames = new Set<string>();
  const moduleNames = new Map<string, string>();
  const moduleBlocks: string[] = [];
  for (const name of surviving) {
    const mod = moduleName(name, usedNames);
    moduleNames.set(name, mod);
    const node = bodies.get(name) ?? '';
    moduleBlocks.push(
      `// ${name}\nmodule ${mod}() {\n${indent(node, 1)}\n}`,
    );
  }

  const header: string[] = [
    '// Generated by SCADBridge',
    `// Source: SolidCraft, revision ${part.revision ?? 'unknown'}`,
    `// Units: ${part.units}`,
    `// Features: ${part.features.length}`,
    '',
    ...(usesBosl2 ? ['include <BOSL2/std.scad>;', ''] : []),
    `$fn = ${fn};`,
    '',
  ];

  const params = part.parameters.map((param) => {
    const value = overrides[param.name] ?? param.expression;
    const unit = param.unit ? ` // ${param.unit}` : '';
    return `${param.name} = ${sanitizeExpression(value)};${unit}`;
  });
  const paramBlock = params.length ? `// Parameters\n${params.join('\n')}\n\n` : '';

  const calls = surviving
    .map((name) => `    ${moduleNames.get(name)}();`)
    .join('\n');
  const partModule = `module part() {\n  union() {\n${calls || '    // empty'}\n  }\n}\n\npart();\n`;

  const sketchSection = sketchBlocks.length ? `${sketchBlocks.join('\n\n')}\n\n` : '';
  const code = `${header.join('\n')}${paramBlock}${sketchSection}${moduleBlocks.join('\n\n')}\n\n${partModule}`;

  if (surviving.length === 0) {
    diagnostics.push({
      code: 'W130',
      severity: 'warning',
      message: 'No bodies in the design.',
    });
  }
  const bodyModules = Object.fromEntries(
    surviving.map((name) => [name, moduleNames.get(name) as string]),
  );
  return { code, diagnostics, bodies: surviving, bodyModules };
}

function missingBody(
  feature: FeatureIR,
  body: string,
  available: string[],
  creators: string[],
): Diagnostic {
  return {
    code: 'E102',
    severity: 'error',
    message: `Body "${body}" is not available at this point in the timeline. Available: ${available.join(', ') || 'none'}. Body creators: ${creators.join('; ') || 'none'}.`,
    featureId: feature.id,
    featureName: feature.name,
  };
}

function chamferDiagnostic(feature: ChamferFeature): Diagnostic {
  return {
    code: 'E121',
    severity: 'error',
    message:
      'Chamfer emission supports straight edges on axis-aligned boxes only. This feature was not emitted.',
    featureId: feature.id,
    featureName: feature.name,
  };
}
