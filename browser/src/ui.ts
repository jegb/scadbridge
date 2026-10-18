import {
  compileCurrentDesign,
  validateCurrentDesign,
} from './demo';
import { updateScad } from './import';
import { inspectDesign } from './solidcraft';
import { openScadSource } from './import';
import type { Diagnostic } from './ir';
import { openScadWasmUrl } from './validate';

const STYLE = `
.scadb-panel {
  position: fixed;
  right: 12px;
  top: 64px;
  width: 460px;
  max-height: calc(100vh - 84px);
  display: flex;
  flex-direction: column;
  background: #1f2329;
  color: #e6e8eb;
  border: 1px solid #3b424b;
  border-radius: 8px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  font: 12px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  z-index: 2147483000;
  overflow: hidden;
}
.scadb-panel.collapsed { width: 150px; }
.scadb-panel.collapsed .scadb-status { display: none; }
.scadb-panel.collapsed .scadb-body { display: none; }
.scadb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: #262b32;
  border-bottom: 1px solid #3b424b;
  cursor: pointer;
  user-select: none;
}
.scadb-title { font-weight: 600; color: #9ecbff; }
.scadb-dot { width: 8px; height: 8px; border-radius: 50%; background: #7a828c; }
.scadb-dot.ok { background: #4ec9b0; }
.scadb-dot.bad { background: #e06c75; }
.scadb-spacer { flex: 1; }
.scadb-body { padding: 10px; overflow: auto; display: flex; flex-direction: column; gap: 8px; }
.scadb-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.scadb-filebar { display: flex; align-items: center; gap: 8px; min-height: 30px; }.scadb-filename {
  color: #9aa3ad;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scadb-panel button {
  background: #2f353d;
  color: #e6e8eb;
  border: 1px solid #434b56;
  border-radius: 5px;
  padding: 6px 8px;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.scadb-panel button:hover { background: #39414b; }
.scadb-panel button:disabled { opacity: 0.45; cursor: default; }
.scadb-panel button.primary { background: #1f6feb; border-color: #2f81f7; }
.scadb-panel button.primary:hover { background: #2f81f7; }
.scadb-status { color: #9aa3ad; }
.scadb-collapse { color: #9aa3ad; font-size: 11px; }
.scadb-log {
  margin: 0;
  padding: 8px;
  background: #171a1f;
  border: 1px solid #343b44;
  border-radius: 5px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #cfd6de;
}
.scadb-code {
  margin: 0;
  padding: 8px;
  background: #101317;
  border: 1px solid #343b44;
  border-radius: 5px;
  max-height: 320px;
  overflow: auto;
  white-space: pre;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #d7e3f0;
}
.scadb-diag { margin: 0; padding-left: 16px; }
.scadb-diag li { margin: 2px 0; }
.scadb-diag .error { color: #ff9a9e; }
.scadb-diag .warning { color: #f0c674; }
.scadb-tabs { display: flex; gap: 4px; }
.scadb-tabs button { flex: 1; text-align: center; }
.scadb-tabs button.active { background: #39414b; border-color: #5a6472; }
.scadb-foot { color: #7d8792; font-size: 10px; }
.scadb-build { color: #7d8792; font-size: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.scadb-metrics { width: 100%; border-collapse: collapse; }
.scadb-metrics td { padding: 2px 4px; border-bottom: 1px solid #2f353d; }
.scadb-metrics td:last-child { text-align: right; font-family: ui-monospace, Menlo, monospace; }
.scadb-pass { color: #4ec9b0; }
.scadb-fail { color: #e06c75; }
`;

type Tab = 'log' | 'scad';

export interface Panel {
  setStatus(connected: boolean): void;
  log(message: string): void;
  openFile(source: string, name: string): Promise<void>;
}

