import fs from 'fs';
import path from 'path';

import _ from 'lodash';

import { defaultSettings } from './defaults';
import migrateSettings from './migrate';
import settingsLayerTransient from './transient';
import { WritableSettingsLayer } from './types';
import userSettingsValidator from './userValidator';
import { SettingsLike, SettingsValidator, ValidatorReturn } from './validator';

import paths from '@pkg/utils/paths';
import {
  RecursiveKeys, RecursivePartial, RecursivePartialReadonly, RecursiveReadonly, RecursiveTypes,
} from '@pkg/utils/typeUtils';

/**
 * SettingsLayerUser handles user settings (i.e. the ones that can be written).
 */
export class SettingsLayerUser<T extends SettingsLike> implements WritableSettingsLayer<T> {
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

      this.settings = migrateSettings(JSON.parse(rawData)) as RecursivePartial<T>;
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

  get<K extends RecursiveKeys<T>>(key: K): RecursiveTypes<T>[K] | undefined {
    return _.get(this.settings ?? {}, key, undefined);
  }

  getAll() {
    return this.settings ?? {};
  }

  set<K extends RecursiveKeys<T>>(key: K, value: RecursiveTypes<T>[K]): Promise<boolean> {
    if (this.settings === undefined) {
      throw new Error('Cannot set user settings before loading');
    }
    if (_.has(this.defaults, key)) {
      _.set(this.settings, key, value);

      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  merge(changes: RecursivePartialReadonly<T>): Promise<ValidatorReturn> {
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
    const validationResult = this.validator.validateSettings(_.merge({}, this.defaults, this.settings), changes);

    if (validationResult.errors.length > 0) {
      return Promise.resolve(validationResult);
    }
    // Because this has passed validation already, it is safe to just merge the
    // changes in directly.
    _.mergeWith(this.settings, changes, customizer);

    return Promise.resolve(validationResult);
  }
}

const settingsLayerUser = new SettingsLayerUser(defaultSettings, userSettingsValidator);

export default settingsLayerUser;
