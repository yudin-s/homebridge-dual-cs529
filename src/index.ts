type HomebridgeAPI = {
  registerPlatform: (pluginId: string, platformName: string, ctor: unknown, legacy?: boolean) => void;
};

import { DualCS529Platform } from './platform';

export = (api: HomebridgeAPI): void => {
  api.registerPlatform(
    'homebridge-dual-cs529',
    'DualCS529',
    DualCS529Platform,
    true,
  );
};
