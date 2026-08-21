/**
 * Removes every `<input>`/`<textarea>` value from a captured HTML string, leaving
 * element structure, other attributes, and selectors untouched.
 *
 * A pure string transform rather than a `page.evaluate` DOM walk, so it stays
 * unit-testable without a browser and the browser-driving capture glue stays a thin
 * wrapper over it.
 *
 * Regex-based, not a full HTML parse: a `value` containing a raw unescaped `>` (never
 * seen in the ID/password/OTP fields this is built for) would break the tag match. A
 * real parser dependency was not worth adding for that one edge case.
 */
export function stripInputValues(html: string): string {
  const withoutInputValues = html.replace(/<input\b[^>]*>/gi, (tag) =>
    tag.replace(/\s+value\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, ''),
  );

  return withoutInputValues.replace(
    /(<textarea\b[^>]*>)[\s\S]*?(<\/textarea>)/gi,
    (_match, open: string, close: string) => `${open}${close}`,
  );
}
