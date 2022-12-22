/**
 * This module describes the various paths we use to store state & data.
 */

import os from 'os';
import path from 'path';

import electron from 'electron';

const APP_NAME = 'rancher-desktop';

export interface Paths {
  /** appHome: the location of the main appdata directory. */
  readonly appHome: string;
  /** altAppHome is a secondary directory for application data. */
  readonly altAppHome: string;
  /** Directory which holds configuration. */
  readonly config: string;
  /** Directory which holds logs. */
  readonly logs: string;
  /** Directory which holds caches that may be removed. */
  readonly cache: string;
  /** Directory holding the WSL distribution (Windows-specific). */
  readonly wslDistro: string;
  /** Directory holding the WSL data distribution (Windows-specific). */
  readonly wslDistroData: string;
  /** Directory holding Lima state (macOS-specific). */
  readonly lima: string;
  /** Directory holding provided binary resources */
  readonly integration: string;
  /** The directory that used to hold provided binary integrations */
  readonly oldIntegration: string;
  /** Directory that holds resource files in the RD installation. */
  readonly resources: string;
  /** Directory that will hold installed extension resources */
  readonly extensionRoot: string;
}

/**
 * Provides the `resources` key for any class that extends it.
 */
class ProvidesResources {
  get resources(): string {
    const basePath = electron.app.isPackaged ? process.resourcesPath : electron.app.getAppPath();

    return path.join(basePath, 'resources');
  }
}

/**
 * DarwinPaths implements paths for Darwin / macOS.
 */
export class DarwinPaths extends ProvidesResources implements Paths {
  readonly appHome = path.join(os.homedir(), 'Library', 'Application Support', APP_NAME);
  readonly altAppHome = path.join(os.homedir(), '.rd');
  readonly config = path.join(os.homedir(), 'Library', 'Preferences', APP_NAME);
  readonly logs = process.env.RD_LOGS_DIR ?? path.join(os.homedir(), 'Library', 'Logs', APP_NAME);
  readonly cache = path.join(os.homedir(), 'Library', 'Caches', APP_NAME);
  readonly lima = path.join(this.appHome, 'lima');
  readonly oldIntegration = '/usr/local/bin';
  readonly integration = path.join(this.altAppHome, 'bin');
  readonly extensionRoot = path.join(this.appHome, 'extensions');

  get wslDistro(): string {
    throw new Error('wslDistro not available for darwin');
  }

  get wslDistroData(): string {
    throw new Error('wslDistro not available for darwin');
  }
}

/**
 * Win32Paths implements paths for Windows.
 * Note that this should be kept in sync with .../pkg/rancher-desktop/go/wsl-helper/pkg/reset.
 */
export class Win32Paths extends ProvidesResources implements Paths {
  protected readonly appData = process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming');
  protected readonly localAppData = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
  readonly appHome = path.join(this.appData, APP_NAME);
  readonly altAppHome = this.appHome;
  readonly config = path.join(this.appData, APP_NAME);
  readonly logs = process.env.RD_LOGS_DIR ?? path.join(this.localAppData, APP_NAME, 'logs');
  readonly cache = path.join(this.localAppData, APP_NAME, 'cache');
  readonly wslDistro = path.join(this.localAppData, APP_NAME, 'distro');
  readonly wslDistroData = path.join(this.localAppData, APP_NAME, 'distro-data');
  readonly extensionRoot = path.join(this.localAppData, APP_NAME, 'extensions');

  get lima(): string {
    throw new Error('lima not available for Windows');
  }

  get oldIntegration(): string {
    throw new Error('Internal error: oldIntegration path not available for Windows');
  }

  get integration(): string {
    throw new Error('Internal error: integration path not available for Windows');
  }
}

/**
 * LinuxPaths implements paths for Linux.
 */
export class LinuxPaths extends ProvidesResources implements Paths {
  protected readonly dataHome = process.env['XDG_DATA_HOME'] || path.join(os.homedir(), '.local', 'share');
  protected readonly configHome = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
  protected readonly cacheHome = process.env['XDG_CACHE_HOME'] || path.join(os.homedir(), '.cache');
  readonly appHome = path.join(this.configHome, APP_NAME);
  readonly altAppHome = path.join(os.homedir(), '.rd');
  readonly config = path.join(this.configHome, APP_NAME);
  readonly logs = process.env.RD_LOGS_DIR ?? path.join(this.dataHome, APP_NAME, 'logs');
  readonly cache = path.join(this.cacheHome, APP_NAME);
  readonly lima = path.join(this.dataHome, APP_NAME, 'lima');
  readonly integration = path.join(this.altAppHome, 'bin');
  readonly oldIntegration = path.join(os.homedir(), '.local', 'bin');
  readonly extensionRoot = path.join(this.dataHome, APP_NAME, 'extensions');

  get wslDistro(): string {
    throw new Error('wslDistro not available for Linux');
  }

  get wslDistroData(): string {
    throw new Error('wslDistro not available for Linux');
  }
}

const UnsupportedPaths: Paths = new Proxy({} as Paths, {
  get(target, prop) {
    throw new Error(`Paths ${ String(prop) } not available for ${ os.platform() }`);
  },
});

function getPaths(): Paths {
  switch (os.platform()) {
  case 'darwin':
    return new DarwinPaths();
  case 'win32':
    return new Win32Paths();
  case 'linux':
    return new LinuxPaths();
  default:
    return UnsupportedPaths;
  }
}

export default getPaths();
