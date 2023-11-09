import _ from 'lodash';

import { SettingsLike, VersionedSettingsLike } from './types';
import { PartialVersionedSettings, VersionedSettings } from './user';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { RecursivePartial } from '@pkg/utils/typeUtils';

export const CURRENT_SETTINGS_VERSION = 10;

/**
 * A migration function describes how to migration from one version to the next.
 * @note The given settings may be partial.
 */
type MigrationFunction = (settings: SettingsLike) => void;

/** Symbol for migrate() to indicate a setting should be deleted. */
const DELETE = Symbol('delete');

/**
 * Migrate an individual setting.
 * @param settings The settings object to mutate.
 * @param oldKey The key to migrate from.
 * @param newKey The key to migrate; or the constant DELETE to delete without migrating.
 * @param convert Optional function to mutate the value during migration.
 * @note If the old key is an empty object, it is deleted automatically.
 */
function migrate(settings: SettingsLike, oldKey: string, newKey: string | typeof DELETE, convert?: (input: any) => any) {
  const parentPath = _.toPath(oldKey);
  let leafPath = parentPath.pop() as string;
  let parent = _.get(settings, parentPath);

  if (typeof parent !== 'object' || !parent || !(leafPath in parent)) {
    return;
  }

  const value = parent[leafPath];

  if (newKey !== DELETE) {
    _.set(settings, newKey, convert?.(value) ?? value);
  }

  if (oldKey === newKey) {
    return; // In-place manipulation, don't delete it.
  }
  delete parent[leafPath];

  while (parent !== settings && Object.keys(parent).length === 0) {
    leafPath = parentPath.pop() as string;
    parent = _.get(settings, parentPath);
    delete parent[leafPath];
  }
}

/**
 * Provide a mapping from settings version to a function used to update the
 * settings object to the next version.
 *
 * The main use-cases are for renaming property names, correct values that are
 * no longer valid, and removing obsolete entries. The final step merges in
 * current defaults, so we won't need an entry for every version change, as
 * most changes will get picked up from the defaults.
 */
const updateTable: Record<number, MigrationFunction> = {
  1: (settings) => {
    migrate(settings, 'kubernetes.rancherMode', DELETE);
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
    migrate(settings, 'kubernetes.suppressSudo', 'application.adminAccess', x => !x);
    migrate(settings, 'debug', 'application.debug');
    migrate(settings, 'pathManagementStrategy', 'application.pathManagementStrategy');
    migrate(settings, 'telemetry', 'application.telemetry.enabled');
    migrate(settings, 'updater', 'application.updater.enabled');
    migrate(settings, 'kubernetes.hostResolver', 'virtualMachine.hostResolver');
    migrate(settings, 'kubernetes.memoryInGB', 'virtualMachine.memoryInGB');
    migrate(settings, 'kubernetes.numberCPUs', 'virtualMachine.numberCPUs');
    migrate(settings, 'kubernetes.experimental.socketVMNet', 'experimental.virtualMachine.socketVMNet');
    migrate(settings, 'kubernetes.WSLIntegrations', 'WSL.integrations');
    migrate(settings, 'kubernetes.containerEngine', 'containerEngine.name');
  },
  5: (settings) => {
    migrate(settings, 'containerEngine.imageAllowList', 'containerEngine.allowedImages');
    migrate(settings, 'virtualMachine.experimental.socketVMNet', 'experimental.virtualMachine.socketVMNet');
    migrate(settings, 'autoStart', 'application.autoStart');
    migrate(settings, 'hideNotificationIcon', 'application.hideNotificationIcon');
    migrate(settings, 'startInBackground', 'application.startInBackground');
    migrate(settings, 'window', 'application.window');
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
    migrate(settings, 'application.pathManagementStrategy', 'application.pathManagementStrategy', (oldValue) => {
      if (oldValue !== 'notset') {
        return oldValue;
      }

      return process.platform === 'win32' ? PathManagementStrategy.Manual : PathManagementStrategy.RcFiles;
    });
  },
  8: (settings) => {
    // Rancher Desktop 1.10: move .extensions to .application.extensions.installed
    migrate(settings, 'extensions', 'application.extensions.instaled');
  },
  9: (settings) => {
    // Rancher Desktop 1.11
    // Use string-list component instead of textarea for noproxy field. Blanks that
    // were accepted by the textarea need to be filtered out.
    migrate(settings, 'experimental.virtualMachine.proxy.noproxy', 'experimental.virtualMachine.proxy.noproxy', (oldValue: string[]) => {
      oldValue.map(entry => entry.trim()).filter(entry => entry.length > 0);
    });
  },
};

/**
 * Migrate the stored settings.
 */
export default function migrateSettings(settings: VersionedSettingsLike): PartialVersionedSettings {
  let currentVersion = settings.version;

  if (currentVersion > CURRENT_SETTINGS_VERSION) {
    // We've loaded a setting file from the future, so some settings will be ignored.
    // Try not to step on them.
    // Note that this file will have an older version field but some fields from the future.
    console.log(`Running settings version ${ CURRENT_SETTINGS_VERSION } but loaded a settings file for version ${ settings.version }: some settings will be ignored`);
  }

  for (; currentVersion < CURRENT_SETTINGS_VERSION; currentVersion++) {
    const migrator = updateTable[currentVersion] || (() => undefined);

    migrator(settings);
  }
  settings.version = CURRENT_SETTINGS_VERSION;

  return settings as PartialVersionedSettings;
}

export function isVersionedSetting(settings: any): settings is VersionedSettingsLike {
  switch (true) {
  case typeof settings !== 'object':
  case Object.keys(settings || {}).length === 0:
  case !('version' in settings):
  case typeof settings.version !== 'number':
  case settings.version < 0:
    return false;
  }

  return true;
}
