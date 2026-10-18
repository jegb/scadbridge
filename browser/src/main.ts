import { waitForApi, getApi } from './solidcraft';
import { mountPanel } from './ui';
import {
  compileCurrentDesign,
  createTestCube,

  validateCurrentDesign,
} from './demo';
import { extractPart } from './extract';
import { renderScad } from './validate';
import { downloadText } from './download';
import { exportScad, openScadSource, updateScad, type OpenScadResult } from './import';
import { emitScad } from './scad';
import { inspectDesign } from './solidcraft';
import type { DesignInspection } from './types';

declare global {
  interface Window {
    scadbridgeOpenFile?: (source: string, name: string) => void;
    scadbridgeExportScad?: () => void;
    scadbridge?: {
      inspect(): Promise<DesignInspection>;
      compile(): Promise<Awaited<ReturnType<typeof compileCurrentDesign>>>;
      validate(): Promise<Awaited<ReturnType<typeof validateCurrentDesign>>>;
      createTestCube(): Promise<void>;
      download(code: string, name?: string): void;
      openScad(source: string, name?: string): Promise<OpenScadResult>;
      exportScad(): Promise<void>;
      update(): Promise<{ name: string; wrote: boolean; cancelled?: boolean }>;
      render(code: string): Promise<Awaited<ReturnType<typeof renderScad>>>;
      api: typeof getApi;
    };
  }
}

async function boot(): Promise<void> {
  if (document.getElementById('scadbridge-panel')) return;
  const panel = mountPanel();

  window.scadbridgeOpenFile = (source: string, name: string) => {
    void panel.openFile(source, name);
  };
  window.scadbridgeExportScad = () => {
    void exportScad().catch((error) => {
      panel.log(`Export SCAD failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };

  window.scadbridge = {
    inspect: () => inspectDesign(true),
    compile: () => compileCurrentDesign(),
    validate: () => validateCurrentDesign(),
    createTestCube,
    download: downloadText,
    openScad: openScadSource,
    exportScad,
    update: updateScad,
    render: renderScad,
    api: getApi,
  };

  try {
    const api = await waitForApi(15_000);
    panel.setStatus(true);
    const commands = await api.commands();
    const ids = new Set(commands.map((command) => command.id));
    const required = [
      'solid.box',
      'solid.cylinder',
      'solid.sphere',
      'solid.combine',
      'solid.move',
      'timeline.inspect',
      'parameters.add',
      'parameters.change',
      'model.edges',
    ];
    const missing = required.filter((id) => !ids.has(id));
    if (missing.length) {
      panel.log(`Compatibility warning: missing commands ${missing.join(', ')}`);
    } else {
      panel.log(
        `Connected to SolidCraft. ${commands.length} commands available; required command surface present.`,
      );
    }
  } catch (error) {
    panel.setStatus(false);
    panel.log(
      `SolidCraft API unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

void boot();

export {
  compileCurrentDesign,
  createTestCube,
  emitScad,
  extractPart,
  inspectDesign,
  validateCurrentDesign,
};
