import type { Page } from 'playwright';

export interface BindingDefinition<TResult, TField extends string = string> {
  /** The parser field populated by this selector. */
  field: TField;
  selector: string;
  valueFromResult: (result: TResult) => unknown;
}

export interface TargetBindingDefinition<TResult, TField extends string = string> {
  bindings: readonly BindingDefinition<TResult, TField>[];
  parse: (page: Page) => Promise<TResult>;
}

export interface ResolvedBinding<TField extends string = string> {
  field: TField;
  selector: string;
  matchCount: number;
  value: unknown;
}

export type BindingResolution<TResult, TField extends string = string> =
  | { status: 'pending'; bindings: []; result: null }
  | { status: 'resolved'; bindings: ResolvedBinding<TField>[]; result: TResult };

/** Runs current selectors and parser code against one captured snapshot. */
export async function resolveSnapshotBindings<
  TResult = unknown,
  TField extends string = string,
>(
  page: Page,
  html: string,
  definition: TargetBindingDefinition<TResult, TField> | undefined,
): Promise<BindingResolution<TResult, TField>> {
  await page.setContent(html, { waitUntil: 'domcontentloaded' });

  if (!definition) return { status: 'pending', bindings: [], result: null };

  const result = await definition.parse(page);
  const bindings = await Promise.all(
    definition.bindings.map(async (binding): Promise<ResolvedBinding<TField>> => {
      return {
        field: binding.field,
        selector: binding.selector,
        matchCount: await page.locator(binding.selector).count(),
        value: binding.valueFromResult(result),
      };
    }),
  );

  return { status: 'resolved', bindings, result };
}
