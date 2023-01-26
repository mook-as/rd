import fs from 'fs';
import path from 'path';

import Electron from 'electron';

import { Extension, ExtensionManager, ExtensionMetadata } from './index';

import type { ContainerEngineClient } from '@pkg/backend/containerEngine';
import type { Settings } from '@pkg/config/settings';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import mainEvents from '@pkg/main/mainEvents';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { defined, RecursiveReadonly } from '@pkg/utils/typeUtils';
import { openExtension } from '@pkg/window';

const console = Logging.extensions;
const ipcMain = getIpcMainProxy(console);

export class ExtensionImpl implements Extension {
  constructor(id: string, client: ContainerEngineClient) {
    this.id = id;
    this.client = client;
    this.dir = path.join(paths.extensionRoot, id);
  }

  /** The extension ID (the image ID) */
  id: string;
  /** The directory this extension will be installed into */
  protected readonly dir: string;
  protected readonly client: ContainerEngineClient;
  /** Extension metadata */
  protected _metadata: Promise<ExtensionMetadata> | undefined;

  get metadata(): Promise<ExtensionMetadata> {
    this._metadata ??= (async() => {
      const raw = await this.client.readFile(this.id, 'metadata.json');

      try {
        const parsed = JSON.parse(raw);

        parsed.vm ??= {};

        return parsed;
      } catch (ex) {
        console.error(raw);
        console.error(ex);
        throw ex;
      }
    })();

    return this._metadata as Promise<ExtensionMetadata>;
  }

  protected _iconName: Promise<string> | undefined;
  get iconName(): Promise<string> {
    this._iconName ??= (async() => {
      return `icon${ path.extname((await this.metadata).icon) }`;
    })();

    return this._iconName as Promise<string>;
  }

  protected get containerName() {
    return `rd-extension.${ this.id.replaceAll('/', '.').replace(/[^a-zA-Z0-9_.-]/g, '_') }`;
  }

  async install(): Promise<boolean> {
    const metadata = await this.metadata;

    await fs.promises.mkdir(this.dir, { recursive: true });
    await Promise.all([
      // Copy the metadata file; it's not required, but it's useful for
      // troubleshooting.
      fs.promises.writeFile(path.join(this.dir, 'metadata.json'), JSON.stringify(metadata, undefined, 2)),
      // Copy the icon
      (async() => {
        await this.client.copyFile(this.id, metadata.icon, path.join(this.dir, await this.iconName));
      })(),
      // Copy UI
      (async() => {
        const uiDir = path.join(this.dir, 'ui');

        if (!metadata.ui) {
          return;
        }

        await fs.promises.mkdir(uiDir, { recursive: true });
        await Promise.all(Object.entries(metadata.ui).map(async([name, data]) => {
          await this.client.copyFile(this.id, data.root, path.join(uiDir, name));
        }));
      })(),
      // Copy host executables
      (async() => {
        let plat: 'windows' | 'linux' | 'darwin' = 'windows';

        if (process.platform === 'linux' || process.platform === 'darwin') {
          plat = process.platform;
        } else if (process.platform !== 'win32') {
          throw new Error(`Platform ${ process.platform } is not supported`);
        }
        const binDir = path.join(this.dir, 'bin');

        await fs.promises.mkdir(binDir, { recursive: true });
        const binaries = metadata.host?.binaries ?? [];
        const paths = binaries.flatMap(p => p[plat]).map(b => b?.path).filter(defined);

        await Promise.all(paths.map(async(p) => {
          await this.client.copyFile(this.id, p, path.join(binDir, path.basename(p)));
        }));
      })(),
      // Run the containers
      (async() => {
        if ('image' in metadata.vm) {
          console.debug(`Running image ${ this.id }`);
          const stdout = await this.client.run(this.id, {
            namespace: 'rancher-desktop-extensions',
            name:      this.containerName,
            restart:   'always',
          });

          console.debug(`Running ${ this.id } container image: ${ stdout.trim() }`);
        } else if ('composefile' in metadata.vm) {
          console.error(`Running compose file is not implemented`);
        }
      })(),
    ]);

    mainEvents.emit('settings-write', { extensions: { [this.id]: metadata } });

    // TODO: Do something so the extension is recognized by the UI.
    console.debug(`Install ${ this.id }: install complete.`);

    return true;
  }

  async uninstall(): Promise<boolean> {
    const metadata = await this.metadata;
    const vm = metadata.vm;

    // TODO: Unregister the extension from the UI.

    if ('image' in vm) {
      await this.client.stop(this.containerName, {
        namespace: 'rancher-desktop-extensions',
        force:     true,
        delete:    true,
      });
    } else if ('composefile' in vm) {
      console.error(`Skipping uninstall of compose file when uninstalling ${ this.id }`);
    }

    try {
      await fs.promises.rmdir(this.dir, { recursive: true });
    } catch (ex: any) {
      if ((ex as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw ex;
      }
    }

    mainEvents.emit('settings-write', { extensions: { [this.id]: false } });

    return true;
  }

  async extractFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.client.copyFile(this.id, sourcePath, destinationPath);
  }

  async readFile(sourcePath: string): Promise<string> {
    return await this.client.readFile(this.id, sourcePath);
  }
}

export class ExtensionManagerImpl implements ExtensionManager {
  protected extensions: Record<string, ExtensionImpl> = {};

  constructor(client: ContainerEngineClient) {
    this.client = client;
  }

  client: ContainerEngineClient;

  async init(config: RecursiveReadonly<Settings>) {
    await Promise.all(Object.entries(config.extensions ?? {}).map(([id, install]) => {
      return this.getExtension(id)[install ? 'install' : 'uninstall']();
    }));
    ipcMain.on('extension/ui/dashboard', async(_, id) => {
      const extension = this.getExtension(id);
      const encodedID = id.replace(/./g, c => c.charCodeAt(0).toString(16));
      const baseURL = new URL(`x-rd-extension://${ encodedID }/ui/dashboard-tab/`);
      const uiInfo = (await extension.metadata).ui?.['dashboard-tab'];

      if (!uiInfo) {
        throw new Error(`Could not open extension ${ id }: no UI found`);
      }
      openExtension(id, new URL(uiInfo.src, baseURL).toString());
    });
    ipcMain.on('extension/open-external', (_, url) => {
      Electron.shell.openExternal(url);
    });
  }

  getExtension(id: string): Extension {
    let ext = this.extensions[id];

    if (!ext) {
      ext = new ExtensionImpl(id, this.client);
      this.extensions[id] = ext;
    }

    return ext;
  }

  shutdown() {
    // TODO
    return Promise.resolve();
  }
}
