import { describe, expect, it } from 'vitest';
import type { PartIR } from './ir';
import { emitScad, sanitizeExpression } from './scad';
import { parseAsciiStl } from './validate';

function testCube(): PartIR {
  return {
    schemaVersion: '0.1',
    name: 'test_cube',
    units: 'mm',
    revision: 1,
    parameters: [
      { name: 'size', expression: '20', unit: 'mm' },
      { name: 'hole', expression: '6', unit: 'mm' },
    ],
    features: [
      {
        id: 1,
        name: 'Box1',
        type: 'BoxFeature',
        kind: 'box',
        bodies: ['cube'],
        length: 'size',
        width: 'size',
        height: 'size',
        corner: ['(0 mm) - (size) / 2', '(0 mm) - (size) / 2', '(0 mm) - (size) / 2'],
        operation: 'new_body',
        raw: {},
      },
      {
        id: 2,
        name: 'Cylinder1',
        type: 'CylinderFeature',
        kind: 'cylinder',
        bodies: ['hole_cut'],
        radius: '(hole) / 2',
        height: 'size + 2',
        base: ['0', '0', '-(size/2) - 1'],
        axis: ['0', '0', '1'],
        operation: 'new_body',
        raw: {},
      },
      {
        id: 3,
        name: 'Combine1',
        type: 'CombineFeature',
        kind: 'combine',
        target: 'cube',
        tools: ['hole_cut'],
        operation: 'cut',
        keepTools: false,
        raw: {},
      },
    ],
    bodies: ['cube'],
    diagnostics: [],
  };
}

describe('sanitizeExpression', () => {
  it('removes SolidCraft unit suffixes', () => {
    expect(sanitizeExpression('(0 mm) - (size) / 2')).toBe('(0) - (size) / 2');
    expect(sanitizeExpression('2 mm + 30 deg')).toBe('2 + 30');
  });
});

