import type {
  DesignInspection,
  FeatureInspection,
  JsonValue,
  SketchInspection,
} from './types';
import { inspectFeature, inspectSketch } from './solidcraft';
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
    if (detail.type === 'CombineFeature') {
      const target = asString(definition.target);
      if (target) referenced.add(target);
      for (const tool of asStrings(definition.tools)) referenced.add(tool);
    } else {
      const operation = asString(definition.operation);
      if (operation === 'join' || operation === 'cut' || operation === 'intersect') {
        for (const target of asStrings(definition.participants)) referenced.add(target);
        for (const target of asStrings(definition.targets)) referenced.add(target);
      }
    }
  }

  for (const item of inspection.timeline) {
    if (item.rolled_back) continue;
    const detail = details.get(item.id);
    if (!detail) continue;
    if (item.suppressed && !options.includeSuppressed) {
      const bodies = bodyNamesOf(detail.definition ?? {});
      const needed = bodies.some((name) => referenced.has(name));
      if (!needed) continue;
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

  return {
    schemaVersion: '0.1',
    name: inspection.name ?? 'part',
    units: inspection.units ?? 'mm',
    parameters: extractParameters(inspection),
    features,
    bodies: inspection.bodies.map((body) => body.name),
    revision: inspection.revision,
    diagnostics,
  };
}
