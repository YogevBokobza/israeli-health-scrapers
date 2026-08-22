import type { Page } from 'playwright';

import type { HealthFundId } from '../../src/definitions.js';
import { CAPTURE_STATES, CAPTURE_TARGETS, validateCaptureTarget } from './target-picker.js';
import { captureSnapshot } from './capture.js';

export interface CaptureButtonResult {
  ok: boolean;
  label?: string;
  error?: string;
}

interface BootstrapArgs {
  targets: readonly string[];
  states: readonly string[];
}

/**
 * Runs *inside* the page — built and re-run by Playwright, not by Node. Builds the
 * floating capture button once, then a `MutationObserver` on the whole document keeps
 * rebuilding it whenever it goes missing, which is what makes it survive an SPA route
 * change: whether that change swaps a client-rendered subtree or replaces the body
 * outright, either shows up as a childList mutation the observer sees. A pushState/
 * popstate hook is a second line of defense for a route change that leaves the button's
 * node untouched but should still be checked.
 *
 * Kept as one self-contained function (no references to anything outside its own
 * scope or its argument) because Playwright ships it to the browser by stringifying it.
 */
function bootstrapCaptureButton({ targets, states }: BootstrapArgs): void {
  const ROOT_ID = 'ihs-calibrate-capture-button';
  const OTHER = '__other__';

  function build(): void {
    if (!document.body) return;
    if (document.getElementById(ROOT_ID)) return;

    const root = document.createElement('form');
    root.id = ROOT_ID;
    root.style.cssText = [
      'position:fixed',
      'bottom:16px',
      'right:16px',
      'z-index:2147483647',
      'background:#111',
      'color:#fff',
      'padding:10px',
      'border-radius:8px',
      'font:12px sans-serif',
      'display:flex',
      'gap:6px',
      'align-items:center',
      'box-shadow:0 2px 8px rgba(0,0,0,.4)',
    ].join(';');

    const targetSelect = document.createElement('select');
    targetSelect.name = 'target';
    for (const target of [...targets, OTHER]) {
      const option = document.createElement('option');
      option.value = target;
      option.textContent = target === OTHER ? 'other…' : target;
      targetSelect.appendChild(option);
    }

    const otherInput = document.createElement('input');
    otherInput.type = 'text';
    otherInput.name = 'other-target';
    otherInput.placeholder = 'lowerCamel target';
    otherInput.pattern = '^[a-z][a-zA-Z0-9]*$';
    otherInput.style.width = '110px';
    otherInput.style.display = 'none';

    targetSelect.addEventListener('change', () => {
      const isOther = targetSelect.value === OTHER;
      otherInput.style.display = isOther ? '' : 'none';
      otherInput.required = isOther;
      if (!isOther) otherInput.value = '';
    });

    // Free text, not a closed picker: a login-calibration session needs one label per
    // ordered screen (e.g. "id-screen", "otp-screen") and those don't fit
    // collapsed/expanded/list/detail. The datalist only offers those four as
    // suggestions — it does not restrict the value the way `<select>` would.
    const stateListId = `${ROOT_ID}-states`;
    const stateInput = document.createElement('input');
    stateInput.type = 'text';
    stateInput.name = 'state';
    stateInput.setAttribute('list', stateListId);
    stateInput.placeholder = 'state (optional)';
    stateInput.style.width = '110px';

    const stateOptions = document.createElement('datalist');
    stateOptions.id = stateListId;
    for (const state of states) {
      const option = document.createElement('option');
      option.value = state;
      stateOptions.appendChild(option);
    }

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Capture';

    const status = document.createElement('span');
    status.style.cssText = 'min-width:130px;opacity:.85;';

    root.append(targetSelect, otherInput, stateInput, stateOptions, submit, status);
    document.body.appendChild(root);

    // The browser withholds the `submit` event entirely for an invalid form submitted
    // via a submit control, so an unmatched pattern on `otherInput` never reaches here.
    root.addEventListener('submit', (event) => {
      event.preventDefault();

      const target = targetSelect.value === OTHER ? otherInput.value.trim() : targetSelect.value;
      const state = stateInput.value.trim();

      status.textContent = 'capturing…';
      const capture = (
        window as unknown as { __ihsCapture: (target: string, state: string) => Promise<CaptureButtonResult> }
      ).__ihsCapture;

      capture(target, state)
        .then((result) => {
          status.textContent = result.ok ? `captured "${result.label}"` : (result.error ?? 'capture failed');
        })
        .catch((error: unknown) => {
          status.textContent = error instanceof Error ? error.message : 'capture failed';
        });
    });
  }

  function start(): void {
    build();

    new MutationObserver(() => build()).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });

    // Defense in depth: a route change that never touches the button's own subtree (an
    // SPA that mounts an entirely separate detail view alongside it) still runs this.
    const recheck = (): void => {
      setTimeout(build, 0);
    };
    for (const method of ['pushState', 'replaceState'] as const) {
      const original = history[method].bind(history);
      history[method] = ((...args: Parameters<History['pushState']>) => {
        const result = original(...args);
        recheck();
        return result;
      }) as History[typeof method];
    }
    window.addEventListener('popstate', recheck);
  }

  if (document.documentElement) start();
  else window.addEventListener('DOMContentLoaded', start, { once: true });
}

/**
 * Produces browser JavaScript without relying on Playwright stringifying a function
 * transformed by tsx. Esbuild decorates nested named functions with its private
 * `__name` helper, so the serialized script supplies the same identity helper.
 */
export function captureButtonScript(args: BootstrapArgs): string {
  return `const __name = (target) => target; (${bootstrapCaptureButton.toString()})(${JSON.stringify(args)})`;
}

/** Injects the floating capture button. Assumes `window.__ihsCapture` is already exposed. */
export async function injectCaptureButton(page: Page): Promise<void> {
  const args: BootstrapArgs = { targets: CAPTURE_TARGETS, states: CAPTURE_STATES };
  const script = captureButtonScript(args);
  await page.addInitScript({ content: script });
  await page.evaluate(script);
}

/**
 * Wires the capture button to a real capture: exposes `__ihsCapture` bound to this
 * fund and page, validating a provisional target's slug before ever touching disk,
 * then injects the button. `installCaptureButton` is the thin glue; `injectCaptureButton`
 * and `validateCaptureTarget` are what's actually tested.
 */
export async function installCaptureButton(page: Page, fund: HealthFundId): Promise<void> {
  await page.exposeFunction('__ihsCapture', async (target: string, state: string): Promise<CaptureButtonResult> => {
    const validation = validateCaptureTarget(target);
    if (!validation.ok) return { ok: false, error: validation.error };

    try {
      const entry = await captureSnapshot(page, { fund, target, state });
      return { ok: true, label: entry.label };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  await injectCaptureButton(page);
}
