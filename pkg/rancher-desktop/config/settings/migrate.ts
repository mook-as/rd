import { UserSettings } from './defaults';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { RecursivePartial } from '@pkg/utils/typeUtils';

const CURRENT_SETTINGS_VERSION = 10;

/**
 * Provide a mapping from settings version to a function used to update the
 * settings object to the next version.
 *
 * The main use-cases are for renaming property names, correct values that are
 * no longer valid, and removing obsolete entries. The final step merges in
 * current defaults, so we won't need an entry for every version change, as
 * most changes will get picked up from the defaults.
 */
const updateTable: Record<number, (settings: any) => void> = {
  1: (settings) => {
    // Implement setting change from version 3 to 4
    if ('rancherMode' in settings.kubernetes) {
      delete settings.kubernetes.rancherMode;
    }
  },
  2: (_) => {
    // No need to still check for and delete archaic installations from version 0.3.0
    // The updater still wants to see an entry here (for updating ancient systems),
    // but will no longer delete obsolete files.
  },
  3: (_) => {
    // With settings v5, all traces of the kim builder are gone now, so no need to update it.
  },
  4: (settings) => {
    settings.application = {
      adminAccess:            !settings.kubernetes.suppressSudo,
      debug:                  settings.debug,
      pathManagementStrategy: settings.pathManagementStrategy,
      telemetry:              { enabled: settings.telemetry },
      updater:                { enabled: settings.updater },
    };
    settings.virtualMachine = {
      hostResolver: settings.kubernetes.hostResolver,
      memoryInGB:   settings.kubernetes.memoryInGB,
      numberCPUs:   settings.kubernetes.numberCPUs,
    };
    settings.experimental = { virtualMachine: { socketVMNet: settings.kubernetes.experimental.socketVMNet } };
    settings.WSL = { integrations: settings.kubernetes.WSLIntegrations };
    settings.containerEngine.name = settings.kubernetes.containerEngine;

    delete settings.kubernetes.containerEngine;
    delete settings.kubernetes.experimental;
    delete settings.kubernetes.hostResolver;
    delete settings.kubernetes.checkForExistingKimBuilder;
    delete settings.kubernetes.memoryInGB;
    delete settings.kubernetes.numberCPUs;
    delete settings.kubernetes.suppressSudo;
    delete settings.kubernetes.WSLIntegrations;

    delete settings.debug;
    delete settings.pathManagementStrategy;
    delete settings.telemetry;
    delete settings.updater;
  },
  5: (settings) => {
    if (settings.containerEngine.imageAllowList) {
      settings.containerEngine.allowedImages = settings.containerEngine.imageAllowList;
      delete settings.containerEngine.imageAllowList;
    }
    if (settings.virtualMachine.experimental) {
      if ('socketVMNet' in settings.virtualMachine.experimental) {
        settings.experimental = { virtualMachine: { socketVMNet: settings.virtualMachine.experimental.socketVMNet } };
        delete settings.virtualMachine.experimental.socketVMNet;
      }
      delete settings.virtualMachine.experimental;
    }
    for (const field of ['autoStart', 'hideNotificationIcon', 'startInBackground', 'window']) {
      if (field in settings) {
        settings.application[field] = settings[field];
        delete settings[field];
      }
    }
  },
  6: (settings) => {
    // Rancher Desktop 1.9+
    // extensions went from Record<string, boolean> to Record<string, string>
    // The key used to be the extension image (including tag); it's now keyed
    // by the image (without tag) with the value being the tag.
    const withTags = Object.entries(settings.extensions ?? {}).filter(([, v]) => v).map(([k]) => k);
    const extensions = withTags.map((image) => {
      return image.split(':', 2).concat('latest').slice(0, 2) as [string, string];
    });

    settings.extensions = Object.fromEntries(extensions);
  },
  7: (settings) => {
    if (settings.application.pathManagementStrategy === 'notset') {
      if (process.platform === 'win32') {
        settings.application.pathManagementStrategy = PathManagementStrategy.Manual;
      } else {
        settings.application.pathManagementStrategy = PathManagementStrategy.RcFiles;
      }
    }
  },
  8: (settings) => {
    // Rancher Desktop 1.10: move .extensions to .application.extensions.installed
    if (settings.extensions) {
      settings.application ??= {};
      settings.application.extensions ??= {};
      settings.application.extensions.installed = settings.extensions;
      delete settings.extensions;
    }
  },
  9: (settings) => {
    // Rancher Desktop 1.11
    // Use string-list component instead of textarea for noproxy field. Blanks that
    // were accepted by the textarea need to be filtered out.
    if (settings.experimental.virtualMachine.proxy.noproxy.length > 0) {
      settings.experimental.virtualMachine.proxy.noproxy =
        settings.experimental.virtualMachine.proxy.noproxy.map((entry: string) => {
          return entry.trim();
        }).filter((entry: string) => {
          return entry.length > 0;
        });
    }
  },
};

/**
 * Migrate the stored settings.
 */
export default function migrateSettings(settings: any): RecursivePartial<UserSettings> {
  if (typeof settings !== 'object' || Object.keys(settings || {}).length === 0) {
    return {};
  }

  let currentVersion = settings.version || 0;

  if (currentVersion > CURRENT_SETTINGS_VERSION) {
    // We've loaded a setting file from the future, so some settings will be ignored.
    // Try not to step on them.
    // Note that this file will have an older version field but some fields from the future.
    console.log(`Running settings version ${ CURRENT_SETTINGS_VERSION } but loaded a settings file for version ${ settings.version }: some settings will be ignored`);
  }

  for (; currentVersion < CURRENT_SETTINGS_VERSION; currentVersion++) {
    const migrator = updateTable[currentVersion] || (() => {});

    migrator(settings);
  }
  settings.version = CURRENT_SETTINGS_VERSION;

  return settings;
}
