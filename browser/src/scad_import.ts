import type { Diagnostic } from './ir';
import {
  evaluateNumber,
  expressionToScad,
  parseScad,
  type ScadExpr,
  type ScadStmt,
} from './scad_parser';

export interface ImportCommand {
  command: string;
  params: Record<string, unknown>;
}

export interface ImportPlan {
  ok: boolean;
  sourceName: string;
  commands: ImportCommand[];
  parameters: Array<{ name: string; expression: string }>;
  diagnostics: Diagnostic[];
}

interface ModuleDefinition {
  parameters: string[];
  body: ScadStmt[];
}

interface Context {
  commands: ImportCommand[];
  diagnostics: Diagnostic[];
  modules: Map<string, ModuleDefinition>;
  numbers: Map<string, number>;
  counter: number;
  sketchCounter: number;
  activeModules: Set<string>;
}

function error(ctx: Context, code: string, message: string): void {
  ctx.diagnostics.push({ code, severity: 'error', message });
}

function warning(ctx: Context, code: string, message: string): void {
  ctx.diagnostics.push({ code, severity: 'warning', message });
}

function positional(call: Extract<ScadStmt, { kind: 'call' }>, index: number): ScadExpr | undefined {
  return call.args.filter((arg) => !arg.name)[index]?.value;
}

function named(call: Extract<ScadStmt, { kind: 'call' }>, name: string): ScadExpr | undefined {
  return call.args.find((arg) => arg.name === name)?.value;
}

function argument(
  call: Extract<ScadStmt, { kind: 'call' }>,
  name: string,
  index: number,
): ScadExpr | undefined {
  return named(call, name) ?? positional(call, index);
}

function asBoolean(expr: ScadExpr | undefined): boolean | null {
  if (!expr) return null;
  if (expr.kind === 'boolean') return expr.value;
  if (expr.kind === 'number') return expr.value !== 0;
  if (expr.kind === 'identifier') {
    if (expr.name === 'true') return true;
    if (expr.name === 'false') return false;
  }
  return null;
}

function asVector3(expr: ScadExpr | undefined): ScadExpr[] | null {
  if (!expr || expr.kind !== 'vector' || expr.items.length !== 3) return null;
  return expr.items;
}

function bodyName(ctx: Context, kind: string): string {
  ctx.counter += 1;
  return `scad_${ctx.counter}_${kind}`;
}

function sketchName(ctx: Context): string {
  ctx.sketchCounter += 1;
  return `scad_sketch_${ctx.sketchCounter}`;
}

function doubleText(a: string, na: number | null): string {
  return na !== null ? String(na * 2) : `2 * (${a})`;
}

interface Section {
  shape: 'rect' | 'circle';
  x: number;
  y: number;
  z: number;
  width?: number;
  depth?: number;
  diameter?: number;
}

function addSectionSketch(ctx: Context, section: Section): string {
  const name = sketchName(ctx);
  addCommand(ctx, 'sketch.create', {
    plane: {
      origin: [section.x, section.y, section.z],
      x_dir: [1, 0, 0],
      y_dir: [0, 1, 0],
    },
    name,
  });
  if (section.shape === 'rect') {
    const width = section.width ?? 0;
    const depth = section.depth ?? 0;
    addCommand(ctx, 'sketch.rectangle.two_point', {
      p0: [-width / 2, -depth / 2],
      p1: [width / 2, depth / 2],
    });
  } else {
    addCommand(ctx, 'sketch.circle.center', {
      center: [0, 0],
      diameter: section.diameter ?? 0,
    });
  }
  addCommand(ctx, 'sketch.finish', {});
  return name;
}

function loftBody(ctx: Context, sections: Section[], kind: string): string {
  const names = sections.map((section) => addSectionSketch(ctx, section));
  const body = bodyName(ctx, kind);
  addCommand(ctx, 'solid.loft', {
    sections: names.map((sketch) => ({ sketch })),
    body_name: body,
  });
  return body;
}

