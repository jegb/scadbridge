#!/usr/bin/env node
// Drive the SolidCraft web app in headless Chrome and exercise the SCADBridge overlay.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME ??
  '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const APP_URL = process.env.SCADBRIDGE_URL ?? 'http://127.0.0.1:8781/?webgl';
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), 'scadbridge-chrome-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--enable-unsafe-swiftshader',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
let chromeLog = '';
chrome.stderr?.on('data', (chunk) => {
  chromeLog += chunk.toString();
});

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      }
    });
  }

  call(method, params = {}, timeoutMs = 30_000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, timeoutMs = 180_000) {
    const result = await this.call(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      timeoutMs,
    );
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          'evaluation failed',
      );
    }
    return result.result.value;
  }
}

async function pageTarget() {
  const started = Date.now();
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page');
      if (page) return page;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Chrome DevTools did not start\n${chromeLog.slice(-2000)}`);
}

async function main() {
  const page = await pageTarget();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const cdp = new Cdp(ws);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Page.navigate', { url: APP_URL });

  const ready = await cdp.eval(
    `(async () => {
      const started = Date.now();
      while (Date.now() - started < 150000) {
        if (window.solidcraft && document.getElementById('scadbridge-panel')) return true;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return { solidcraft: !!window.solidcraft, panel: !!document.getElementById('scadbridge-panel') };
    })()`,
    170_000,
  );
  if (ready !== true) throw new Error(`app did not become ready: ${JSON.stringify(ready)}`);

  const simpleCubeSource = readFileSync(
    new URL('../examples/simple_cube.scad', import.meta.url),
    'utf8',
  );
  const result = await cdp.eval(
    `(async () => {
      const output = {};
      const cubeSource = ${JSON.stringify(simpleCubeSource)};
      output.connected = !!window.solidcraft;
      document.querySelector('button[data-action="validate"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      output.emptyValidate = {
        status: document.getElementById('scadb-status')?.textContent,
        log: document.getElementById('scadb-log')?.textContent.slice(-160),
      };
      output.nativeHook = typeof window.scadbridgeOpenFile === 'function';
      await window.scadbridge.createTestCube();
      const compiled = await window.scadbridge.compile();
      output.scad = compiled.scad.code;
      output.diagnostics = compiled.scad.diagnostics;
      const validation = await window.scadbridge.validate();
      output.ok = validation.validation.ok;
      output.comparison = validation.validation.comparison;
      output.referenceVolume = validation.validation.reference.volume;
      output.generatedVolume = validation.validation.generated.volume;
      output.tolerance = {
        volumeRelative: validation.validation.comparison.volumeRelative,
        bboxAbsolute: validation.validation.comparison.bboxAbsolute,
      };
      output.log = validation.validation.openscadLog.slice(-5);
      await window.scadbridge.openScad(cubeSource, 'simple_cube.scad');
      const listing = await window.solidcraft.execute('model.edges', { body: 'scad_1_cube' });
      const edge = listing.edges.find((item) => item.index === 0) ?? listing.edges[0];
      await window.solidcraft.execute('solid.chamfer', {
        edges: [{ body: 'scad_1_cube', index: edge.index }],
        distance: '2',
      });
      const chamferInspection = await window.scadbridge.inspect();
      const chamferItem = chamferInspection.timeline.find((item) => item.type === 'ChamferFeature');
      const chamferDetail = await window.solidcraft.execute('timeline.inspect', { feature: chamferItem.id });
      output.simpleChamfer = {
        edge: edge.mid,
        definition: chamferDetail.definition,
        volume: chamferInspection.bodies.reduce((sum, body) => sum + body.volume_mm3, 0),
      };
      const chamferCompiled = await window.scadbridge.compile();
      const chamferValidation = await window.scadbridge.validate();
      window.scadbridgeFileHandle = {
        createWritable: async () => ({
          write: async (text) => { window.__written = text; },
          close: async () => {},
        }),
      };
      const writeBack = await window.scadbridge.update();
      output.chamferScad = {
        errors: chamferCompiled.scad.diagnostics
          .filter((item) => item.severity === 'error')
          .map((item) => item.code),
        validationOk: chamferValidation.validation.ok,
        volumeRelative: chamferValidation.validation.comparison.volumeRelative,
        wrote: writeBack.wrote,
        writtenHasExtrude: (window.__written || '').includes('linear_extrude'),
        writtenHasCube: (window.__written || '').includes('cube('),
        code: chamferCompiled.scad.code,
      };
      output.exportHook = typeof window.scadbridgeExportScad === 'function';
      const bosl2 = await window.scadbridge.render('include <BOSL2/std.scad>; cuboid([10, 10, 10]);');
      output.bosl2 = { stlBytes: bosl2.stl.length, log: bosl2.log.slice(-5) };
      const runOp = async (name, commands, fresh = false) => {
        if (fresh) {
          await window.solidcraft.execute('file.new');
        } else {
          await window.scadbridge.openScad(cubeSource, 'simple_cube.scad');
        }
        for (const entry of commands) {
          await window.solidcraft.execute(entry.command, entry.params);
        }
        const inspection = await window.scadbridge.inspect();
        const compiled = await window.scadbridge.compile();
        const validation = await window.scadbridge.validate();
        return {
          name,
          volume: inspection.bodies.reduce((sum, body) => sum + body.volume_mm3, 0),
          errors: compiled.scad.diagnostics
            .filter((item) => item.severity === 'error')
            .map((item) => item.code),
          ok: validation.validation.ok,
          comparison: validation.validation.comparison,
          reference: {
            volume: validation.validation.reference.volume,
            area: validation.validation.reference.area,
          },
          generated: {
            volume: validation.validation.generated.volume,
            area: validation.validation.generated.area,
          },
        };
      };
      output.ops = [];
      output.ops.push(await runOp('hole', [
        { command: 'solid.hole', params: { position: [10, 10, 20], diameter: '5' } },
      ]));
      output.ops.push(await runOp('fillet', [
        { command: 'solid.fillet', params: { edges: [[0, 10, 0]], radius: '2', body: 'scad_1_cube' } },
      ]));
      output.ops.push(await runOp('shell', [
        { command: 'solid.shell', params: { faces: [[20, 10, 10]], thickness: '2', body: 'scad_1_cube' } },
      ]));
      output.ops.push(await runOp('cut', [
        { command: 'solid.cylinder', params: { radius: '3', height: '30', base: [10, 10, -5], operation: 'cut', targets: ['scad_1_cube'], body_name: 'cutter' } },
      ]));
      output.ops.push(await runOp('chamfer_edge', [
        { command: 'solid.chamfer', params: { edges: [[20, 10, 0]], distance: '2' } },
      ]));
      output.ops.push(await runOp('sphere_cut', [
        { command: 'solid.sphere', params: { radius: '5', center: [0, 0, 0], body_name: 'Body1' } },
        { command: 'solid.combine', params: { target: 'scad_1_cube', tools: ['Body1'], operation: 'cut' } },
      ]));
      output.ops.push(await runOp('torus', [
        { command: 'solid.torus', params: { major: '10', minor: '2', body_name: 'Torus1' } },
      ], true));
      output.ops.push(await runOp('mirror', [
        { command: 'solid.mirror', params: { bodies: ['scad_1_cube'], combine: true, plane: 'YZ' } },
      ]));
      output.ops.push(await runOp('rect_pattern', [
        { command: 'solid.pattern.rectangular', params: { bodies: ['scad_1_cube'], dir1: [1, 0, 0], count1: 2, spacing1: '20' } },
      ]));
      output.ops.push(await runOp('circ_pattern', [
        { command: 'solid.pattern.circular', params: { bodies: ['scad_1_cube'], axis: 'Z', count: 4, angle: '360' } },
      ]));
      output.ops.push(await runOp('coil', [
        { command: 'solid.coil', params: { diameter: '20', revolutions: 5, height: '50', section_size: '2', body_name: 'Coil1' } },
      ], true));
      output.ops.push(await runOp('bounding', [
        { command: 'solid.bounding_solid', params: { bodies: ['scad_1_cube'], margin: '2', body_name: 'Bounds1' } },
      ]));
      output.ops.push(await runOp('cube_sphere_separate', [
        { command: 'solid.sphere', params: { radius: '5', center: [0, 0, 0], body_name: 'Body1' } },
      ]));
      output.ops.push(await runOp('component_sphere', [
        { command: 'component.create', params: { name: 'Component1' } },
        { command: 'solid.sphere', params: { radius: '5', center: [0, 0, 0], body_name: 'Body1' } },
        { command: 'solid.move', params: { bodies: ['Body1'], translate: ['5', '0', '0'] } },
        { command: 'component.activate', params: { component: 0 } },
      ]));
      output.ops.push(await runOp('fillet_hole', [
        { command: 'solid.hole', params: { position: [10, 10, 20], diameter: '5' } },
        { command: 'solid.fillet', params: { edges: [[0, 10, 0]], radius: '2', body: 'scad_1_cube' } },
      ]));
      output.ops.push(await runOp('fillet_shell', [
        { command: 'solid.shell', params: { faces: [[20, 10, 10]], thickness: '2', body: 'scad_1_cube' } },
        { command: 'solid.fillet', params: { edges: [[0, 10, 0]], radius: '2', body: 'scad_1_cube' } },
      ]));
      output.ops.push(await runOp('fillet_extrude', [
        { command: 'sketch.create', params: { plane: 'XY' } },
        { command: 'sketch.rectangle.two_point', params: { p0: [0, 0], p1: [20, 20] } },
        { command: 'sketch.finish', params: {} },
        { command: 'solid.extrude', params: { distance: '20', body_name: 'Body1' } },
        { command: 'solid.fillet', params: { edges: [[0, 10, 0]], radius: '2', body: 'Body1' } },
      ], true));
      output.ops.push(await runOp('extrude_cut', [
        { command: 'sketch.create', params: { plane: 'XY' } },
        { command: 'sketch.rectangle.two_point', params: { p0: [0, 0], p1: [5, 5] } },
        { command: 'sketch.finish', params: {} },
        { command: 'solid.extrude', params: { distance: '5', body_name: 'Body1' } },
        { command: 'solid.combine', params: { target: 'scad_1_cube', tools: ['Body1'], operation: 'cut' } },
      ]));
      return JSON.stringify(output);
    })()`,
    240_000,
  );

  const parsed = JSON.parse(result);
  const scadSource = readFileSync(
    new URL('../examples/test_cube.scad', import.meta.url),
    'utf8',
  );
  const imported = JSON.parse(
    await cdp.eval(
      `(async () => {
        const opened = await window.scadbridge.openScad(${JSON.stringify(scadSource)}, 'test_cube.scad');
        const inspection = await window.scadbridge.inspect();
        const ui = await window.solidcraft.request('ui.inspect');
        const volumeAfterImport = inspection.bodies.reduce((sum, body) => sum + body.volume_mm3, 0);
        await window.scadbridge.api().execute('parameters.change', {
          name: 'size',
          expression: '30',
        });
        const changed = await window.scadbridge.inspect();
        const volumeAfterChange = changed.bodies.reduce((sum, body) => sum + body.volume_mm3, 0);
        const compiled = await window.scadbridge.compile();
        return JSON.stringify({
          applied: opened.applied,
          diagnostics: opened.plan.diagnostics,
          parameters: opened.plan.parameters,
          bodies: inspection.bodies.map((body) => ({
            name: body.name,
            volume: body.volume_mm3,
            bbox: body.bbox,
          })),
          timeline: inspection.timeline.map((item) => item.type),
          home: ui.home,
          volumeAfterImport,
          volumeAfterChange,
          compileDiagnostics: compiled.scad.diagnostics,
          scadUsesNewSize: compiled.scad.code.includes('size = 30;'),
        });
      })()`,
      180_000,
    ),
  );
  parsed.imported = imported;
  const uiOpen = JSON.parse(
    await cdp.eval(
      `(async () => {
        window.scadbridgeOpenFile(${JSON.stringify(scadSource)}, 'test_cube.scad');
        const started = Date.now();
        while (Date.now() - started < 60000) {
          if (document.getElementById('scadb-file-name')?.textContent === 'test_cube.scad') break;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        const inspection = await window.scadbridge.inspect();
        const ui = await window.solidcraft.request('ui.inspect');
        return JSON.stringify({
          name: document.getElementById('scadb-file-name')?.textContent,
          home: ui.home,
          volume: inspection.bodies.reduce((sum, body) => sum + body.volume_mm3, 0),
        });
      })()`,
      90000,
    ),
  );
  parsed.uiOpen = uiOpen;
  const handleSource = readFileSync(
    new URL('../examples/handle_support.scad', import.meta.url),
    'utf8',
  );
  const handle = JSON.parse(
    await cdp.eval(
      `(async () => {
        const opened = await window.scadbridge.openScad(${JSON.stringify(handleSource)}, 'handle_support.scad');
        const inspection = await window.scadbridge.inspect();
        const ui = await window.solidcraft.request('ui.inspect');
        return JSON.stringify({
          applied: opened.applied,
          diagnostics: opened.plan.diagnostics,
          volume: inspection.bodies.reduce((sum, body) => sum + body.volume_mm3, 0),
          home: ui.home,
          features: inspection.timeline.map((item) => item.type),
          commands: opened.plan.commands,
        });
      })()`,
      180_000,
    ),
  );
  parsed.handle = handle;
  console.log(JSON.stringify(parsed, null, 2));
  if (!parsed.ok) process.exitCode = 2;
  if (!parsed.nativeHook) process.exitCode = 4;
  if (Math.abs(parsed.simpleChamfer.volume - 7960) > 1) process.exitCode = 14;
  if (!parsed.chamferScad.validationOk) process.exitCode = 11;
  if (!parsed.chamferScad.wrote || !parsed.chamferScad.writtenHasExtrude) process.exitCode = 12;
  if (!parsed.exportHook) process.exitCode = 13;
  if (parsed.emptyValidate?.status !== 'empty') process.exitCode = 17;
  if (!(parsed.bosl2.stlBytes > 84)) process.exitCode = 16;
  if (!parsed.ops.every((op) => op.ok && op.errors.length === 0)) process.exitCode = 15;
  if (parsed.uiOpen.name !== 'test_cube.scad') process.exitCode = 7;
  if (parsed.uiOpen.home !== false) process.exitCode = 8;
  if (parsed.imported.home !== false) process.exitCode = 8;
  if (!parsed.handle.applied || parsed.handle.diagnostics.some((item) => item.severity === 'error')) {
    process.exitCode = 9;
  }
  if (!(parsed.handle.volume > 0) || parsed.handle.home !== false) process.exitCode = 10;
  if (!imported.applied || imported.diagnostics.some((item) => item.severity === 'error')) {
    process.exitCode = 3;
  }
  if (Math.abs(imported.volumeAfterImport - 7434.607251775665) > 1) {
    process.exitCode = 5;
  }
  if (!imported.scadUsesNewSize) {
    process.exitCode = 6;
  }
  ws.close();
}

main()
  .catch((error) => {
    console.error(`browser smoke failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill('SIGTERM');
    rmSync(profile, { recursive: true, force: true });
  });
