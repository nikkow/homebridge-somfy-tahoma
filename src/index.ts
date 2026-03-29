import type { API } from 'homebridge';

import { SomfyTahomaPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

const registerSomfyTahomaPlatform = (api: API) => {
  api.registerPlatform(PLATFORM_NAME, SomfyTahomaPlatform);
};

export default registerSomfyTahomaPlatform;