/// SolidCraft smooths a loft through three or more sections. Hulls need piecewise ruled
/// segments, so build each pair separately and join them.
function loftSegments(ctx: Context, sections: Section[], kind: string): string {
  if (sections.length <= 2) return loftBody(ctx, sections, kind);
  const parts: string[] = [];
  for (let i = 0; i < sections.length - 1; i += 1) {
    parts.push(loftBody(ctx, [sections[i], sections[i + 1]], `${kind}_part`));
  }
  addCommand(ctx, 'solid.combine', {
    target: parts[0],
    tools: parts.slice(1),
    operation: 'join',
  });
  return parts[0];
}

function addCommand(ctx: Context, command: string, params: Record<string, unknown>): void {
  ctx.commands.push({ command, params });
}

function emitCube(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
): string[] {
  const size = argument(call, 'size', 0);
  if (!size) {
    error(ctx, 'E204', 'cube() is missing its size.');
    return [];
  }
  let dims: string[];
  if (size.kind === 'vector') {
    if (size.items.length !== 3) {
      error(ctx, 'E204', 'cube() size must have three components.');
      return [];
    }
    dims = size.items.map(expressionToScad);
  } else {
    const text = expressionToScad(size);
    dims = [text, text, text];
  }
  const centered = asBoolean(argument(call, 'center', 1)) ?? false;
  const name = bodyName(ctx, 'cube');
  addCommand(ctx, 'solid.box', {
    length: dims[0],
    width: dims[1],
    height: dims[2],
    ...(centered ? { center: [0, 0, 0] } : { corner: [0, 0, 0] }),
    body_name: name,
  });
  return [name];
}

function emitSphere(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
): string[] {
  const radius = argument(call, 'r', 0);
  const diameter = named(call, 'd');
  if (!radius && !diameter) {
    error(ctx, 'E204', 'sphere() is missing r or d.');
    return [];
  }
  const name = bodyName(ctx, 'sphere');
  addCommand(ctx, 'solid.sphere', {
    ...(radius
      ? { radius: expressionToScad(radius) }
      : { diameter: expressionToScad(diameter as ScadExpr) }),
    center: [0, 0, 0],
    body_name: name,
  });
  return [name];
}

