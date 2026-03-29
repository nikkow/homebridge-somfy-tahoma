import { describe, expect, it, vi } from 'vitest';

import pluginEntry from '../../src/index.js';
import { SomfyTahomaPlatform } from '../../src/platform.js';
import { PLATFORM_NAME } from '../../src/settings.js';

describe('plugin entrypoint', () => {
  it('registers platform with Homebridge API', () => {
    const api = {
      registerPlatform: vi.fn(),
    };

    pluginEntry(api as any);

    expect(api.registerPlatform).toHaveBeenCalledWith(PLATFORM_NAME, SomfyTahomaPlatform);
  });
});
