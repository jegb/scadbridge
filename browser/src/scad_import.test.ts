import { describe, expect, it } from 'vitest';
import { planScadImport } from './scad_import';

const SOURCE = `
// Parametric test cube.
$fn = 64;
size = 20;
hole = 6;

module body() {
  difference() {
    cube([size, size, size], center = true);
    cylinder(h = size + 2, d = hole, center = true);
  }
}

body();
`;

describe('planScadImport', () => {
  it('imports a modular SCAD test cube as SolidCraft commands', () => {
    const plan = planScadImport(SOURCE, 'test_cube.scad');
    expect(plan.ok).toBe(true);
    expect(plan.parameters.map((param) => param.name)).toEqual(['size', 'hole']);

    const box = plan.commands.find((command) => command.command === 'solid.box');
    expect(box?.params).toMatchObject({
      length: 'size',
      width: 'size',
      height: 'size',
      center: [0, 0, 0],
    });

    const cylinder = plan.commands.find(
      (command) => command.command === 'solid.cylinder',
    );
    expect(cylinder?.params).toMatchObject({
      diameter: 'hole',
      height: '(size + 2)',
      base: [0, 0, '-((size + 2)) / 2'],
    });

    const combine = plan.commands.find(
      (command) => command.command === 'solid.combine',
    );
    expect(combine?.params.operation).toBe('cut');
    expect(combine?.params.tools).toEqual(['scad_2_cylinder']);
  });

  it('maps translate to solid.move', () => {
    const plan = planScadImport(`
      translate([1, 2, 3]) cube([4, 5, 6]);
    `);
    expect(plan.ok).toBe(true);
    const move = plan.commands.find((command) => command.command === 'solid.move');
    expect(move?.params).toMatchObject({ translate: ['1', '2', '3'] });
  });

  it('rejects unsupported modules', () => {
    const plan = planScadImport('hull() { cube(1); sphere(1); }');
    expect(plan.ok).toBe(false);
    expect(plan.diagnostics.some((item) => item.code === 'E202')).toBe(true);
  });

  it('rejects multi-axis rotations instead of guessing', () => {
    const plan = planScadImport('rotate([10, 20, 0]) cube(1);');
    expect(plan.ok).toBe(false);
    expect(plan.diagnostics.some((item) => item.code === 'E203')).toBe(true);
  });
});

const HANDLE_SUPPORT = `
$fn = 32;
module handle_support() {
  difference() {
    hull() {
      translate([0, 0, 0.5]) cube([120, 30, 1], center = true);
      translate([0, 0, 14]) cube([120, 19, 1], center = true);
    }
    for (x = [-96/2, 96/2]) {
      translate([x, 0, 0]) {
        translate([0, 0, 5]) cylinder(h = 20, d = 11, center = false);
        translate([0, 0, -0.5]) cylinder(h = 10, d = 5, center = false);
        translate([0, 0, -0.5]) cylinder(h = 2, d1 = 9.5, d2 = 5.2, center = false);
      }
    }
  }
}
handle_support();
`;

describe('planScadImport complex structures', () => {
  it('imports hull, for loops and tapered cylinders', () => {
    const plan = planScadImport(HANDLE_SUPPORT, 'handle_support.scad');
    expect(plan.ok).toBe(true);
    expect(plan.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);

    const lofts = plan.commands.filter((command) => command.command === 'solid.loft');
    expect(lofts).toHaveLength(4);
    const sketches = plan.commands.filter(
      (command) => command.command === 'sketch.create',
    );
    expect(sketches).toHaveLength(8);

    const combine = plan.commands.find(
      (command) =>
        command.command === 'solid.combine' && command.params.operation === 'cut',
    );
    expect(combine?.params.operation).toBe('cut');
    expect((combine?.params.tools as string[]).length).toBe(6);
  });
});