function emitCylinder(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
): string[] {
  const height = argument(call, 'h', 0);
  if (!height) {
    error(ctx, 'E204', 'cylinder() is missing its height.');
    return [];
  }
  const heightText = expressionToScad(height);
  const centered = asBoolean(argument(call, 'center', 3)) ?? false;

  const namedD1 = named(call, 'd1');
  const namedD2 = named(call, 'd2');
  const namedR1 = named(call, 'r1');
  const namedR2 = named(call, 'r2');
  const positional1 = positional(call, 1);
  const positional2 = positional(call, 2);
  const tapered = Boolean(namedD1 || namedD2 || namedR1 || namedR2 || positional2);

  if (tapered) {
    const firstExpr = namedD1 ?? namedR1 ?? positional1;
    const secondExpr = namedD2 ?? namedR2 ?? positional2;
    if (!firstExpr || !secondExpr) {
      error(ctx, 'E204', 'cylinder() taper needs both ends (d1/d2 or r1/r2).');
      return [];
    }
    const firstIsRadius = Boolean(namedR1) || (!namedD1 && !namedD2 && Boolean(positional1));
    const secondIsRadius = Boolean(namedR2) || (!namedD1 && !namedD2 && Boolean(positional2));
    const firstText = expressionToScad(firstExpr);
    const firstNumber = evaluateNumber(firstExpr, ctx.numbers);
    const secondNumber = evaluateNumber(secondExpr, ctx.numbers);
    const heightNumber = evaluateNumber(height, ctx.numbers);
    const d1Text = firstIsRadius ? doubleText(firstText, firstNumber) : firstText;
    const d1Number = firstIsRadius ? (firstNumber === null ? null : firstNumber * 2) : firstNumber;
    const d2Number = secondIsRadius ? (secondNumber === null ? null : secondNumber * 2) : secondNumber;

    if (firstNumber === null || secondNumber === null || heightNumber === null) {
      error(ctx, 'E202', 'Tapered cylinders must be numeric for import.');
      return [];
    }
    if (d1Number !== null && d2Number !== null && Math.abs(d1Number - d2Number) < 1e-9) {
      const name = bodyName(ctx, 'cylinder');
      addCommand(ctx, 'solid.cylinder', {
        diameter: d1Text,
        height: heightText,
        base: [0, 0, centered ? `-(${heightText}) / 2` : '0'],
        body_name: name,
      });
      return [name];
    }

    const z0 = centered ? -heightNumber / 2 : 0;
    const z1 = centered ? heightNumber / 2 : heightNumber;
    const body = loftBody(
      ctx,
      [
        { shape: 'circle', x: 0, y: 0, z: z0, diameter: d1Number as number },
        { shape: 'circle', x: 0, y: 0, z: z1, diameter: d2Number as number },
      ],
      'taper',
    );
    return [body];
  }

  const radius = named(call, 'r') ?? positional1;
  const diameter = named(call, 'd');
  if (!radius && !diameter) {
    error(ctx, 'E204', 'cylinder() is missing r or d.');
    return [];
  }
  const name = bodyName(ctx, 'cylinder');
  addCommand(ctx, 'solid.cylinder', {
    ...(radius
      ? { radius: expressionToScad(radius) }
      : { diameter: expressionToScad(diameter as ScadExpr) }),
    height: heightText,
    base: [0, 0, centered ? `-(${heightText}) / 2` : '0'],
    body_name: name,
  });
  return [name];
}

function moveBodies(
  names: string[],
  translate: string[] | undefined,
  axis: string[] | undefined,
  angle: string | undefined,
  ctx: Context,
): void {
  if (translate === undefined && (axis === undefined || angle === undefined)) return;
  for (const name of names) {
    addCommand(ctx, 'solid.move', {
      bodies: [name],
      ...(translate !== undefined ? { translate } : {}),
      ...(axis !== undefined && angle !== undefined ? { axis, angle } : {}),
    });
  }
}

function emitTranslate(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
  depth: number,
): string[] {
  const vector = asVector3(argument(call, 'v', 0));
  if (!vector) {
    error(ctx, 'E204', 'translate() needs a three-component vector.');
    return [];
  }
  const names = emitStatements(call.children, ctx, depth + 1);
  moveBodies(names, vector.map(expressionToScad), undefined, undefined, ctx);
  return names;
}

function emitRotate(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
  depth: number,
): string[] {
  const names = emitStatements(call.children, ctx, depth + 1);
  if (names.length === 0) return names;

  const angleArg = argument(call, 'a', 0);
  const axisArg = argument(call, 'v', 1);
  if (!angleArg) {
    error(ctx, 'E204', 'rotate() is missing its angle.');
    return names;
  }

  if (angleArg.kind === 'vector' && !axisArg) {
    if (angleArg.items.length !== 3) {
      error(ctx, 'E204', 'rotate() angle vector must have three components.');
      return names;
    }
    const values = angleArg.items.map((item) => evaluateNumber(item, ctx.numbers));
    if (values.some((value) => value === null)) {
      error(ctx, 'E203', 'rotate() angles must be numeric for import.');
      return names;
    }
    const angles = values as number[];
    const nonzero = angles
      .map((value, index) => ({ index, value }))
      .filter((entry) => Math.abs(entry.value) > 1e-12);
    if (nonzero.length === 0) return names;
    if (nonzero.length > 1) {
      error(
        ctx,
        'E203',
        'Multi-axis rotate() is not supported yet. Use separate rotations.',
      );
      return names;
    }
    const axis = ['0', '0', '0'];
    axis[nonzero[0].index] = '1';
    moveBodies(
      names,
      undefined,
      axis,
      String(nonzero[0].value),
      ctx,
    );
    return names;
  }

  const defaultAxis: ScadExpr = {
    kind: 'vector',
    items: [
      { kind: 'number', value: 0, text: '0' },
      { kind: 'number', value: 0, text: '0' },
      { kind: 'number', value: 1, text: '1' },
    ],
  };
  const axis = asVector3(axisArg ?? defaultAxis);
  if (!axis) {
    error(ctx, 'E204', 'rotate() axis must be a three-component vector.');
    return names;
  }
  moveBodies(names, undefined, axis.map(expressionToScad), expressionToScad(angleArg), ctx);
  return names;
}

