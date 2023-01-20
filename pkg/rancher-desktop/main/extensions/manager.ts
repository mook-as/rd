import type { ContainerEngineClient } from '@pkg/backend/containerEngine';
import { ExtensionManagerImpl } from '@pkg/main/extensions/extensions';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';

import type { ExtensionManager } from '.';

const console = Logging.extensions;
let manager: ExtensionManager | undefined;

getIpcMainProxy(console).handle('extension/install', (_, id) => {
  console.debug(`Trying to install ${ id }`);

  return false;
});

export default async function getExtensionManager(client?: ContainerEngineClient): Promise<ExtensionManager | undefined> {
  if (!client || manager?.client === client) {
    if (!client && !manager) {
      console.debug(`Warning: cached client missing, returning nothing`);
    }

    return manager;
  }
  await manager?.shutdown();

  console.debug(`Creating new extension manager...`);
  manager = new ExtensionManagerImpl(client);

  return manager;
}
