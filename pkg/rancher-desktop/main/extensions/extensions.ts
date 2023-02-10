import fs from 'fs';
import os from 'os';
import path from 'path';

import Electron from 'electron';
import _ from 'lodash';

import type { ContainerEngineClient } from '@pkg/backend/containerEngine';
import type { Settings } from '@pkg/config/settings';
import { getIpcMainProxy } from '@pkg/main/ipcMain';
import mainEvents from '@pkg/main/mainEvents';
import type { IpcMainEvents, IpcMainInvokeEvents } from '@pkg/typings/electron-ipc';
import * as childProcess from '@pkg/utils/childProcess';
import fetch, { RequestInit } from '@pkg/utils/fetch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';
import { executable } from '@pkg/utils/resources';
import { defined, RecursiveReadonly } from '@pkg/utils/typeUtils';
import { openExtension } from '@pkg/window';

import type {
  Extension, ExtensionManager, ExtensionMetadata, SpawnOptions, SpawnResult,
} from './types';
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';

const console = Logging.extensions;
const ipcMain = getIpcMainProxy(console);

/* eslint @typescript-eslint/switch-exhaustiveness-check: "error" */

class ExtensionImpl implements Extension {
  constructor(id: string, client: ContainerEngineClient) {
    this.id = id;
    this.client = client;
    this.dir = path.join(paths.extensionRoot, id);
  }

  /** The extension ID (the image ID) */
  id: string;
  /** The directory this extension will be installed into */
  readonly dir: string;
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

type IpcMainEventListener<K extends keyof IpcMainEvents> =
  (event: IpcMainEvent, ...args: Parameters<IpcMainEvents[K]>) => void;

type IpcMainEventHandler<K extends keyof IpcMainInvokeEvents> =
  (event: IpcMainInvokeEvent, ...args: Parameters<IpcMainInvokeEvents[K]>) =>
    Promise<ReturnType<IpcMainInvokeEvents[K]>> | ReturnType<IpcMainInvokeEvents[K]>;

export class ExtensionManagerImpl implements ExtensionManager {
  protected extensions: Record<string, ExtensionImpl> = {};

  constructor(client: ContainerEngineClient) {
    this.client = client;
  }

  client: ContainerEngineClient;

  /**
   * Mapping of event listeners we used with ipcMain.on(), which will be used
   * to ensure we unregister them correctly.
   */
  protected eventListeners: {
    [channel in keyof IpcMainEvents]?: IpcMainEventListener<channel>;
  } = {};

  protected eventHandlers: {
    [channel in keyof IpcMainInvokeEvents]?: IpcMainEventHandler<channel>;
  } = {};

  /**
   * Attach a listener to ipcMainEvents that will be torn down when this
   * extension manager shuts down.
   * @note Only one listener per topic is supported.
   */
  protected setMainListener<K extends keyof IpcMainEvents>(channel: K, listener: IpcMainEventListener<K>) {
    const oldListener = this.eventListeners[channel] as IpcMainEventListener<K> | undefined;

    if (oldListener) {
      console.error(`Removing duplicate event listener for ${ channel }`);
      ipcMain.removeListener(channel, oldListener);
    }
    this.eventListeners[channel] = listener as any;
    ipcMain.on(channel, listener);
  }

  protected setMainHandler<K extends keyof IpcMainInvokeEvents>(channel: K, handler: IpcMainEventHandler<K>) {
    const oldHandler = this.eventHandlers[channel];

    if (oldHandler) {
      console.error(`Removing duplicate event listener for ${ channel }`);
      ipcMain.removeHandler(channel);
    }
    this.eventHandlers[channel] = handler as any;
    ipcMain.handle(channel, handler);
  }