interface HullProfile {
  shape: 'rect' | 'circle';
  x: number;
  y: number;
  zBottom: number;
  zTop: number;
  width?: number;
  depth?: number;
  diameter?: number;
}

interface Offset3 {
  x: number;
  y: number;
  z: number;
}

const ZERO_OFFSET: Offset3 = { x: 0, y: 0, z: 0 };

function extractHullProfile(
  statement: ScadStmt,
  ctx: Context,
  offset: Offset3 = ZERO_OFFSET,
): HullProfile | null {
  if (statement.kind !== 'call') {
    error(ctx, 'E202', 'hull() supports primitive children and translate() only.');
    return null;
  }
  const call = statement;
  if (call.name === 'translate') {
    const vector = asVector3(argument(call, 'v', 0));
    if (!vector) {
      error(ctx, 'E204', 'translate() inside hull() needs a three-component vector.');
      return null;
    }
    if (call.children.length !== 1) {
      error(ctx, 'E202', 'hull() children must each contain one primitive.');
      return null;
    }
    const numbers = vector.map((item) => evaluateNumber(item, ctx.numbers));
    if (numbers.some((value) => value === null)) {
      error(ctx, 'E202', 'hull() translations must be numeric for import.');
      return null;
    }
    return extractHullProfile(call.children[0], ctx, {
      x: offset.x + (numbers[0] as number),
      y: offset.y + (numbers[1] as number),
      z: offset.z + (numbers[2] as number),
    });
  }

  if (call.name === 'cube') {
    const size = argument(call, 'size', 0);
    if (!size) {
      error(ctx, 'E204', 'cube() inside hull() is missing its size.');
      return null;
    }
    let dims: ScadExpr[];
    if (size.kind === 'vector') {
      if (size.items.length !== 3) {
        error(ctx, 'E204', 'cube() inside hull() needs three size components.');
        return null;
      }
      dims = size.items;
    } else {
      dims = [size, size, size];
    }
    const numbers = dims.map((item) => evaluateNumber(item, ctx.numbers));
    if (numbers.some((value) => value === null)) {
      error(ctx, 'E202', 'hull() cube sizes must be numeric for import.');
      return null;
    }
    const [width, depth, height] = numbers as number[];
    const centered = asBoolean(argument(call, 'center', 1)) ?? false;
    return {
      shape: 'rect',
      x: centered ? offset.x : offset.x + width / 2,
      y: centered ? offset.y : offset.y + depth / 2,
      zBottom: centered ? offset.z - height / 2 : offset.z,
      zTop: centered ? offset.z + height / 2 : offset.z + height,
      width,
      depth,
    };
  }

  if (call.name === 'cylinder') {
    if (named(call, 'r1') || named(call, 'r2') || named(call, 'd1') || named(call, 'd2') || positional(call, 2)) {
      error(ctx, 'E202', 'hull() with tapered cylinders is not supported.');
      return null;
    }
    const height = argument(call, 'h', 0);
    const radius = named(call, 'r') ?? positional(call, 1);
    const diameter = named(call, 'd');
    if (!height || (!radius && !diameter)) {
      error(ctx, 'E204', 'cylinder() inside hull() is missing height or radius.');
      return null;
    }
    const heightNumber = evaluateNumber(height, ctx.numbers);
    const radiusNumber = radius ? evaluateNumber(radius, ctx.numbers) : null;
    const diameterNumber = diameter ? evaluateNumber(diameter, ctx.numbers) : null;
    if (heightNumber === null || (radiusNumber === null && diameterNumber === null)) {
      error(ctx, 'E202', 'hull() cylinder sizes must be numeric for import.');
      return null;
    }
    const centered = asBoolean(argument(call, 'center', 2)) ?? false;
    return {
      shape: 'circle',
      x: offset.x,
      y: offset.y,
      zBottom: centered ? offset.z - heightNumber / 2 : offset.z,
      zTop: centered ? offset.z + heightNumber / 2 : offset.z + heightNumber,
      diameter: radiusNumber !== null ? radiusNumber * 2 : (diameterNumber as number),
    };
  }

  error(ctx, 'E202', `hull() does not support ${call.name}() for import yet.`);
  return null;
}

