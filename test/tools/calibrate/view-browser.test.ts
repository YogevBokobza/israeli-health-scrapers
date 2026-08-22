import { describe, expect, it, vi } from 'vitest';

import { newFlowViewPage } from '../../../tools/calibrate/view-browser.js';

describe('flow-view browser', () => {
  it('uses the native browser window instead of a fixed Playwright viewport', async () => {
    const page = {};
    const newPage = vi.fn().mockResolvedValue(page);
    const newContext = vi.fn().mockResolvedValue({ newPage });

    const result = await newFlowViewPage({ newContext } as never);

    expect(newContext).toHaveBeenCalledWith({ viewport: null });
    expect(result).toBe(page);
  });
});
