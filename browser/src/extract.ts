import type {
  BodyMeasurement,
  ComponentList,
  DesignInspection,
  FeatureInspection,
  JsonValue,
  SketchInspection,
} from './types';
import { execute, inspectFeature, inspectFeatureByName, inspectSketch, listComponents, measureBodies } from './solidcraft';
import type {
  BoxFeature,
  ChamferFeature,
  CombineFeature,
  CylinderFeature,
  Diagnostic,
  Expr,
  FeatureIR,
  FilletFeature,
  ExtrudeFeature,
  TorusFeature,
  MirrorFeature,
  RectangularPatternFeature,
  CircularPatternFeature,
  CoilFeature,
  BoundingSolidFeature,
  HoleFeature,
  MoveFeature,
  ParamIR,
  PartIR,
  RemoveFeature,
  ShellFeature,
  SketchFeature,
  SketchProfileIR,
  SphereFeature,
  UnsupportedFeature,
  Vec3Expr,
} from './ir';

function asString(value: JsonValue | undefined): Expr | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function asVec3(value: JsonValue | undefined): Vec3Expr | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const parts = value.map((item) => asString(item as JsonValue));
  if (parts.some((part) => part === undefined)) return undefined;
  return parts as Vec3Expr;
}

function asStrings(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function bodyNames(definition: Record<string, JsonValue>): string[] {
  return asStrings(definition.body_names);
}

function primitivesOf(
  definition: Record<string, JsonValue>,
): { bodies: string[]; operation: string; targets?: string[] } {
  const targets = asStrings(definition.targets);
  return {
    bodies: bodyNames(definition),
    operation: asString(definition.operation) ?? 'new_body',
    targets: targets.length > 0 ? targets : asStrings(definition.participants),
  };
}

export function extractParameters(inspection: DesignInspection): ParamIR[] {
  return inspection.params.map((param) => ({
    name: param.name,
    expression: param.expression,
    unit: param.unit,
    value: param.value,
    comment: param.comment,
    model: param.model,
  }));
}

export function extractFeature(
  detail: FeatureInspection,
  diagnostics: Diagnostic[],
): FeatureIR {
  const base = { id: detail.id, name: detail.name, type: detail.type };
  const definition = detail.definition ?? {};

  switch (detail.type) {
    case 'BoxFeature': {
      const length = asString(definition.length);
      const width = asString(definition.width);
      const height = asString(definition.height);
      if (!length || !width || !height) {
        return unsupported(base, definition, diagnostics, 'Box is missing dimensions.');
      }
      const feature: BoxFeature = {
        ...base,
        kind: 'box',
        ...primitivesOf(definition),
        length,
        width,
        height,
        corner: asVec3(definition.corner),
        center: asVec3(definition.center),
        raw: definition,
      };
      return feature;
    }
    case 'CylinderFeature': {
      const height = asString(definition.height);
      const radius = asString(definition.radius);
      const diameter = asString(definition.diameter);
      if (!height || (!radius && !diameter)) {
        return unsupported(
          base,
          definition,
          diagnostics,
          'Cylinder is missing radius or height.',
        );
      }
      const feature: CylinderFeature = {
        ...base,
        kind: 'cylinder',
        ...primitivesOf(definition),
        radius,
        diameter,
        height,
        base: asVec3(definition.base),
        axis: asVec3(definition.axis),
        raw: definition,
      };
      return feature;
    }
    case 'SphereFeature': {
      const radius = asString(definition.radius);
      const diameter = asString(definition.diameter);
      if (!radius && !diameter) {
        return unsupported(
          base,
          definition,
          diagnostics,
          'Sphere is missing a radius.',
        );
      }
      const feature: SphereFeature = {
        ...base,
        kind: 'sphere',
        ...primitivesOf(definition),
        radius,
        diameter,
        center: asVec3(definition.center),
        raw: definition,
      };
      return feature;
    }
    case 'CombineFeature': {
      const target = asString(definition.target);
      const tools = asStrings(definition.tools);
      const operation = asString(definition.operation);
      if (!target || tools.length === 0) {
        return unsupported(
          base,
          definition,
          diagnostics,
          'Combine is missing a target or tools.',
        );
      }
      if (operation !== 'join' && operation !== 'cut' && operation !== 'intersect') {
        return unsupported(
          base,
          definition,
          diagnostics,
          `Unsupported combine operation: ${operation ?? 'missing'}.`,
        );
      }
      const feature: CombineFeature = {
        ...base,
        kind: 'combine',
        target,
        tools,
        operation,
        keepTools: definition.keep_tools === true,
        raw: definition,
      };
      return feature;
    }
    case 'MoveFeature': {
      const bodies = asStrings(definition.bodies);
      if (bodies.length === 0) {
        return unsupported(base, definition, diagnostics, 'Move has no bodies.');
      }
      const feature: MoveFeature = {
        ...base,
        kind: 'move',
        bodies,
        translate: asVec3(definition.translate),
        axis: asVec3(definition.axis),
        angle: asString(definition.angle),
        copy: definition.copy === true,
        raw: definition,
      };
      return feature;
    }
    case 'RemoveFeature':
    case 'DeleteBodyFeature': {
      const bodies = asStrings(definition.bodies);
      const feature: RemoveFeature = {
        ...base,
        kind: 'remove',
        bodies,
        raw: definition,
      };
      return feature;
    }
    case 'ChamferFeature': {
      const distance = asString(definition.distance);
      if (!distance) {
        return unsupported(
          base,
          definition,
          diagnostics,
          'Chamfer is missing a distance.',
        );
      }
      const feature: ChamferFeature = {
        ...base,
        kind: 'chamfer',
        bodies: asStrings(definition.body_names),
        edges: Array.isArray(definition.edges) ? definition.edges : [],
        distance,
        distance2: asString(definition.distance2),
        angle: asString(definition.angle),
        flip: definition.flip === true,
        raw: definition,
      };
      return feature;
    }
    case 'HoleFeature': {
      const position = asVec3(definition.position);
      if (!position) {
        return unsupported(base, definition, diagnostics, 'Hole is missing its position.');
      }
      const holeValue = definition.hole;
      const hole =
        holeValue && typeof holeValue === 'object' && !Array.isArray(holeValue)
          ? (holeValue as Record<string, JsonValue>)
          : {};
      const body = asString(definition.body);
      const feature: HoleFeature = {
        ...base,
        kind: 'hole',
        bodies: body ? [body] : [],
        position,
        direction: asVec3(definition.direction),
        diameter: asString(definition.diameter) ?? asString(definition.thread),
        depth: asString(definition.depth),
        holeType: asString(hole.type) ?? 'simple',
        counterboreDiameter: asString(hole.cb_diameter),
        counterboreDepth: asString(hole.cb_depth),
        countersinkDiameter: asString(hole.cs_diameter),
        countersinkAngle: asString(hole.cs_angle),
        raw: definition,
      };
      return feature;
    }
    case 'FilletFeature': {
      const radius = asString(definition.radius);
      if (!radius) {
        return unsupported(base, definition, diagnostics, 'Fillet is missing its radius.');
      }
      const body = asString(definition.body);
      const feature: FilletFeature = {
        ...base,
        kind: 'fillet',
        bodies: body ? [body] : [],
        edges: Array.isArray(definition.edges) ? definition.edges : [],
        radius,
        filletType: asString(definition.type),
        raw: definition,
      };
      return feature;
    }
    case 'ExtrudeFeature': {
      return unsupported(
        base,
        definition,
        diagnostics,
        'Extrude features need their sketch; use the part extractor.',
      );
    }
    case 'ShellFeature': {
      const thickness = asString(definition.thickness);
      if (!thickness) {
        return unsupported(base, definition, diagnostics, 'Shell is missing its thickness.');
      }
      const body = asString(definition.body);
      const feature: ShellFeature = {
        ...base,
        kind: 'shell',
        bodies: body ? [body] : [],
        faces: Array.isArray(definition.faces) ? definition.faces : [],
        thickness,
        direction: asString(definition.direction),
        raw: definition,
      };
      return feature;
    }
    case 'TorusFeature': {
      const major = asString(definition.major);
      const minor = asString(definition.minor);
      if (!major || !minor) {
        return unsupported(base, definition, diagnostics, 'Torus is missing a radius.');
      }
      const feature: TorusFeature = {
        ...base,
        kind: 'torus',
        bodies: bodyNames(definition),
        major,
        minor,
        center: asVec3(definition.center) ?? ['0', '0', '0'],
        operation: asString(definition.operation) ?? 'new_body',
        targets: asStrings(definition.targets),
        raw: definition,
      };
      return feature;
    }
    case 'MirrorFeature': {
      const bodies = asStrings(definition.bodies);
      const plane = definition.plane;
      let normal: Vec3Expr | undefined;
      let origin: Vec3Expr = ['0', '0', '0'];
      if (plane && typeof plane === 'object' && !Array.isArray(plane)) {
        const p = plane as Record<string, JsonValue>;
        const type = asString(p.type);
        if (type === 'origin') {
          const name = asString(p.name);
          normal = name === 'YZ' ? ['1', '0', '0'] : name === 'XZ' ? ['0', '1', '0'] : name === 'XY' ? ['0', '0', '1'] : undefined;
        } else {
          origin = asVec3(p.origin) ?? origin;
          normal = asVec3(p.normal) ?? undefined;
          if (!normal) {
            const xDir = asVec3(p.x_dir);
            const yDir = asVec3(p.y_dir);
            if (xDir && yDir) {
              const x = xDir.map((v) => Number(v));
              const y = yDir.map((v) => Number(v));
              if (x.every(Number.isFinite) && y.every(Number.isFinite)) {
                normal = [
                  String(x[1] * y[2] - x[2] * y[1]),
                  String(x[2] * y[0] - x[0] * y[2]),
                  String(x[0] * y[1] - x[1] * y[0]),
                ];
              }
            }
          }
        }
      }
      if (!normal) {
        return unsupported(base, definition, diagnostics, 'Mirror plane is not supported.');
      }
      const feature: MirrorFeature = {
        ...base,
        kind: 'mirror',
        bodies,
        combine: definition.combine === true,
        normal,
        origin,
        raw: definition,
      };
      return feature;
    }
    case 'RectangularPatternFeature': {
      const patternValue = definition.pattern;
      const pattern =
        patternValue && typeof patternValue === 'object' && !Array.isArray(patternValue)
          ? (patternValue as Record<string, JsonValue>)
          : {};
      const dir1 = asVec3(pattern.dir1);
      const count1 = asString(pattern.count1);
      const spacing1 = asString(pattern.spacing1);
      if (!dir1 || !count1 || !spacing1) {
        return unsupported(base, definition, diagnostics, 'Rectangular pattern is incomplete.');
      }
      const feature: RectangularPatternFeature = {
        ...base,
        kind: 'pattern_rect',
        bodies: asStrings(definition.bodies),
        dir1,
        count1,
        spacing1,
        dir2: asVec3(pattern.dir2),
        count2: asString(pattern.count2),
        spacing2: asString(pattern.spacing2),
        raw: definition,
      };
      return feature;
    }
    case 'CircularPatternFeature': {
      const patternValue = definition.pattern;
      const pattern =
        patternValue && typeof patternValue === 'object' && !Array.isArray(patternValue)
          ? (patternValue as Record<string, JsonValue>)
          : {};
      const axis = asVec3(pattern.axis);
      const count = asString(pattern.count);
      const angle = asString(pattern.angle) ?? '360';
      if (!axis || !count) {
        return unsupported(base, definition, diagnostics, 'Circular pattern is incomplete.');
      }
      const feature: CircularPatternFeature = {
        ...base,
        kind: 'pattern_circ',
        bodies: asStrings(definition.bodies),
        axis,
        origin: asVec3(pattern.origin) ?? ['0', '0', '0'],
        count,
        angle,
        raw: definition,
      };
      return feature;
    }
    case 'CoilFeature': {
      const diameter = asString(definition.diameter);
      const turns = asString(definition.turns);
      const pitch = asString(definition.pitch);
      const sectionSize = asString(definition.section_size);
      if (!diameter || !turns || !pitch || !sectionSize) {
        return unsupported(base, definition, diagnostics, 'Coil is missing its profile.');
      }
      const feature: CoilFeature = {
        ...base,
        kind: 'coil',
        bodies: bodyNames(definition),
        diameter,
        height: `(${pitch}) * (${turns})`,
        turns,
        sectionSize,
        section: asString(definition.section) ?? 'circular',
        base: asVec3(definition.base) ?? ['0', '0', '0'],
        axis: asVec3(definition.axis) ?? ['0', '0', '1'],
        startAngle: asString(definition.start_angle),
        clockwise: definition.clockwise === true,
        operation: asString(definition.operation) ?? 'new_body',
        targets: asStrings(definition.targets),
        raw: definition,
      };
      return feature;
    }
    case 'BoundingSolidFeature': {
      const targets = asStrings(definition.bodies);
      const bodies = bodyNames(definition);
      if (bodies.length === 0) {
        return unsupported(base, definition, diagnostics, 'Bounding solid has no output body.');
      }
      const feature: BoundingSolidFeature = {
        ...base,
        kind: 'bounding',
        bodies,
        targetBodies: targets,
        margin: asString(definition.margin),
        raw: definition,
      };
      return feature;
    }
    default:
      return unsupported(
        base,
        definition,
        diagnostics,
        `Unsupported feature type: ${detail.type}.`,
      );
  }
}

function unsupported(
  base: { id: number; name: string; type: string },
  definition: Record<string, JsonValue>,
  diagnostics: Diagnostic[],
  reason: string,
): UnsupportedFeature {
  diagnostics.push({
    code: 'E100',
    severity: 'error',
    message: reason,
    featureId: base.id,
    featureName: base.name,
  });
  return {
    ...base,
    kind: 'unsupported',
    bodies: bodyNames(definition),
    reason,
    raw: definition,
  };
}

function uniquePoints(curves: Array<Record<string, JsonValue>>): Array<[number, number]> | null {
  const pairs: Array<[number, number]> = [];
  for (const curve of curves) {
    const start = curve.start_at;
    const end = curve.end_at;
    if (!Array.isArray(start) || !Array.isArray(end) || start.length !== 2 || end.length !== 2) {
      return null;
    }
    const a: [number, number] = [Number(start[0]), Number(start[1])];
    const b: [number, number] = [Number(end[0]), Number(end[1])];
    for (const point of [a, b]) {
      if (!pairs.some(([x, y]) => Math.abs(x - point[0]) < 1e-9 && Math.abs(y - point[1]) < 1e-9)) {
        pairs.push(point);
      }
    }
  }
  if (pairs.length < 3) return null;
  const cx = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const cy = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  return pairs.sort(
    (a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
}

function shapeFromSketch(
  sketch: SketchInspection,
  base: { id: number; name: string; type: string },
  diagnostics: Diagnostic[],
): SketchProfileIR | null {
  const profile = sketch.profiles?.[0];
  if (!profile) {
    diagnostics.push({
      code: 'E130',
      severity: 'error',
      message: 'Sketch has no closed profile.',
      featureId: base.id,
      featureName: base.name,
    });
    return null;
  }
  if ((profile.holes?.length ?? 0) > 0) {
    diagnostics.push({
      code: 'E130',
      severity: 'error',
      message: 'Sketch profiles with holes are not emitted yet.',
      featureId: base.id,
      featureName: base.name,
    });
    return null;
  }
  const byId = new Map(sketch.curves.map((curve) => [curve.id, curve]));
  const selected = profile.curves.map((id) => byId.get(id)).filter(Boolean) as Array<
    Record<string, JsonValue>
  >;
  if (selected.length === 0) {
    diagnostics.push({
      code: 'E130',
      severity: 'error',
      message: 'Sketch profile curves are missing.',
      featureId: base.id,
      featureName: base.name,
    });
    return null;
  }
  if (selected.length === 1 && selected[0].type === 'circle') {
    const center = selected[0].center_at;
    const radius = selected[0].radius;
    if (Array.isArray(center) && center.length === 2 && typeof radius === 'number') {
      return {
        kind: 'circle',
        center: [Number(center[0]), Number(center[1])],
        radius,
      };
    }
  }
  if (selected.every((curve) => curve.type === 'line')) {
    const points = uniquePoints(selected);
    if (points) return { kind: 'polygon', points };
  }
  diagnostics.push({
    code: 'E130',
    severity: 'error',
    message: 'Sketch profiles support straight-line loops and circles only.',
    featureId: base.id,
    featureName: base.name,
  });
  return null;
}

function extractSketch(
  item: { id: number; name: string; type: string },
  sketch: SketchInspection,
  diagnostics: Diagnostic[],
): SketchFeature {
  const base = { id: item.id, name: item.name, type: item.type };
  const profile = shapeFromSketch(sketch, base, diagnostics);
  return {
    ...base,
    kind: 'sketch',
    sketchId: sketch.id,
    plane: {
      origin: sketch.plane.origin.map(String) as Vec3Expr,
      xDir: sketch.plane.x_dir.map(String) as Vec3Expr,
      yDir: sketch.plane.y_dir.map(String) as Vec3Expr,
    },
    profile,
    raw: {},
  };
}

function extractExtrude(
  detail: FeatureInspection,
  sketch: SketchInspection,
  diagnostics: Diagnostic[],
): FeatureIR {
  const base = { id: detail.id, name: detail.name, type: detail.type };
  const definition = detail.definition ?? {};
  const shape = shapeFromSketch(sketch, base, diagnostics);
  if (!shape) {
    return {
      ...base,
      kind: 'unsupported',
      bodies: bodyNamesOf(definition),
      reason: 'Extrude profile is unsupported.',
      raw: definition,
    };
  }

  const extent =
    definition.extent && typeof definition.extent === 'object' && !Array.isArray(definition.extent)
      ? (definition.extent as Record<string, JsonValue>)
      : {};
  const distance = asString(extent.distance);
  if (!distance) {
    return unsupported(base, definition, diagnostics, 'Extrude is missing its distance.');
  }
  const bodyNames = bodyNamesOf(definition);
  const targets = asStrings(definition.targets);
  const feature: ExtrudeFeature = {
    ...base,
    kind: 'extrude',
    bodies: bodyNames,
    sketchId: sketch.id,
    plane: {
      origin: sketch.plane.origin.map(String) as Vec3Expr,
      xDir: sketch.plane.x_dir.map(String) as Vec3Expr,
      yDir: sketch.plane.y_dir.map(String) as Vec3Expr,
    },
    profile: shape,
    distance,
    direction: asString(extent.direction) ?? 'positive',
    operation: asString(definition.operation) ?? 'new_body',
    targets: targets.length > 0 ? targets : asStrings(definition.participants),
    raw: definition,
  };
  return feature;
}

function bodyNamesOf(definition: Record<string, JsonValue>): string[] {
  return asStrings(definition.body_names);
}

function inferPrimitive(
  body: BodyMeasurement,
  id: number,
  diagnostics: Diagnostic[],
): FeatureIR | null {
  const size = [
    body.bbox.max[0] - body.bbox.min[0],
    body.bbox.max[1] - body.bbox.min[1],
    body.bbox.max[2] - body.bbox.min[2],
  ];
  const center = [
    (body.bbox.max[0] + body.bbox.min[0]) / 2,
    (body.bbox.max[1] + body.bbox.min[1]) / 2,
    (body.bbox.max[2] + body.bbox.min[2]) / 2,
  ];
  const faces = body.faces ?? 0;
  const edges = body.edges ?? 0;
  const vertices = body.vertices ?? 0;
  const base = { id, name: `Inferred ${body.name}`, type: 'InferredBody' };
  const uniform = (values: number[], tolerance = 1e-6) =>
    Math.abs(values[0] - values[1]) <= tolerance &&
    Math.abs(values[1] - values[2]) <= tolerance;

  const sphereRadius = size[0] / 2;
  const sphereVolume = (4 / 3) * Math.PI * sphereRadius ** 3;
  const sphereByVolume =
    uniform(size) &&
    Math.abs((body.volume_mm3 ?? 0) - sphereVolume) / Math.max(sphereVolume, 1) < 0.01;
  if (
    (faces === 1 && edges === 0 && vertices === 0 && uniform(size)) ||
    sphereByVolume
  ) {
    return {
      ...base,
      kind: 'sphere',
      bodies: [body.name],
      radius: String(size[0] / 2),
      center: center.map(String) as Vec3Expr,
      operation: 'new_body',
      raw: { inferred: true },
    };
  }
  if (faces === 6 && edges === 12 && vertices === 8) {
    const bboxVolume = size[0] * size[1] * size[2];
    if (bboxVolume > 0 && Math.abs((body.volume_mm3 ?? 0) - bboxVolume) / bboxVolume < 1e-6) {
      return {
        ...base,
        kind: 'box',
        bodies: [body.name],
        length: String(size[0]),
        width: String(size[1]),
        height: String(size[2]),
        corner: body.bbox.min.map(String) as Vec3Expr,
        operation: 'new_body',
        raw: { inferred: true },
      };
    }
  }
  if (faces === 3 && edges === 2 && vertices === 0) {
    const equal = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 1e-6;
    let axis = -1;
    if (equal(size[0], size[1])) axis = 2;
    else if (equal(size[0], size[2])) axis = 1;
    else if (equal(size[1], size[2])) axis = 0;
    if (axis !== -1) {
      const height = size[axis];
      const radius = size[(axis + 1) % 3] / 2;
      const basePoint = [...center];
      basePoint[axis] = body.bbox.min[axis];
      const axisVector: Vec3Expr = ['0', '0', '0'];
      axisVector[axis] = '1';
      return {
        ...base,
        kind: 'cylinder',
        bodies: [body.name],
        radius: String(radius),
        height: String(height),
        base: basePoint.map(String) as Vec3Expr,
        axis: axisVector,
        operation: 'new_body',
        raw: { inferred: true },
      };
    }
  }
  diagnostics.push({
    code: 'W132',
    severity: 'warning',
    message: `Body ${body.name} is inside a component but is not a recognized primitive; it was not translated.`,
  });
  return null;
}


async function extractComponentFeatures(
  rootFeatureNames: Set<string>,
  diagnostics: Diagnostic[],
): Promise<FeatureIR[]> {
  const components = await listComponents().catch(() => ({
    active: 0,
    components: [] as ComponentList['components'],
  }));
  const extracted: FeatureIR[] = [];
  const seen = new Set<string>();
  for (const component of components.components ?? []) {
    if (component.id === 0) continue;
    for (const name of component.features ?? []) {
      if (rootFeatureNames.has(name) || seen.has(name)) continue;
      seen.add(name);
      const detail = await inspectFeatureByName(name).catch(() => null);
      if (!detail) {
        diagnostics.push({
          code: 'W133',
          severity: 'warning',
          message: `Component feature ${name} could not be inspected.`,
        });
        continue;
      }
      if (detail.suppressed || detail.rolled_back) continue;
      if (detail.type === 'Sketch' || detail.type === 'BodyTransferFeature') continue;
      if (detail.type === 'CombineFeature') continue;
      if (detail.type === 'ExtrudeFeature') {
        const sketchId = Number(detail.definition?.sketch);
        const sketch = await inspectSketch(sketchId);
        extracted.push(extractExtrude(detail, sketch, diagnostics));
        continue;
      }
      extracted.push(extractFeature(detail, diagnostics));
    }
  }
  return extracted;
}


export async function extractPart(
  inspection: DesignInspection,
  options: { includeSuppressed?: boolean } = {},
): Promise<PartIR> {
  const diagnostics: Diagnostic[] = [];
  const features: FeatureIR[] = [];

  // Inspect everything first: a suppressed tool body can still be referenced by a
  // later combine, so its creating feature has to stay in the emitted timeline.
  const details = new Map<number, FeatureInspection>();
  for (const item of inspection.timeline) {
    if (item.rolled_back) continue;
    details.set(item.id, await inspectFeature(item.id));
  }
  const referenced = new Set<string>();
  for (const detail of details.values()) {
    const definition = detail.definition ?? {};
    // Every feature that names an existing body makes that body a dependency.
    const references = [
      ...asStrings(definition.bodies),
      ...asStrings(definition.tools),
      ...asStrings(definition.participants),
      ...asStrings(definition.targets),
    ];
    const body = asString(definition.body);
    if (body) references.push(body);
    const target = asString(definition.target);
    if (target) references.push(target);
    for (const name of references) referenced.add(name);
  }

  for (const item of inspection.timeline) {
    const detail = details.get(item.id);
    if (!detail) continue;
    if (item.rolled_back) {
      diagnostics.push({
        code: 'W131',
        severity: 'warning',
        message: `Skipped rolled-back feature ${item.name} (${item.type}); bodies: ${bodyNamesOf(detail.definition ?? {}).join(', ') || 'none'}.`,
        featureId: item.id,
        featureName: item.name,
      });
      continue;
    }
    if (item.type === 'BodyTransferFeature') continue;
    if (item.suppressed && !options.includeSuppressed) {
      const bodies = bodyNamesOf(detail.definition ?? {});
      const needed = bodies.some((name) => referenced.has(name));
      if (!needed) {
        diagnostics.push({
          code: 'W131',
          severity: 'warning',
          message: `Skipped suppressed feature ${item.name} (${item.type}); bodies: ${bodies.join(', ') || 'none'}.`,
          featureId: item.id,
          featureName: item.name,
        });
        continue;
      }
    }
    if (item.error) {
      diagnostics.push({
        code: 'E101',
        severity: 'error',
        message: `Feature failed in SolidCraft: ${item.error}`,
        featureId: item.id,
        featureName: item.name,
      });
    }
    if (item.type === 'Sketch') {
      const sketch = await inspectSketch(item.id);
      features.push(extractSketch(item, sketch, diagnostics));
      continue;
    }
    if (detail.type === 'ExtrudeFeature') {
      const sketchId = Number(detail.definition?.sketch);
      const sketch = await inspectSketch(sketchId);
      features.push(extractExtrude(detail, sketch, diagnostics));
      continue;
    }
    features.push(extractFeature(detail, diagnostics));
  }

  const rootCreators = new Set([
    'box',
    'cylinder',
    'sphere',
    'extrude',
    'torus',
    'coil',
    'bounding',
  ]);
  const rootCreated = new Set<string>();
  for (const feature of features) {
    if (rootCreators.has(feature.kind) && 'bodies' in feature) {
      for (const name of feature.bodies) rootCreated.add(name);
    }
  }
  const missingReferenced = [...referenced].filter((name) => !rootCreated.has(name));
  if (missingReferenced.length > 0) {
    const componentFeatures = await extractComponentFeatures(
      new Set(features.map((feature) => feature.name)),
      diagnostics,
    );
    if (componentFeatures.length > 0) {
      features.unshift(...componentFeatures);
    }
  }
  const creatorKinds = new Set([
    'box',
    'cylinder',
    'sphere',
    'extrude',
    'torus',
    'coil',
    'bounding',
  ]);
  const created = new Set<string>();
  for (const feature of features) {
    if (creatorKinds.has(feature.kind) && 'bodies' in feature) {
      for (const name of feature.bodies) created.add(name);
    }
  }
  const componentList = await listComponents().catch(() => ({ components: [] }));
  const candidates = new Set<string>(referenced);
  for (const body of inspection.bodies) candidates.add(body.name);
  for (const component of componentList.components ?? []) {
    if (component.id === 0) continue;
    for (const body of component.bodies ?? []) candidates.add(body);
  }
  const properties = await execute<{ bodies?: Array<{ name: string }> }>(
    'component.properties',
    {},
  ).catch(() => null);
  for (const body of properties?.bodies ?? []) candidates.add(body.name);
  const measurements = new Map<string, BodyMeasurement>();
  for (const body of inspection.bodies) measurements.set(body.name, body);
  const escaped = [...rootCreated].map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  );
  const copyPattern =
    escaped.length > 0
      ? new RegExp(`^(?:${escaped.join('|')}) \\(\\d+\\)$`)
      : null;
  const missingNames = [...candidates].filter(
    (name) => !created.has(name) && (!copyPattern || !copyPattern.test(name)),
  );
  const needMeasure = missingNames.filter((name) => !measurements.has(name));
  if (needMeasure.length > 0) {
    const measured = await measureBodies(needMeasure).catch(() => []);
    for (const body of measured) measurements.set(body.name, body);
  }
  const inferredBodies: string[] = [];
  let inferredId = -1;
  for (const name of missingNames) {
    const body = measurements.get(name);
    if (!body) {
      diagnostics.push({
        code: 'W134',
        severity: 'warning',
        message: `Body ${name} is referenced but has no accessible measurement; it was not translated.`,
      });
      continue;
    }
    const feature = inferPrimitive(body, inferredId, diagnostics);
    if (feature) {
      inferredId -= 1;
      features.unshift(feature);
      inferredBodies.push(name);
    }
  }
  for (const body of measurements.values()) {
    if (!inspection.bodies.some((existing) => existing.name === body.name)) {
      inspection.bodies.push(body);
    }
  }
  return {
    schemaVersion: '0.1',
    name: inspection.name ?? 'part',
    units: inspection.units ?? 'mm',
    parameters: extractParameters(inspection),
    features,
    bodies: inspection.bodies.map((body) => body.name),
    revision: inspection.revision,
    bodyBounds: Object.fromEntries(
      inspection.bodies.map((body) => [body.name, body.bbox]),
    ),
    inferredBodies,
    diagnostics,
  };
}
