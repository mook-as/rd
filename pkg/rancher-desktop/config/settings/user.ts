import fs from 'fs';
import path from 'path';

import _ from 'lodash';

import { UserSettings, defaultSettings } from './defaults';
import migrateSettings, { isVersionedSetting } from './migrate';
import settingsLayerTransient from './transient';
import {
  IsSettingLeaf, SettingLeaf, SettingsLike, ValidatorReturn, VersionedSettingsLike,
} from './types';
import userSettingsValidator from './userValidator';
import { SettingsValidator } from './validator';

import paths from '@pkg/utils/paths';
import {
  RecursiveKeys, RecursivePartial, RecursivePartialReadonly, RecursiveReadonly, RecursiveTypes,
} from '@pkg/utils/typeUtils';

export type VersionedSettings = VersionedSettingsLike<UserSettings>;
export type PartialVersionedSettings = VersionedSettingsLike<RecursivePartial<UserSettings>>;

function WrapSubtree<T extends SettingsLike>(input: T, validator: SettingsValidator<T>): T {
  const wrappers: Partial<T> = {};

  function get<K extends keyof T>(target: T, p: K): T[K] {
    type SettingsLikeValue = Extract<T[K], SettingsLike>;
    const value = target[p];

    if (value === undefined || IsSettingLeaf(value)) {
      return value;
    }
    const validationWrapper: SettingsValidator<SettingsLikeValue> = {
      validateSettings(currentSettings, lockedSettings, newSettings) {
        throw new Error('not implemented');
      },
    };

    wrappers[p] ||= WrapSubtree<SettingsLikeValue>(value as SettingsLikeValue, validationWrapper);

    return wrappers[p] as Exclude<T[K], undefined>;
  }

  return new Proxy(input, {
    get(target, p) {
      if (typeof p !== 'string') {
        throw new TypeError('Symbols are not allowed');
      }

      return get(target, p);
    },
  });
}

/**
 * SettingsLayerUser handles user settings (i.e. the ones that can be written).
 */
export class ZSettingsLayerUser<T extends SettingsLike> {
  protected readonly defaults: RecursiveReadonly<T>;
  protected readonly validator: SettingsValidator<T>;
  protected settings?: RecursivePartial<T>;
  protected readonly settingsPath = path.join(paths.config, 'settings.json');

  constructor(defaults: T, validator: SettingsValidator<T>) {
    this.defaults = defaults;
    this.validator = validator;
  }

  /**
   * Load settings from disk.
   */
  async load() {
    try {
      const rawData = await fs.promises.readFile(this.settingsPath, 'utf-8');
      const parsedData = JSON.parse(rawData);

      if (!isVersionedSetting(parsedData)) {
        parsedData.version = 0;
      }
      this.settings = migrateSettings(parsedData) as RecursivePartial<T>;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        // The settings file doesn't exist -- assume this is first run.
        settingsLayerTransient.set('application.isFirstRun', true);
      } else {
        throw err;
      }
    }
  }

  /**
   * Save settings to disk.
   */
  async save() {
    await fs.promises.mkdir(path.dirname(this.settingsPath), { recursive: true });
    await fs.promises.writeFile(this.settingsPath, JSON.stringify(this.settings ?? {}), 'utf-8');
  }

  get() {
    return WrapSubtree(this.settings ?? {}, this.validator);
  }

  merge(changes: RecursivePartialReadonly<T>): void {
    /**
     * Customizer for use with _.mergeWith; the notable differences are:
     * - For arrays, we overwrite rather than append.
     * - If the new value is null or undefined, we delete instead.
     */
    const customizer = (objValue: any, srcValue: any) => {
      if (Array.isArray(objValue)) {
        // If the destination is a array of primitives, just return the source
        // (i.e. completely overwrite).
        if (objValue.every(i => typeof i !== 'object')) {
          return srcValue;
        }
      }
      if (typeof srcValue === 'object' && srcValue) {
        // For objects, setting a value to `undefined` or `null` will remove it.
        for (const [key, value] of Object.entries(srcValue)) {
          if (typeof value === 'undefined' || value === null) {
            delete srcValue[key];
            if (typeof objValue === 'object' && objValue) {
              delete objValue[key];
            }
          }
        }
        // Don't return anything, let _.mergeWith() do the actual merging.
      }
    };

    if (this.settings === undefined) {
      throw new Error('Cannot set user settings before loading');
    }
    // Because this has passed validation already, it is safe to just merge the
    // changes in directly.
    _.mergeWith(this.settings, changes, customizer);
  }
}

const settingsLayerUser = new SettingsLayerUser(defaultSettings, userSettingsValidator);

export default settingsLayerUser;
