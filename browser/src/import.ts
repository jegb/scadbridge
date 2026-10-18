import { batch, execute } from './solidcraft';
import { showDesign } from './view';
import { compileCurrentDesign } from './demo';
import { downloadText } from './download';
import { planScadImport, type ImportPlan } from './scad_import';

export interface OpenScadResult {
  plan: ImportPlan;
  applied: boolean;
}

let current: { name: string; source: string; plan: ImportPlan } | null = null;

/**
 * Open a SCAD file in SolidCraft by rebuilding its supported primitives and
 * booleans as a parametric feature timeline. Unsupported syntax is rejected.
 */
export async function openScadSource(
  source: string,
  name = 'model.scad',
): Promise<OpenScadResult> {
  const plan = planScadImport(source, name);
  if (!plan.ok) return { plan, applied: false };

  await execute('file.new');
  if (plan.commands.length > 0) {
    await batch(plan.commands);
  }
  current = { name, source, plan };
  await showDesign();
  return { plan, applied: true };
}

export function currentScadFile(): { name: string; source: string } | null {
  return current ? { name: current.name, source: current.source } : null;
}

declare global {
  interface Window {
    scadbridgeFileHandle?: FileSystemFileHandle;
    scadbridgeExportScad?: () => void;
  }
}

export async function exportScad(): Promise<void> {
  const compiled = await compileCurrentDesign();
  if (compiled.scad.bodies.length === 0) {
    throw new Error('No geometry to export. Open a SCAD file or add a body.');
  }
  const errors = compiled.scad.diagnostics.filter((item) => item.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `SCAD compilation failed: ${errors[0].code} ${errors[0].message} (${errors.length} error(s)); export refused.`,
    );
  }
  downloadText(compiled.scad.code, current?.name ?? 'part.scad');
}

export async function updateScad(): Promise<{ name: string; wrote: boolean; cancelled?: boolean }> {
  const compiled = await compileCurrentDesign();
  if (compiled.scad.bodies.length === 0) {
    throw new Error('No geometry to update. Open a SCAD file or add a body.');
  }
  const errors = compiled.scad.diagnostics.filter((item) => item.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `SCAD compilation failed: ${errors[0].code} ${errors[0].message} (${errors.length} error(s)); update refused.`,
    );
  }
  const name = current?.name ?? 'part.scad';
  const handle = window.scadbridgeFileHandle;
  if (handle) {
    try {
      const writable = await handle.createWritable();
      await writable.write(compiled.scad.code);
      await writable.close();
      if (current) current.source = compiled.scad.code;
      return { name, wrote: true };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { name, wrote: false, cancelled: true };
      }
      // The handle may have lost its permission. Ask for a file instead.
    }
  }
  const picker = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName?: string;
        types?: Array<{ description?: string; accept: Record<string, string[]> }>;
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (picker) {
    try {
      const picked = await picker({
        suggestedName: name,
        types: [
          {
            description: 'OpenSCAD source',
            accept: { 'text/plain': ['.scad'] },
          },
        ],
      });
      const writable = await picked.createWritable();
      await writable.write(compiled.scad.code);
      await writable.close();
      // Remember the chosen file so the next Update writes silently.
      window.scadbridgeFileHandle = picked;
      if (current) {
        current.source = compiled.scad.code;
        current.name = picked.name;
      }
      return { name: picked.name, wrote: true };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { name, wrote: false, cancelled: true };
      }
      throw error;
    }
  }
  downloadText(compiled.scad.code, name);
  return { name, wrote: false };
}