function profileRect(profile: HullProfile): {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
} {
  const halfWidth =
    profile.shape === 'rect'
      ? (profile.width ?? 0) / 2
      : (profile.diameter ?? 0) / 2;
  const halfDepth =
    profile.shape === 'rect'
      ? (profile.depth ?? 0) / 2
      : (profile.diameter ?? 0) / 2;
  return {
    x0: profile.x - halfWidth,
    x1: profile.x + halfWidth,
    y0: profile.y - halfDepth,
    y1: profile.y + halfDepth,
  };
}

function emitHull(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
  depth: number,
): string[] {
  if (call.children.length === 0) {
    warning(ctx, 'W200', 'hull() has no geometry.');
    return [];
  }
  if (call.children.length === 1) {
    return emitStatements(call.children, ctx, depth + 1);
  }
  const profiles: HullProfile[] = [];
  for (const child of call.children) {
    const profile = extractHullProfile(child, ctx);
    if (!profile) return [];
    profiles.push(profile);
  }
  const shape = profiles[0].shape;
  if (profiles.some((profile) => profile.shape !== shape)) {
    error(ctx, 'E202', 'hull() with mixed rectangle and circle profiles is not supported.');
    return [];
  }
  const sorted = [...profiles].sort((a, b) => a.zBottom - b.zBottom);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].zBottom < sorted[i - 1].zTop - 1e-9) {
      error(ctx, 'E202', 'hull() profiles overlap in height; this hull is not supported.');
      return [];
    }
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const z0 = first.zBottom;
  const z1 = last.zTop;
  const firstRect = profileRect(first);
  const lastRect = profileRect(last);
  const included = new Map<number, Section>();

  const add = (profile: HullProfile, z: number) => {
    included.set(z, {
      shape: profile.shape,
      x: profile.x,
      y: profile.y,
      z,
      ...(profile.shape === 'rect'
        ? { width: profile.width, depth: profile.depth }
        : { diameter: profile.diameter }),
    });
  };

  add(first, z0);
  add(last, z1);
  const span = z1 - z0;
  for (const profile of sorted) {
    const face = profileRect(profile);
    for (const z of [profile.zBottom, profile.zTop]) {
      if (z <= z0 + 1e-9 || z >= z1 - 1e-9 || span <= 0) continue;
      const t = (z - z0) / span;
      const ix0 = firstRect.x0 + (lastRect.x0 - firstRect.x0) * t;
      const ix1 = firstRect.x1 + (lastRect.x1 - firstRect.x1) * t;
      const iy0 = firstRect.y0 + (lastRect.y0 - firstRect.y0) * t;
      const iy1 = firstRect.y1 + (lastRect.y1 - firstRect.y1) * t;
      const outside =
        face.x0 < ix0 - 1e-6 ||
        face.x1 > ix1 + 1e-6 ||
        face.y0 < iy0 - 1e-6 ||
        face.y1 > iy1 + 1e-6;
      if (outside) add(profile, z);
    }
  }

  const sections = Array.from(included.entries())
    .sort((a, b) => a[0] - b[0])
    .map((entry) => entry[1]);
  return [loftSegments(ctx, sections, 'hull')];
}

