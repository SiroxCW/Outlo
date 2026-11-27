import { describe, expect, it } from 'vitest';
import { handlers } from './handlers';

describe('core handlers', () => {
  it('reports the process it runs in', async () => {
    const info = await handlers['core.info'](undefined);
    expect(info.pid).toBe(process.pid);
    expect(info.nodeVersion).toBe(process.versions.node);
    expect(info.startedAt).toBeLessThanOrEqual(Date.now());
  });
});
