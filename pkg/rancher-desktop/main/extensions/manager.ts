import type { ContainerEngineClient } from '@pkg/backend/containerEngine';
import type { Settings } from '@pkg/config/settings';
import { ExtensionManagerImpl } from '@pkg/main/extensions/extensions';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import Logging from '@pkg/utils/logging';
import type { RecursiveReadonly } from '@pkg/utils/typeUtils';

import type { ExtensionManager } from '.';

const console = Logging.extensions;
let manager: ExtensionManager | undefined;

getIpcMainProxy(console).handle('extension/install', (_, id) => {
  console.debug(`Trying to install ${ id }`);

  return false;
});

async function getExtensionManager(): Promise<ExtensionManager | undefined>;
async function getExtensionManager(client: ContainerEngineClient, cfg: RecursiveReadonly<Settings>): Promise<ExtensionManager>;
async function getExtensionManager(client?: ContainerEngineClient, cfg?: RecursiveReadonly<Settings>): Promise<ExtensionManager | undefined> {
  if (!client || manager?.client === client) {
    if (!client && !manager) {
      console.debug(`Warning: cached client missing, returning nothing`);
    }

    return manager;
  }

  if (!cfg) {
    throw new Error(`getExtensionaManager called without configuration`);
  }

  await manager?.shutdown();

  console.debug(`Creating new extension manager...`);
  manager = new ExtensionManagerImpl(client);

  await manager.init(cfg);

  return manager;
}

export default getExtensionManager;