export function mountPanel(): Panel {
  if (document.getElementById('scadbridge-panel')) {
    throw new Error('SCADBridge panel is already mounted.');
  }
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const panel = document.createElement('div');
  panel.id = 'scadbridge-panel';
  panel.className = 'scadb-panel';
  panel.innerHTML = `
    <div class="scadb-head" id="scadb-head">
      <span class="scadb-dot" id="scadb-dot"></span>
      <span class="scadb-title">SCADBridge</span>
      <span class="scadb-spacer"></span>
      <span class="scadb-status" id="scadb-status">starting</span>
      <span class="scadb-collapse" id="scadb-collapse">▾</span>
    </div>
    <div class="scadb-body">
      <div class="scadb-filebar">
        <span class="scadb-filename" id="scadb-file-name">No SCAD file</span>
      </div>
      <div class="scadb-actions">
        <button data-action="inspect">Inspect timeline</button>
        <button data-action="compile" class="primary">Compile SCAD</button>
        <button data-action="validate" class="primary">Validate</button>
        <button data-action="update" class="primary">Update SCAD</button>
      </div>
      <div class="scadb-tabs">
        <button data-tab="log" class="active">Log</button>
        <button data-tab="scad">SCAD</button>
      </div>
      <pre class="scadb-log" id="scadb-log"></pre>
      <pre class="scadb-code" id="scadb-code" style="display:none"></pre>
      <ul class="scadb-diag" id="scadb-diag"></ul>
      <div class="scadb-foot">Validation uses OpenSCAD WASM (GPL-2.0) from a CDN at runtime.</div>
      <div class="scadb-build" id="scadb-build">commit dev</div>
    </div>
  `;
  document.body.append(panel);

  const dot = required<HTMLElement>('scadb-dot');
  const status = required<HTMLElement>('scadb-status');
  const logEl = required<HTMLElement>('scadb-log');
  const codeEl = required<HTMLElement>('scadb-code');
  const diagEl = required<HTMLElement>('scadb-diag');
  const fileNameEl = required<HTMLElement>('scadb-file-name');
  const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button[data-action]'));

  let tab: Tab = 'log';
  let busy = false;

  const setTab = (next: Tab) => {
    tab = next;
    logEl.style.display = tab === 'log' ? '' : 'none';
    codeEl.style.display = tab === 'scad' ? '' : 'none';
    for (const button of panel.querySelectorAll<HTMLButtonElement>('button[data-tab]')) {
      button.classList.toggle('active', button.dataset.tab === tab);
    }
  };

  const setBusy = (value: boolean) => {
    busy = value;
    for (const button of buttons) button.disabled = value;
  };

  const append = (message: string) => {
    const time = new Date().toLocaleTimeString();
    logEl.textContent += `[${time}] ${message}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  };

  const showDiagnostics = (diagnostics: Diagnostic[]) => {
    diagEl.innerHTML = '';
    for (const item of diagnostics) {
      const li = document.createElement('li');
      li.className = item.severity;
      li.textContent = `${item.code} ${item.message}`;
      diagEl.append(li);
    }
  };

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    append(`${label} started`);
    try {
      await action();
    } catch (error) {
      append(`${label} failed: ${errorMessage(error)}`);
      status.textContent = 'error';
      dot.className = 'scadb-dot bad';
    } finally {
      setBusy(false);
    }
  };

  const refreshCode = (code: string) => {
    codeEl.textContent = code;
    setTab('scad');
  };

  const openFile = async (source: string, name: string): Promise<void> => {
    if (busy) return;
    await run(`Open ${name}`, async () => {
      const result = await openScadSource(source, name);
      showDiagnostics(result.plan.diagnostics);
      if (!result.applied) {
        const errors = result.plan.diagnostics.filter(
          (item) => item.severity === 'error',
        ).length;
        append(`Import refused: ${errors} error(s). The design was not changed.`);
        status.textContent = 'import failed';
        dot.className = 'scadb-dot bad';
        return;
      }
      fileNameEl.textContent = name;
      append(
        `Opened ${name}: ${result.plan.parameters.length} parameters, ${result.plan.commands.length} commands. The SolidCraft viewport now shows the imported model.`,
      );
      append(
        `Writable file handle: ${window.scadbridgeFileHandle ? 'yes' : 'no'}. ${
          window.scadbridgeFileHandle
            ? 'Update can write in place.'
            : 'Update will open a save dialog.'
        }`,
      );
      const inspection = await inspectDesign(true);
      const supported = new Set([
        'BoxFeature',
        'CylinderFeature',
        'SphereFeature',
        'CombineFeature',
        'MoveFeature',
        'RemoveFeature',
      ]);
      const unsupported = Array.from(
        new Set(inspection.timeline.map((item) => item.type)),
      ).filter((type) => !supported.has(type));
      if (unsupported.length > 0) {
        append(
          `SCAD export is not available yet for: ${unsupported.join(', ')}. The imported design remains in SolidCraft.`,
        );
        status.textContent = 'opened';
        dot.className = 'scadb-dot ok';
        return;
      }
      const compiled = await compileCurrentDesign();
      refreshCode(compiled.scad.code);
      showDiagnostics(compiled.scad.diagnostics);
      status.textContent = 'opened';
      dot.className = 'scadb-dot ok';
    });
  };

  const onClick = (action: string) => {
    if (action === 'inspect') {
      void run('Inspect timeline', async () => {
        const inspection = await inspectDesign(true);
        append(
          `Design "${inspection.name ?? 'untitled'}": ${inspection.timeline.length} features, ${inspection.bodies.length} bodies.`,
        );
        append(
          `Parameters: ${inspection.params.map((param) => `${param.name}=${param.expression}${param.unit}`).join(', ') || 'none'}`,
        );
        append(
          `Bodies: ${inspection.bodies.map((body) => `${body.name}=${body.volume_mm3?.toFixed(1)} mm3`).join(', ') || 'none'}`,
        );
        for (const item of inspection.timeline) {
          append(`  ${item.id} ${item.name} (${item.type})${item.error ? ` ERROR ${item.error}` : ''}`);
        }
      });
    } else if (action === 'compile') {
      void run('Compile SCAD', async () => {
        const result = await compileCurrentDesign();
        refreshCode(result.scad.code);
        showDiagnostics(result.scad.diagnostics);
        append(
          `Compiled ${result.part.features.length} features into ${result.scad.bodies.length} bodies.`,
        );
        if (result.scad.diagnostics.some((item) => item.severity === 'error')) {
          append('Compilation has errors. The SCAD file is not verified.');
          status.textContent = 'unverified';
          dot.className = 'scadb-dot bad';
        } else {
          status.textContent = 'compiled';
          dot.className = 'scadb-dot ok';
        }
      });
    } else if (action === 'validate') {
      void run('Validate', async () => {
        const result = await validateCurrentDesign();
        refreshCode(result.scad.code);
        showDiagnostics(result.validation.diagnostics);
        const comparison = result.validation.comparison;
        append(
          `Validation ${result.validation.ok ? 'PASS' : 'FAIL'}: volume ${formatPercent(comparison.volumeRelative)}, area ${formatPercent(comparison.areaRelative)}, bbox ${comparison.bboxAbsolute.toFixed(4)} mm, centroid ${comparison.centroidAbsolute.toFixed(4)} mm.`,
        );
        append(
          `Reference volume ${result.validation.reference.volume.toFixed(1)} mm3, generated ${result.validation.generated.volume.toFixed(1)} mm3, ${result.validation.generated.triangles} triangles.`,
        );
        status.textContent = result.validation.ok ? 'validated' : 'failed';
        dot.className = result.validation.ok ? 'scadb-dot ok' : 'scadb-dot bad';
      });
    } else if (action === 'update') {
      void run('Update SCAD', async () => {
        const result = await updateScad();
        if (result.cancelled) {
          append('Update cancelled.');
          return;
        }
        if (result.wrote) {
          fileNameEl.textContent = result.name;
          append(
            `Rewrote ${result.name} at ${new Date().toLocaleString()}.`,
          );
        } else {
          append(`No writable file handle; downloaded ${result.name} instead.`);
        }
        status.textContent = result.wrote ? 'updated' : 'downloaded';
        dot.className = 'scadb-dot ok';
      });
    }
  };

  panel.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const tabButton = target.closest<HTMLButtonElement>('button[data-tab]');
    if (tabButton) {
      setTab(tabButton.dataset.tab as Tab);
      return;
    }
    const actionButton = target.closest<HTMLButtonElement>('button[data-action]');
    if (actionButton?.dataset.action) {
      onClick(actionButton.dataset.action);
    }
  });

  const head = required<HTMLElement>('scadb-head');
  const collapse = required<HTMLElement>('scadb-collapse');
  head.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed');
    collapse.textContent = collapsed ? '▸' : '▾';
  });

  const build = required<HTMLElement>('scadb-build');
  const moduleMatch = new URL(import.meta.url).pathname.match(/scadbridge-([a-f0-9]+)\.js/);
  build.textContent = `commit ${moduleMatch ? moduleMatch[1] : 'dev'}`;

  append(
    `SCADBridge ready. Use SolidCraft File > Open... to load a .scad model. Validation: ${openScadWasmUrl()}`,
  );

  return {
    setStatus(connected: boolean) {
      dot.className = connected ? 'scadb-dot ok' : 'scadb-dot bad';
      status.textContent = connected ? 'connected' : 'no API';
    },
    log(message: string) {
      append(message);
    },
    openFile,
  };
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(3)}%`;
}
