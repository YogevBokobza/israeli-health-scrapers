import type { Page } from 'playwright';

export interface BindingDefinition {
  /** The parser field populated by this selector. */
  field: string;
  selector: string;
}

export interface TargetBindingDefinition<TResult> {
  bindings: readonly BindingDefinition[];
  parse: (page: Page) => Promise<TResult>;
}

export interface ResolvedBinding extends BindingDefinition {
  matchCount: number;
  values: string[];
}

export type BindingResolution<TResult> =
  | { status: 'pending'; bindings: []; result: null }
  | { status: 'resolved'; bindings: ResolvedBinding[]; result: TResult };

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** Runs current selectors and parser code against one captured snapshot. */
export async function resolveSnapshotBindings<TResult>(
  page: Page,
  html: string,
  definition: TargetBindingDefinition<TResult> | undefined,
): Promise<BindingResolution<TResult>> {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  if (!definition) return { status: 'pending', bindings: [], result: null };

  const bindings = await Promise.all(
    definition.bindings.map(async (binding): Promise<ResolvedBinding> => {
      const locator = page.locator(binding.selector);
      return {
        ...binding,
        matchCount: await locator.count(),
        values: (await locator.allTextContents()).map(normalizeText),
      };
    }),
  );

  return { status: 'resolved', bindings, result: await definition.parse(page) };
}
