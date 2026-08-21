import fs from 'node:fs/promises';
import path from 'node:path';
import type { HealthFundId } from '../../src/definitions.js';
import { capturesDir } from '../../src/helpers/paths.js';
import type { BindingResolution } from './binding-resolver.js';
import { readManifest, type ManifestEntry } from './manifest.js';

interface FlowStep {
  entry: ManifestEntry;
  screenshot: string;
  resolution: BindingResolution<unknown>;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);

const formatJson = (value: unknown): string => escapeHtml(JSON.stringify(value, null, 2));

function renderBindings(resolution: BindingResolution<unknown>): string {
  if (resolution.status === 'pending') return '<p class="pending">Pending reconstruction</p>';
  return `<dl>${resolution.bindings.map((binding) => `
    <div class="binding${binding.matchCount === 0 ? ' empty' : ''}">
      <dt><code>${escapeHtml(binding.selector)}</code></dt>
      <dd><strong>${escapeHtml(binding.field)}</strong> · ${binding.matchCount} match(es)</dd>
      <dd><pre>${formatJson(binding.value)}</pre></dd>
    </div>`).join('')}</dl>`;
}

function renderStep(step: FlowStep, index: number): string {
  const { entry, resolution } = step;
  return `<article class="step">
    <header><span class="number">${index + 1}</span><div><h3>${escapeHtml(entry.state || entry.label)}</h3><a href="${escapeHtml(entry.url)}">${escapeHtml(entry.url)}</a></div></header>
    <div class="columns">
      <figure><img src="${escapeHtml(step.screenshot)}" alt="Screenshot for ${escapeHtml(entry.label)}"><figcaption>${escapeHtml(entry.label)}</figcaption></figure>
      <section><h4>Bindings</h4>${renderBindings(resolution)}<h4>Result</h4><pre>${formatJson(resolution.result)}</pre></section>
    </div>
  </article>`;
}

function renderReport(fund: HealthFundId, steps: readonly FlowStep[]): string {
  const targets = [...new Set(steps.map((step) => step.entry.target))];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(fund)} calibration flow</title><style>
  :root{color-scheme:light;background:#f3efe6;color:#17221c;font:16px/1.5 ui-sans-serif,system-ui,sans-serif}body{margin:0}.shell{max-width:1500px;margin:auto;padding:40px 24px 80px}h1{font:700 clamp(2rem,5vw,4.5rem)/.95 Georgia,serif;margin:.2em 0}h2{margin:64px 0 16px;border-bottom:2px solid #17221c;padding-bottom:8px}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:#775d37}.step{background:#fff;border:1px solid #c7bfae;margin:18px 0;box-shadow:5px 5px 0 #17221c}.step>header{display:flex;gap:14px;align-items:center;padding:16px;border-bottom:1px solid #c7bfae}.step h3,.step h4{margin:0}.step a{color:#516159;overflow-wrap:anywhere}.number{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:#17221c;color:#fff;font-weight:700}.columns{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(340px,.8fr);gap:24px;padding:20px}figure{margin:0}img{display:block;width:100%;max-height:800px;object-fit:contain;object-position:top;background:#eee;border:1px solid #c7bfae}figcaption{font-family:monospace;margin-top:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f3ed;padding:10px;border-left:3px solid #775d37}.binding{border-top:1px solid #ddd;padding:10px 0}.binding.empty{background:#fff1ef;border-left:5px solid #b33225;padding-left:10px}.binding.empty dd strong:after{content:' · EMPTY';color:#b33225}.pending{padding:18px;background:#fff5c7;border-left:5px solid #b7860b;font-weight:700}dl,dd{margin-left:0}@media(max-width:850px){.columns{grid-template-columns:1fr}.shell{padding:24px 12px}.step{box-shadow:3px 3px 0 #17221c}}
  </style></head><body><main class="shell"><p class="eyebrow">Current-code verification</p><h1>${escapeHtml(fund)} calibration flow</h1><p>${steps.length} captured step(s), regenerated ${escapeHtml(new Date().toISOString())}.</p>${targets.map((target) => `<section><h2>${escapeHtml(target)}</h2>${steps.filter((step) => step.entry.target === target).map((step, index) => renderStep(step, index)).join('')}</section>`).join('')}</main></body></html>`;
}

/** Resolves a capture session with current code and writes its self-contained storyboard shell. */
export async function buildFlowView(
  fund: HealthFundId,
  target?: string,
  resolve?: (entry: ManifestEntry, html: string) => Promise<BindingResolution<unknown>>,
): Promise<string> {
  const dir = capturesDir(fund);
  const manifest = await readManifest(dir);
  const entries = target ? manifest.filter((entry) => entry.target === target) : manifest;
  if (entries.length === 0) {
    throw new Error(target
      ? `No captures found for ${fund}/${target}.`
      : `No captures found for ${fund}. Run calibrate first.`);
  }

  const steps: FlowStep[] = [];
  for (const entry of entries) {
    const html = await fs.readFile(path.join(dir, `${entry.label}.html`), 'utf8');
    steps.push({
      entry,
      screenshot: `./${entry.label}.png`,
      resolution: resolve
        ? await resolve(entry, html)
        : { status: 'pending', bindings: [], result: null },
    });
  }

  const reportPath = path.join(dir, target ? `flow-view--${target}.html` : 'flow-view.html');
  await fs.writeFile(reportPath, renderReport(fund, steps), { encoding: 'utf8', mode: 0o600 });
  return reportPath;
}