  async init(config: RecursiveReadonly<Settings>) {
    this.setMainListener('extension/ui/dashboard', async(_, id) => {
      const extension = this.getExtension(id);
      const encodedID = id.replace(/./g, c => c.charCodeAt(0).toString(16));
      const baseURL = new URL(`x-rd-extension://${ encodedID }/ui/dashboard-tab/`);
      const uiInfo = (await extension.metadata).ui?.['dashboard-tab'];

      if (!uiInfo) {
        throw new Error(`Could not open extension ${ id }: no UI found`);
      }
      openExtension(id, new URL(uiInfo.src, baseURL).toString());
    });

    this.setMainListener('extension/open-external', (_, url) => {
      Electron.shell.openExternal(url);
    });

    this.setMainListener('extension/spawn/streaming', (event, options) => {
      switch (options.scope) {
      case 'host':
        return this.spawnHostStreaming(event, this.convertHostOptions(options));
      case 'docker-cli':
        return this.spawnHostStreaming(event, this.convertDockerCliOptions(options));
      case 'vm':
        return;
      case 'container':
        return;
      }
      console.error(`Unexpected scope ${ options.scope }`);
      throw new Error(`Unexpected scope ${ options.scope }`);
    });
    this.setMainHandler('extension/spawn/blocking', (event, options) => {
      switch (options.scope) {
      case 'host':
        return this.spawnHostBlocking(this.convertHostOptions(options));
      case 'docker-cli':
        return this.spawnHostBlocking(this.convertDockerCliOptions(options));
      case 'vm':
        return {} as any;
      case 'container':
        return {} as any;
      }
      console.error(`Unexpected scope ${ options.scope }`);
      throw new Error(`Unexpected scope ${ options.scope }`);
    });
    this.setMainHandler('extension/dialog/showOpenDialog', (event, options) => {
      const window = Electron.BrowserWindow.fromWebContents(event.sender);

      if (window) {
        return Electron.dialog.showOpenDialog(window, options);
      }

      return Electron.dialog.showOpenDialog(options);
    });
    this.setMainListener('extension/ui/toast', (event, level, message) => {
      const notification = new Electron.Notification({
        title: level.replace(/^./, c => c.toUpperCase()),
        body:  message,
      });

      notification.show();
    });
    this.setMainHandler('extension/vm/httpFetch', async(event, config) => {
      const url = new URL(config.url);
      const options: RequestInit = {
        method:  config.method,
        headers: config.headers ?? {},
        body:    config.data,
      };
      const response = await fetch(url.toString(), options);

      return await response.text();
    });

    await Promise.all(Object.entries(config.extensions ?? {}).map(([id, install]) => {
      const op = install ? 'install' : 'uninstall';

      try {
        this.getExtension(id)[op]();
      } catch (ex) {
        console.error(`Failed to ${ op } extensino ${ id }`, ex);
      }
    }));
  }

  getExtension(id: string): Extension {
    let ext = this.extensions[id];

    if (!ext) {
      ext = new ExtensionImpl(id, this.client);
      this.extensions[id] = ext;
    }

    return ext;
  }

  protected convertHostOptions(options: SpawnOptions): SpawnOptions {
    const extension = this.getExtension(options.extension) as ExtensionImpl;
    const exeExtension = process.platform === 'win32' ? '.exe' : '';
    const exePath = path.join(extension.dir, 'bin', options.command[0]) + exeExtension;

    return {
      ...options,
      command: [exePath, ...options.command.slice(1)],
    };
  }

  protected convertDockerCliOptions(options: SpawnOptions): SpawnOptions {
    return {
      ...options,
      command: [executable('docker'), ...options.command],
    };
  }

  protected spawnHostBlocking(options: SpawnOptions): Promise<SpawnResult> {
    const args = options.command.concat();
    const exePath = args.shift();

    if (!exePath) {
      throw new Error(`no executable given`);
    }

    return new Promise((resolve) => {
      childProcess.execFile(exePath, args, { ..._.pick(options, ['cwd', 'env']) }, (error, stdout, stderr) => {
        resolve({
          command: options.command.join(' '),
          killed:  true,
          result:  error?.signal ?? error?.code ?? 0,
          stdout,
          stderr,
        });
      });
    });
  }

  protected spawnHostStreaming(event: IpcMainEvent, options: SpawnOptions) {
    const args = options.command.concat();
    const exePath = args.shift();

    if (!exePath) {
      throw new Error(`no executable given`);
    }

    const proc = childProcess.spawn(exePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ..._.pick(options, ['cwd', 'env']),
    });
    let errored = false;

    proc.stdout.on('data', (stdout: string | Buffer) => {
      event.senderFrame.send('extension/spawn/output', options.id, { stdout: stdout.toString('utf-8') });
    });
    proc.stderr.on('data', (stderr: string | Buffer) => {
      event.senderFrame.send('extension/spawn/output', options.id, { stderr: stderr.toString('utf-8') });
    });
    proc.on('error', (error) => {
      errored = true;
      event.senderFrame.send('extension/spawn/error', options.id, error);
    });
    proc.on('exit', (code, signal) => {
      if (errored) {
        return;
      }
      if (code !== null ) {
        event.senderFrame.send('extension/spawn/close', options.id, code);
      } else {
        errored = true;
        event.senderFrame.send('extension/spawn/error', options.id, signal);
      }
    });
  }

  protected spawnVM(command: string[], options: SpawnOptions) {

  }

  shutdown() {
    // Remove our event listeners (to avoid issues when we switch backends).
    for (const untypedChannel in this.eventListeners) {
      const channel = untypedChannel as keyof IpcMainEvents;
      const listener = this.eventListeners[channel] as IpcMainEventListener<typeof channel>;

      ipcMain.removeListener(channel, listener);
    }

    for (const untypedChannel in this.eventHandlers) {
      ipcMain.removeHandler(untypedChannel as keyof IpcMainInvokeEvents);
    }

    return Promise.resolve();
  }
}

ipcMain.handle('extension/info', () => {
  return {
    platform: process.platform,
    arch:     Electron.app.runningUnderARM64Translation ? 'arm64' : process.arch,
    hostname: os.hostname(),
  };
});