function substituteExpr(expr: ScadExpr, name: string, value: string): ScadExpr {
  switch (expr.kind) {
    case 'identifier':
      return expr.name === name ? { kind: 'number', value: Number(value), text: value } : expr;
    case 'number':
    case 'boolean':
    case 'string':
      return expr;
    case 'vector':
      return { ...expr, items: expr.items.map((item) => substituteExpr(item, name, value)) };
    case 'binary':
      return {
        ...expr,
        left: substituteExpr(expr.left, name, value),
        right: substituteExpr(expr.right, name, value),
      };
    case 'unary':
      return { ...expr, operand: substituteExpr(expr.operand, name, value) };
    case 'call':
      return {
        ...expr,
        args: expr.args.map((arg) => ({
          ...arg,
          value: substituteExpr(arg.value, name, value),
        })),
      };
  }
}

function substituteStmt(statement: ScadStmt, name: string, value: string): ScadStmt {
  switch (statement.kind) {
    case 'assignment':
      return { ...statement, value: substituteExpr(statement.value, name, value) };
    case 'call':
      return {
        ...statement,
        args: statement.args.map((arg) => ({
          ...arg,
          value: substituteExpr(arg.value, name, value),
        })),
        children: statement.children.map((child) => substituteStmt(child, name, value)),
      };
    case 'module':
      return {
        ...statement,
        body: statement.body.map((child) => substituteStmt(child, name, value)),
      };
  }
}

function emitFor(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
  depth: number,
): string[] {
  if (call.args.length !== 1 || !call.args[0].name) {
    error(ctx, 'E205', 'for() supports one loop variable for import.');
    return [];
  }
  const loop = call.args[0];
  if (loop.value.kind !== 'vector') {
    error(ctx, 'E205', 'for() supports a vector of values for import, not a range.');
    return [];
  }
  const names: string[] = [];
  for (const item of loop.value.items) {
    if (item.kind === 'vector') {
      error(ctx, 'E205', 'for() over vectors of vectors is not supported.');
      continue;
    }
    const value = expressionToScad(item);
    const body = call.children.map((child) =>
      substituteStmt(child, loop.name as string, value),
    );
    names.push(...emitStatements(body, ctx, depth + 1));
  }
  return names;
}

function emitBoolean(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
  depth: number,
): string[] {
  const names = emitStatements(call.children, ctx, depth + 1);
  if (names.length === 0) {
    warning(ctx, 'W200', `${call.name}() has no geometry.`);
    return names;
  }
  if (names.length === 1) return names;
  const operation =
    call.name === 'union' ? 'join' : call.name === 'difference' ? 'cut' : 'intersect';
  addCommand(ctx, 'solid.combine', {
    target: names[0],
    tools: names.slice(1),
    operation,
  });
  return [names[0]];
}

