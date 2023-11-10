import _ from 'lodash';

import settingsLayerDefaults, { PartialUserSettings, UserSettings } from './defaults';
import settingsLayerDeploymentProfile from './deploymentProfiles';
import settingsLayerTransient, { TransientSettings } from './transient';
import { SettingsLayer, ValidatorReturn } from './types';
import settingsLayerUser from './user';

import {
  RecursiveKeys, RecursivePartial, RecursivePartialReadonly, RecursiveReadonly, RecursiveTypes,
} from '@pkg/utils/typeUtils';

export type Settings = UserSettings & TransientSettings;

/**
 * SettingsManager handles the various layers of settings, so that the correct
 * value is fetched.
 *
 * The various load* functions should be called in the order they are listed in
 * the class definition.
 */
export class SettingsManager implements SettingsLayer<Settings> {
  /**
   * Load transient values.  This is typically values that are set from the
   * command line.
   */
  loadTransient(values: RecursivePartial<TransientSettings>) {
    return this.transientLayer.merge(values);
  }

  /**
   * Load deployment profiles.  This provides administrator-managed defaults
   * and overrides.
   */
  async loadDeploymentProfiles() {}

  /**
   * Load user settings from disk.
   */
  async loadUser() {
    await this.userLayer.load();
  }

  protected lockedLayer = settingsLayerDeploymentProfile.locked;
  protected transientLayer = settingsLayerTransient;
  protected userLayer = settingsLayerUser;

  /**
   * The settings layers, in descreasing order of preference.
   */
  protected *getLayers() {
    yield this.lockedLayer;
    yield this.transientLayer;
    yield this.userLayer;
    yield settingsLayerDeploymentProfile.defaults;
    yield settingsLayerDefaults;
  }

  get<K extends RecursiveKeys<Settings>>(key: K): RecursiveTypes<Settings>[K] {
    let merged: Record<string, any> = {};

    for (const layer of this.getLayers()) {
      const result = (layer as any).get(key);

      if (result === undefined) {
        continue;
      }
      if (typeof result === 'object' && result) {
        // Make sure that the old value takes precedence.
        merged = _.merge({}, result, merged);
      } else {
        return result;
      }
    }

    return merged as RecursiveTypes<Settings>[K];
  }

  getSnapshot(): RecursiveReadonly<Settings> {
    const merged: RecursivePartial<Settings> = {};

    // If the key is undefined, return all settings.
    for (const layer of this.getLayers()) {
      _.merge({}, layer.getSnapshot(), merged);
    }

    return merged as RecursiveReadonly<Settings>;
  }

  getLocked(): PartialUserSettings {
    return this.lockedLayer.getSnapshot();
  }

  set<K extends RecursiveKeys<UserSettings>>(key: K, value: RecursiveTypes<UserSettings>[K]): Promise<boolean>;
  set(changes: RecursivePartialReadonly<UserSettings>): void;
  set<K extends RecursiveKeys<UserSettings>>(changes: K | RecursivePartialReadonly<UserSettings>, value?: RecursiveTypes<UserSettings>[K]) {
    if (value) {
      return this.userLayer.set(changes as K, value);
    }

    return this.userLayer.merge(changes as RecursivePartialReadonly<UserSettings>);
  }

  setTransient(changes: RecursivePartialReadonly<TransientSettings>): Promise<ValidatorReturn> {
    return this.transientLayer.merge(changes);
  }
}

const settingsManager = new SettingsManager();

export default settingsManager;
