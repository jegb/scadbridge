export type Expr = string;
export type Vec3Expr = [Expr, Expr, Expr];

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  code: string;
  severity: Severity;
  message: string;
  featureId?: number;
  featureName?: string;
}

export interface ParamIR {
  name: string;
  expression: string;
  unit: string;
  value?: number;
  comment?: string;
  model?: boolean;
}

interface FeatureBase {
  id: number;
  name: string;
  type: string;
}

export interface BoxFeature extends FeatureBase {
  kind: 'box';
  bodies: string[];
  length: Expr;
  width: Expr;
  height: Expr;
  corner?: Vec3Expr;
  center?: Vec3Expr;
  operation: string;
  targets?: string[];
  raw: Record<string, unknown>;
}

export interface CylinderFeature extends FeatureBase {
  kind: 'cylinder';
  bodies: string[];
  radius?: Expr;
  diameter?: Expr;
  height: Expr;
  base?: Vec3Expr;
  axis?: Vec3Expr;
  operation: string;
  targets?: string[];
  raw: Record<string, unknown>;
}

export interface SphereFeature extends FeatureBase {
  kind: 'sphere';
  bodies: string[];
  radius?: Expr;
  diameter?: Expr;
  center?: Vec3Expr;
  operation: string;
  targets?: string[];
  raw: Record<string, unknown>;
}

export interface CombineFeature extends FeatureBase {
  kind: 'combine';
  target: string;
  tools: string[];
  operation: 'join' | 'cut' | 'intersect';
  keepTools: boolean;
  raw: Record<string, unknown>;
}

export interface MoveFeature extends FeatureBase {
  kind: 'move';
  bodies: string[];
  translate?: Vec3Expr;
  axis?: Vec3Expr;
  angle?: Expr;
  copy: boolean;
  raw: Record<string, unknown>;
}

export interface RemoveFeature extends FeatureBase {
  kind: 'remove';
  bodies: string[];
  raw: Record<string, unknown>;
}

export interface ChamferFeature extends FeatureBase {
  kind: 'chamfer';
  bodies: string[];
  edges: unknown[];
  distance: Expr;
  distance2?: Expr;
  angle?: Expr;
  flip?: boolean;
  raw: Record<string, unknown>;
}

export interface HoleFeature extends FeatureBase {
  kind: 'hole';
  bodies: string[];
  position: Vec3Expr;
  direction?: Vec3Expr;
  diameter?: Expr;
  depth?: Expr;
  holeType: string;
  counterboreDiameter?: Expr;
  counterboreDepth?: Expr;
  countersinkDiameter?: Expr;
  countersinkAngle?: Expr;
  raw: Record<string, unknown>;
}

export interface FilletFeature extends FeatureBase {
  kind: 'fillet';
  bodies: string[];
  edges: unknown[];
  radius: Expr;
  filletType?: string;
  raw: Record<string, unknown>;
}

export interface ShellFeature extends FeatureBase {
  kind: 'shell';
  bodies: string[];
  faces: unknown[];
  thickness: Expr;
  direction?: string;
  raw: Record<string, unknown>;
}

export type SketchProfileIR =
  | {
      kind: 'circle';
      center: [number, number];
      radius: number;
    }
  | {
      kind: 'polygon';
      points: Array<[number, number]>;
    };

export interface SketchFeature extends FeatureBase {
  kind: 'sketch';
  sketchId: number;
  plane: {
    origin: Vec3Expr;
    xDir: Vec3Expr;
    yDir: Vec3Expr;
  };
  profile: SketchProfileIR | null;
  raw: Record<string, unknown>;
}

export interface ExtrudeFeature extends FeatureBase {
  kind: 'extrude';
  bodies: string[];
  sketchId: number;
  plane: {
    origin: Vec3Expr;
    xDir: Vec3Expr;
    yDir: Vec3Expr;
  };
  profile: SketchProfileIR;
  distance: Expr;
  direction: string;
  operation: string;
  targets?: string[];
  raw: Record<string, unknown>;
}

export interface TorusFeature extends FeatureBase {
  kind: 'torus';
  bodies: string[];
  major: Expr;
  minor: Expr;
  center: Vec3Expr;
  operation: string;
  targets?: string[];
  raw: Record<string, unknown>;
}

export interface MirrorFeature extends FeatureBase {
  kind: 'mirror';
  bodies: string[];
  combine: boolean;
  normal: Vec3Expr;
  origin: Vec3Expr;
  raw: Record<string, unknown>;
}

export interface RectangularPatternFeature extends FeatureBase {
  kind: 'pattern_rect';
  bodies: string[];
  dir1: Vec3Expr;
  count1: Expr;
  spacing1: Expr;
  dir2?: Vec3Expr;
  count2?: Expr;
  spacing2?: Expr;
  raw: Record<string, unknown>;
}

export interface CircularPatternFeature extends FeatureBase {
  kind: 'pattern_circ';
  bodies: string[];
  axis: Vec3Expr;
  origin: Vec3Expr;
  count: Expr;
  angle: Expr;
  raw: Record<string, unknown>;
}

export interface CoilFeature extends FeatureBase {
  kind: 'coil';
  bodies: string[];
  diameter: Expr;
  height: Expr;
  turns: Expr;
  sectionSize: Expr;
  section: string;
  base: Vec3Expr;
  axis: Vec3Expr;
  startAngle?: Expr;
  clockwise: boolean;
  operation: string;
  targets?: string[];
  raw: Record<string, unknown>;
}

export interface BoundingSolidFeature extends FeatureBase {
  kind: 'bounding';
  bodies: string[];
  targetBodies: string[];
  margin?: Expr;
  raw: Record<string, unknown>;
}

export interface UnsupportedFeature extends FeatureBase {
  kind: 'unsupported';
  bodies: string[];
  reason: string;
  raw: Record<string, unknown>;
}

export type FeatureIR =
  | BoxFeature
  | CylinderFeature
  | SphereFeature
  | CombineFeature
  | MoveFeature
  | RemoveFeature
  | ChamferFeature
  | HoleFeature
  | FilletFeature
  | ShellFeature
  | SketchFeature
  | ExtrudeFeature
  | TorusFeature
  | MirrorFeature
  | RectangularPatternFeature
  | CircularPatternFeature
  | CoilFeature
  | BoundingSolidFeature
  | UnsupportedFeature;

export interface PartIR {
  schemaVersion: '0.1';
  name: string;
  units: string;
  parameters: ParamIR[];
  features: FeatureIR[];
  bodies: string[];
  revision?: number;
  bodyBounds?: Record<string, { min: [number, number, number]; max: [number, number, number] }>;
  diagnostics: Diagnostic[];
}

export function isPrimitive(
  feature: FeatureIR,
): feature is BoxFeature | CylinderFeature | SphereFeature {
  return (
    feature.kind === 'box' ||
    feature.kind === 'cylinder' ||
    feature.kind === 'sphere'
  );
}
