export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ParamInfo {
  name: string;
  expression: string;
  unit: string;
  value?: number;
  comment?: string;
  model?: boolean;
  error?: string | null;
}

export interface TimelineItem {
  id: number;
  name: string;
  type: string;
  suppressed: boolean;
  rolled_back: boolean;
  error: string | null;
  warning: string | null;
}

export interface BodyMeasurement {
  name: string;
  visible?: boolean;
  volume_mm3: number;
  area_mm2: number;
  center_of_mass: [number, number, number];
  bbox: { min: [number, number, number]; max: [number, number, number] };
  faces?: number;
  edges?: number;
  vertices?: number;
  face_types?: Record<string, number>;
}

export interface DesignInspection {
  name?: string;
  path?: string | null;
  revision?: number;
  units?: string;
  metadata?: Record<string, JsonValue>;
  params: ParamInfo[];
  timeline: TimelineItem[];
  bodies: BodyMeasurement[];
  sketches?: unknown[];
  total?: Partial<BodyMeasurement>;
}

export interface FeatureInspection {
  id: number;
  name: string;
  type: string;
  definition: Record<string, JsonValue>;
  inputs?: Array<{
    label: string;
    param: string;
    expression: string;
    unit: string;
  }>;
  omitted?: string[];
  suppressed?: boolean;
  rolled_back?: boolean;
  error?: string | null;
  warning?: string | null;
}

export interface SketchInspection {
  id: number;
  name: string;
  plane: {
    origin: [number, number, number];
    x_dir: [number, number, number];
    y_dir: [number, number, number];
  };
  curves: Array<Record<string, JsonValue>>;
  points?: Array<Record<string, JsonValue>>;
  profiles?: Array<{
    index: number;
    curves: string[];
    holes?: string[][];
    area_mm2?: number;
  }>;
  status?: string;
}

export interface ComponentBody {
  name: string;
  component?: number;
  path?: number[];
}

export interface ComponentList {
  active?: number;
  components?: Array<{
    id: number;
    name: string;
    parent: number | null;
    bodies?: string[];
    children?: Array<{ component: number; id: number; name: string }>;
  }>;
}

export interface CommandInfo {
  id: string;
  label: string;
  enabled?: boolean;
  params?: string;
}

export interface SolidCraftApi {
  request(method: string, params?: unknown): Promise<unknown>;
  execute(command: string, params?: unknown): Promise<unknown>;
  commands(): Promise<CommandInfo[]>;
  inspect(params?: { measure?: boolean }): Promise<DesignInspection>;
}

declare global {
  interface Window {
    solidcraft?: SolidCraftApi;
  }
}
