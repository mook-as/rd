import fs from 'fs';
import path from 'path';

import { Extension, ExtensionManager, ExtensionMetadata } from './index';

import MobyClient from '@pkg/backend/mobyClient';
import paths from '@pkg/utils/paths';

export class MobyExtension implements Extension {
  constructor(id: string, client: MobyClient) {
    this.id = id;
    this.client = client;
    this.dir = path.join(paths.extensionRoot, id);
  }

  /** The extension ID (the image ID) */
  id: string;
  /** The directory this extension will be installed into */
  protected readonly dir: string;
  protected readonly client: MobyClient;
  /** Extension metadata */
  protected _metadata: Promise<ExtensionMetadata> | undefined;

  get metadata(): Promise<ExtensionMetadata> {
    this._metadata ??= (async() => {
      return JSON.parse(await this.client.readFile(this.id, 'metadata.json'));
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

  async install(): Promise<boolean> {
    const INSTALLED_MARKER = 'install-complete';

    try {
      await fs.promises.access(path.join(this.dir, INSTALLED_MARKER), fs.constants.R_OK);

      return false;
    } catch (ex) {
      // Extension was not installed, do it now.
    }

    await fs.promises.mkdir(this.dir, { recursive: true });
    await Promise.all([
      // Copy the icon
      (async() => {
        await this.client.copyFile(this.id, (await this.metadata).icon, path.join(this.dir, await this.iconName));
      })(),
      // Copy UI
      (async() => {
        const uiDir = path.join(this.dir, 'ui');

        await fs.promises.mkdir(uiDir, { recursive: true });
        await Promise.all(Object.entries((await this.metadata).ui ?? {}).map(async([name, data]) => {
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
        const binaries = (await this.metadata).host?.binaries ?? [];
        const paths = binaries.map(b => b[plat].path);

        await Promise.all(paths.map(async(p) => {
          await this.client.copyFile(this.id, p, path.join(binDir, path.basename(p)));
        }));
      })(),
      // Run the containers
      (async() => {
        const vm: { image: string } | { composefile: string } | {} = (await this.metadata).vm ?? {};

        if ('image' in vm) {
        } else if ('composefile' in vm) {
        }
      })(),
    ]);

    throw new Error('Method not implemented.');
  }

  uninstall(): Promise<boolean> {
    throw new Error('Method not implemented.');
  }

  async extractFile(sourcePath: string, destinationPath: string): Promise<void> {
    await this.client.copyFile(this.id, sourcePath, destinationPath);
  }

  async readFile(sourcePath: string): Promise<string> {
    return await this.client.readFile(this.id, sourcePath);
  }
}

export class MobyExtensionManager implements ExtensionManager {
  protected extensions: Record<string, MobyExtension> = {};

  constructor(client: MobyClient) {
    this.client = client;
  }

  client: MobyClient;

  getExtension(id: string): Extension {
    let ext = this.extensions[id];

    if (!ext) {
      ext = new MobyExtension(id, this.client);
      this.extensions[id] = ext;
    }

    return ext;
  }
}
