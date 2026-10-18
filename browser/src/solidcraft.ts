import type {
  BodyMeasurement,
  ComponentList,
  DesignInspection,
  FeatureInspection,
  SketchInspection,
  SolidCraftApi,
} from './types';

export class SolidCraftError extends Error {}

export function getApi(): SolidCraftApi {
  const api = window.solidcraft;
  if (!api) {
    throw new SolidCraftError(
      'window.solidcraft is not available. Open this page inside the SolidCraft web app.',
    );
  }
  return api;
}

export async function waitForApi(timeoutMs = 30_000): Promise<SolidCraftApi> {
  const started = Date.now();
  while (!window.solidcraft) {
    if (Date.now() - started > timeoutMs) {
      throw new SolidCraftError('Timed out waiting for window.solidcraft.');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return window.solidcraft;
}

export async function inspectDesign(measure = true): Promise<DesignInspection> {
  return getApi().inspect({ measure });
}

export async function listComponents(): Promise<ComponentList> {
  return (await getApi().execute('component.list', {
    bodies: true,
  })) as ComponentList;
}

export async function measureBodies(names: string[]): Promise<BodyMeasurement[]> {
  const result = (await getApi().execute('inspect.measure', {
    bodies: names,
  })) as { bodies?: BodyMeasurement[] };
  return result.bodies ?? [];
}

export async function inspectFeatureByName(name: string): Promise<FeatureInspection> {
  return (await getApi().execute('timeline.inspect', {
    feature: name,
  })) as FeatureInspection;
}

export async function inspectSketch(id: number): Promise<SketchInspection> {
  return (await getApi().execute('sketch.inspect', {
    sketch: id,
  })) as SketchInspection;
}

export async function inspectFeature(id: number): Promise<FeatureInspection> {
  return (await getApi().execute('timeline.inspect', {
    feature: id,
  })) as FeatureInspection;
}

export async function execute<T = unknown>(
  command: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return (await getApi().execute(command, params)) as T;
}

export async function batch(
  commands: Array<{ command: string; params?: Record<string, unknown> }>,
): Promise<unknown> {
  const result = (await getApi().request('engine.batch', { commands })) as {
    failed?: { index: number; command: string; error: string };
  };
  if (result.failed) {
    throw new SolidCraftError(
      `Batch step ${result.failed.index + 1} (${result.failed.command}) failed: ${result.failed.error}`,
    );
  }
  return result;
}

export async function commandIds(): Promise<Set<string>> {
  const commands = await getApi().commands();
  return new Set(commands.map((command) => command.id));
}