describe('emitScad', () => {
  it('emits a difference of a box and a cylinder', () => {
    const result = emitScad(testCube());
    expect(result.bodies).toEqual(['cube']);
    expect(result.code).toContain('difference()');
    expect(result.code).toContain('cube([size, size, size], center = false);');
    expect(result.code).toContain('cylinder(h = size + 2, r = (hole) / 2');
    expect(result.code).toContain('$fn = 128;');
    expect(result.diagnostics).toEqual([]);
  });

  it('is deterministic', () => {
    const first = emitScad(testCube()).code;
    const second = emitScad(testCube()).code;
    expect(first).toBe(second);
  });

  it('reports unsupported chamfer targets', () => {
    const part = testCube();
    part.features.push({
      id: 4,
      name: 'Chamfer1',
      type: 'ChamferFeature',
      kind: 'chamfer',
      bodies: ['cube'],
      edges: [],
      distance: '2',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.some((item) => item.code === 'E121')).toBe(true);
  });

  it('applies parameter overrides', () => {
    const result = emitScad(testCube(), { overrides: { size: '30' } });
    expect(result.code).toContain('size = 30;');
  });
});

describe('parseAsciiStl', () => {
  it('computes triangle area', () => {
    const stl = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid test`;
    const metrics = parseAsciiStl(stl);
    expect(metrics.area).toBeCloseTo(0.5, 9);
    expect(metrics.volume).toBeCloseTo(0, 9);
    expect(metrics.triangles).toBe(1);
  });
});

describe('chamfer emission', () => {
  it('subtracts a polyhedron cutter for a box edge', () => {
    const part: PartIR = {
      schemaVersion: '0.1',
      name: 'chamfered_cube',
      units: 'mm',
      revision: 1,
      parameters: [
        { name: 'size', expression: '20', unit: 'mm', value: 20 },
        { name: 'cham', expression: '2', unit: 'mm', value: 2 },
      ],
      features: [
        {
          id: 1,
          name: 'Box1',
          type: 'BoxFeature',
          kind: 'box',
          bodies: ['cube'],
          length: 'size',
          width: 'size',
          height: 'size',
          corner: ['(0 mm) - (size) / 2', '(0 mm) - (size) / 2', '(0 mm) - (size) / 2'],
          operation: 'new_body',
          raw: {},
        },
        {
          id: 2,
          name: 'Chamfer1',
          type: 'ChamferFeature',
          kind: 'chamfer',
          bodies: ['cube'],
          edges: [[0, 10, -10]],
          distance: 'cham',
          raw: { body: 'cube' },
        },
      ],
      bodies: ['cube'],
      diagnostics: [],
    };
    const result = emitScad(part);
    expect(result.diagnostics.some((item) => item.code === 'E121')).toBe(false);
    expect(result.code).toContain('difference()');
    expect(result.code).toContain('linear_extrude');
    expect(result.code).toContain('multmatrix');
  });
});

function plainBox(): PartIR {
  return {
    schemaVersion: '0.1',
    name: 'box',
    units: 'mm',
    revision: 1,
    parameters: [],
    features: [
      {
        id: 1,
        name: 'Box1',
        type: 'BoxFeature',
        kind: 'box',
        bodies: ['box'],
        length: '20',
        width: '20',
        height: '20',
        corner: ['0', '0', '0'],
        operation: 'new_body',
        raw: {},
      },
    ],
    bodies: ['box'],
    diagnostics: [],
  };
}

describe('M3 operations', () => {
  it('emits a through hole', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Hole1',
      type: 'HoleFeature',
      kind: 'hole',
      bodies: [],
      position: ['10', '10', '20'],
      direction: ['0', '0', '-1'],
      diameter: '5',
      holeType: 'simple',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('difference()');
    expect(result.code).toContain('rotate([180, 0, 0])');
    expect(result.code).toContain('cylinder(h =');
  });

  it('emits a counterbore cutter', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Hole1',
      type: 'HoleFeature',
      kind: 'hole',
      bodies: [],
      position: ['10', '10', '20'],
      diameter: '5',
      holeType: 'counterbore',
      counterboreDiameter: '10',
      counterboreDepth: '3',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect((result.code.match(/cylinder\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('emits a constant-radius box fillet', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Fillet1',
      type: 'FilletFeature',
      kind: 'fillet',
      bodies: ['box'],
      edges: [[0, 10, 0]],
      radius: '2',
      filletType: 'constant',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('difference()');
    expect(result.code).toContain('cube([');
    expect(result.code).toContain('rotate([-90, 0, 0])');
  });

  it('emits a shell with an open face', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Shell1',
      type: 'ShellFeature',
      kind: 'shell',
      bodies: ['box'],
      faces: [[20, 10, 10]],
      thickness: '2',
      direction: 'inside',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('difference()');
    expect(result.code).toContain('cube([');
  });

  it('supports a primitive cut with participants', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Cylinder1',
      type: 'CylinderFeature',
      kind: 'cylinder',
      bodies: ['cutter'],
      radius: '3',
      height: '30',
      base: ['10', '10', '-5'],
      operation: 'cut',
      targets: ['box'],
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('difference()');
    expect(result.code).toContain('cylinder(h = 30');
  });
});

describe('chamfer edge orientation', () => {
  it('emits a cutter for every box edge', () => {
    const edges: number[][] = [
      [10, 0, 0], [10, 20, 0], [10, 0, 20], [10, 20, 20],
      [0, 10, 0], [20, 10, 0], [0, 10, 20], [20, 10, 20],
      [0, 0, 10], [20, 0, 10], [0, 20, 10], [20, 20, 10],
    ];
    for (const edge of edges) {
      const part = plainBox();
      part.features.push({
        id: 2,
        name: 'Chamfer1',
        type: 'ChamferFeature',
        kind: 'chamfer',
        bodies: [],
        edges: [edge],
        distance: '2',
        raw: {},
      });
      const result = emitScad(part);
      expect(
        result.diagnostics.filter((item) => item.severity === 'error'),
      ).toEqual([]);
      expect(result.code).toContain('multmatrix');
    }
  });
});

describe('extrude bodies', () => {
  it('extrudes a sketch polygon and cuts it from a box', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Extrude1',
      type: 'ExtrudeFeature',
      kind: 'extrude',
      bodies: ['Body1'],
      sketchId: 1,
      plane: {
        origin: ['0', '0', '0'],
        xDir: ['1', '0', '0'],
        yDir: ['0', '1', '0'],
      },
      profile: {
        kind: 'polygon',
        points: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      },
      distance: '5',
      direction: 'positive',
      operation: 'new_body',
      raw: {},
    });
    part.features.push({
      id: 3,
      name: 'Combine1',
      type: 'CombineFeature',
      kind: 'combine',
      target: 'box',
      tools: ['Body1'],
      operation: 'cut',
      keepTools: false,
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('linear_extrude');
    expect(result.code).toContain('polygon(points =');
    expect(result.code).toContain('difference()');
  });

  it('extrudes a circle', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Extrude1',
      type: 'ExtrudeFeature',
      kind: 'extrude',
      bodies: ['Body1'],
      sketchId: 1,
      plane: { origin: ['0', '0', '0'], xDir: ['1', '0', '0'], yDir: ['0', '1', '0'] },
      profile: { kind: 'circle', center: [0, 0], radius: 2.5 },
      distance: '5',
      direction: 'positive',
      operation: 'new_body',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('circle(r = 2.5');
  });
});

describe('extrude join', () => {
  it('joins an extruded body into a box', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Extrude1',
      type: 'ExtrudeFeature',
      kind: 'extrude',
      bodies: ['Body1'],
      sketchId: 1,
      plane: { origin: ['0', '0', '0'], xDir: ['1', '0', '0'], yDir: ['0', '1', '0'] },
      profile: {
        kind: 'polygon',
        points: [
          [20, 0],
          [25, 0],
          [25, 5],
          [20, 5],
        ],
      },
      distance: '5',
      direction: 'positive',
      operation: 'new_body',
      raw: {},
    });
    part.features.push({
      id: 3,
      name: 'Combine1',
      type: 'CombineFeature',
      kind: 'combine',
      target: 'box',
      tools: ['Body1'],
      operation: 'join',
      keepTools: false,
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('linear_extrude');
    expect(result.code).toContain('union()');
  });
});

describe('native sketch polygon', () => {
  it('emits a 2D sketch module and uses it in the extrude', () => {
    const part = plainBox();
    part.features.push({
      id: 2,
      name: 'Sketch1',
      type: 'Sketch',
      kind: 'sketch',
      sketchId: 1,
      plane: { origin: ['0', '0', '0'], xDir: ['1', '0', '0'], yDir: ['0', '1', '0'] },
      profile: {
        kind: 'polygon',
        points: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      },
      raw: {},
    });
    part.features.push({
      id: 3,
      name: 'Extrude1',
      type: 'ExtrudeFeature',
      kind: 'extrude',
      bodies: ['Body1'],
      sketchId: 1,
      plane: { origin: ['0', '0', '0'], xDir: ['1', '0', '0'], yDir: ['0', '1', '0'] },
      profile: {
        kind: 'polygon',
        points: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
      },
      distance: '5',
      direction: 'positive',
      operation: 'new_body',
      raw: {},
    });
    const result = emitScad(part);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.code).toContain('module sketch_1()');
    expect(result.code).toContain('polygon(points =');
    expect(result.code).toContain('sketch_1();');
  });
});
