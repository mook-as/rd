import _ from 'lodash';

import { UserSettings } from './defaults';
import { SettingsLayer } from './types';

import { RecursiveKeys, RecursivePartial, RecursiveTypes } from '@pkg/utils/typeUtils';

export class LockedFieldError extends Error {}

class SettingsLayerDeploymentProfile implements SettingsLayer<UserSettings> {
  #settings?: RecursivePartial<UserSettings>;

  get<K extends RecursiveKeys<UserSettings>>(key: K): RecursiveTypes<UserSettings>[K] | undefined {
    return _.get(this.#settings ?? {}, key, undefined) as RecursiveTypes<UserSettings>[K];
  }

  getSnapshot() {
    return this.#settings ?? {};
  }
}

const settingsLayerDeploymentProfile = {
  defaults: new SettingsLayerDeploymentProfile(),
  locked:   new SettingsLayerDeploymentProfile(),
};

export default settingsLayerDeploymentProfile;
