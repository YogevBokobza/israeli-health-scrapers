import { describe, expect, it } from 'vitest';

import { stripInputValues } from '../../../tools/calibrate/strip-input-values.js';

describe('stripInputValues', () => {
  it('removes a double-quoted input value, keeping other attributes', () => {
    const html = '<input type="text" name="id" value="123456789" class="foo">';
    expect(stripInputValues(html)).toBe('<input type="text" name="id" class="foo">');
  });

  it('removes a single-quoted input value', () => {
    const html = "<input type=\"password\" value='hunter2'>";
    expect(stripInputValues(html)).toBe('<input type="password">');
  });

  it('removes an unquoted input value', () => {
    const html = '<input name="otp" value=123456>';
    expect(stripInputValues(html)).toBe('<input name="otp">');
  });

  it('leaves an input with no value attribute unchanged', () => {
    const html = '<input type="text" name="empty">';
    expect(stripInputValues(html)).toBe(html);
  });

  it('is case-insensitive for both the tag and the attribute name', () => {
    const html = '<INPUT NAME="id" VALUE="123">';
    expect(stripInputValues(html)).toBe('<INPUT NAME="id">');
  });

  it('clears textarea content while keeping its tags and attributes', () => {
    const html = '<textarea name="notes" rows="4">typed by hand</textarea>';
    expect(stripInputValues(html)).toBe('<textarea name="notes" rows="4"></textarea>');
  });

  it('leaves an already-empty textarea unchanged', () => {
    const html = '<textarea name="notes"></textarea>';
    expect(stripInputValues(html)).toBe(html);
  });

  it('strips every input and textarea across a whole page, structure intact', () => {
    const html =
      '<form><label>ID</label><input type="text" name="id" value="000000000">' +
      '<textarea name="freeText">secret note</textarea>' +
      '<button type="submit">Go</button></form>';

    expect(stripInputValues(html)).toBe(
      '<form><label>ID</label><input type="text" name="id">' +
        '<textarea name="freeText"></textarea>' +
        '<button type="submit">Go</button></form>',
    );
  });

  it('does not touch a value attribute on a non-input, non-textarea element', () => {
    const html = '<button type="submit" value="submit-form">Go</button>';
    expect(stripInputValues(html)).toBe(html);
  });
});
