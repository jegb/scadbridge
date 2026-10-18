import { batch, execute, inspectDesign } from './solidcraft';
import { showDesign } from './view';
import { extractPart } from './extract';
import { emitScad, type ScadResult } from './scad';
import { validateScad, type ValidationReport } from './validate';
import type { PartIR } from './ir';
import type { DesignInspection } from './types';

export async function newDesign(): Promise<void> {
  await execute('file.new');
}

export async function createTestCube(): Promise<void> {
  await newDesign();
  await batch([
    {
      command: 'parameters.add',
      params: { name: 'size', expression: '20', unit: 'mm' },
    },
    {
      command: 'parameters.add',
      params: { name: 'hole', expression: '6', unit: 'mm' },
    },
    {
      command: 'solid.box',
      params: {
        length: 'size',
        width: 'size',
        height: 'size',
        center: [0, 0, 0],
        body_name: 'cube',
      },
    },
    {
      command: 'solid.cylinder',
      params: {
        diameter: 'hole',
        height: 'size + 2',
        base: [0, 0, '-(size/2) - 1'],
        body_name: 'hole_cut',
      },
    },
    {
      command: 'solid.combine',
      params: { target: 'cube', tools: ['hole_cut'], operation: 'cut' },
    },
  ]);
  await showDesign();
}

export interface CompileResult {
  inspection: DesignInspection;
  part: PartIR;
  scad: ScadResult;
}

export async function compileCurrentDesign(): Promise<CompileResult> {
  const inspection = await inspectDesign(true);
  const part = await extractPart(inspection);
  const scad = emitScad(part);
  return { inspection, part, scad };
}

export async function validateCurrentDesign(): Promise<
  CompileResult & { validation: ValidationReport }
> {
  const compiled = await compileCurrentDesign();
  const validation = await validateScad(
    compiled.scad.code,
    compiled.inspection,
    compiled.scad.diagnostics,
  );
  return { ...compiled, validation };
}