function emitCall(
  call: Extract<ScadStmt, { kind: 'call' }>,
  ctx: Context,
  depth: number,
): string[] {
  if (depth > 64) {
    error(ctx, 'E205', 'Geometry nesting is too deep or recursive.');
    return [];
  }

  const moduleDefinition = ctx.modules.get(call.name);
  if (moduleDefinition) {
    if (moduleDefinition.parameters.length > 0) {
      error(ctx, 'E206', `Module ${call.name}() has parameters, which are not supported.`);
      return [];
    }
    if (ctx.activeModules.has(call.name)) {
      error(ctx, 'E205', `Module ${call.name}() calls itself.`);
      return [];
    }
    if (call.args.length > 0 || call.children.length > 0) {
      error(ctx, 'E206', `Module ${call.name}() does not accept arguments here.`);
      return [];
    }
    ctx.activeModules.add(call.name);
    const names = emitStatements(moduleDefinition.body, ctx, depth + 1);
    ctx.activeModules.delete(call.name);
    return names;
  }

  switch (call.name) {
    case 'cube':
      return emitCube(call, ctx);
    case 'sphere':
      return emitSphere(call, ctx);
    case 'cylinder':
      return emitCylinder(call, ctx);
    case 'translate':
      return emitTranslate(call, ctx, depth);
    case 'rotate':
      return emitRotate(call, ctx, depth);
    case 'union':
    case 'difference':
    case 'intersection':
      return emitBoolean(call, ctx, depth);
    case 'for':
      return emitFor(call, ctx, depth);
    case 'hull':
      return emitHull(call, ctx, depth);
    case 'group':
      return emitStatements(call.children, ctx, depth + 1);
    case 'color':
    case 'render':
      return emitStatements(call.children, ctx, depth + 1);
    case 'scale':
    case 'mirror':
    case 'multmatrix':
      error(ctx, 'E203', `${call.name}() is not supported for import yet.`);
      return [];
    case 'minkowski':
    case 'offset':
    case 'projection':
    case 'linear_extrude':
    case 'rotate_extrude':
    case 'polygon':
    case 'polyhedron':
    case 'text':
    case 'import':
      error(ctx, 'E202', `${call.name}() is not supported for import yet.`);
      return [];
    default:
      error(ctx, 'E202', `Unknown module ${call.name}().`);
      return [];
  }
}

function emitStatements(statements: ScadStmt[], ctx: Context, depth: number): string[] {
  const names: string[] = [];
  for (const statement of statements) {
    if (statement.kind === 'assignment') {
      if (depth > 0) {
        error(
          ctx,
          'E205',
          `Local variable ${statement.name} is not supported inside geometry.`,
        );
      }
      continue;
    }
    if (statement.kind === 'module') continue;
    names.push(...emitCall(statement, ctx, depth));
  }
  return names;
}

export function planScadImport(source: string, sourceName = 'model.scad'): ImportPlan {
  const ctx: Context = {
    commands: [],
    diagnostics: [],
    modules: new Map(),
    numbers: new Map(),
    counter: 0,
    sketchCounter: 0,
    activeModules: new Set(),
  };
  const parameters: Array<{ name: string; expression: string }> = [];

  let statements: ScadStmt[];
  try {
    statements = parseScad(source).statements;
  } catch (error) {
    return {
      ok: false,
      sourceName,
      commands: [],
      parameters: [],
      diagnostics: [
        {
          code: 'E200',
          severity: 'error',
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }

  for (const statement of statements) {
    if (statement.kind === 'module') {
      ctx.modules.set(statement.name, {
        parameters: statement.parameters,
        body: statement.body,
      });
      continue;
    }
    if (statement.kind !== 'assignment') continue;
    if (statement.name.startsWith('$')) continue;
    if (statement.value.kind === 'string') {
      error(ctx, 'E208', `Parameter ${statement.name} is a string, which is not supported.`);
      continue;
    }
    const expression = expressionToScad(statement.value);
    parameters.push({ name: statement.name, expression });
    ctx.commands.push({
      command: 'parameters.add',
      params: { name: statement.name, expression, unit: '' },
    });
    const numeric = evaluateNumber(statement.value, ctx.numbers);
    if (numeric !== null) ctx.numbers.set(statement.name, numeric);
  }

  const topLevelCalls = statements.filter(
    (statement): statement is Extract<ScadStmt, { kind: 'call' }> =>
      statement.kind === 'call',
  );
  const bodies = emitStatements(topLevelCalls, ctx, 0);
  if (bodies.length === 0 && ctx.diagnostics.every((item) => item.severity !== 'error')) {
    error(ctx, 'E207', 'The SCAD file produced no importable geometry.');
  }

  return {
    ok: ctx.diagnostics.every((item) => item.severity !== 'error'),
    sourceName,
    commands: ctx.commands,
    parameters,
    diagnostics: ctx.diagnostics,
  };
}
