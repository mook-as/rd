import _ from 'lodash';

import transientSettingsValidator from './transientValidator';
import { SettingsLike, ValidatorReturn, WritableSettingsLayer } from './types';
import { SettingsValidator } from './validator';

import clone from '@pkg/utils/clone';
import { RecursiveKeys, RecursivePartialReadonly, RecursiveTypes } from '@pkg/utils/typeUtils';

export const navItemNames = [
  'Application',
  'WSL',
  'Virtual Machine',
  'Container Engine',
  'Kubernetes',
] as const;

export type NavItemName = typeof navItemNames[number];

export type TransientSettings = {
  application: {
    debug: boolean | undefined,
    isFirstRun: boolean,
  },
  noModalDialogs: boolean,
  preferences: {
    navItem: {
      current: NavItemName,
      currentTabs: Partial<Record<NavItemName, string | undefined>>
    }
  }
};

export const defaultTransientSettings: TransientSettings = {
  application:    { debug: undefined, isFirstRun: false },
  noModalDialogs: false,
  preferences:    {
    navItem: {
      current:     'Application',
      currentTabs: {
        Application:        'general',
        'Virtual Machine':  'hardware',
        'Container Engine': 'general',
        ...(process.platform === 'win32' && { WSL: 'integration' }),
      },
    },
  },
};

/**
 * Transient settings are values that are temporary overrides per-run; these
 * settings are not stored to disk and are automatically reset on next start.
 */
export class SettingsLayerTransient<T extends SettingsLike> implements WritableSettingsLayer<T> {
  protected readonly validator: SettingsValidator<T>;
  protected settings: T;

  constructor(defaults: T, validator: SettingsValidator<T>) {
    this.validator = validator;
    this.settings = clone(defaults);
  }

  updateFromEnvironment() {
    if (process.env.RD_DEBUG_ENABLED) {
      _.set(this.settings, 'application.debug', true);
    }
  }

  get<K extends RecursiveKeys<T>>(key: K): RecursiveTypes<T>[K] | undefined {
    return _.get(this.settings, key, undefined) as RecursiveTypes<T>[K];
  }

  getSnapshot() {
    return this.settings;
  }

  set<K extends RecursiveKeys<T>>(key: K, value: RecursiveTypes<T>[K]): Promise<boolean> {
    if (_.has(defaultTransientSettings, key)) {
      _.set(this.settings, key, value);

      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }

  merge(changes: RecursivePartialReadonly<T>): Promise<ValidatorReturn> {
    const validatorReturn = this.validator.validateSettings(this.settings, changes);

    if (validatorReturn.errors.length > 0) {
      return Promise.resolve(validatorReturn);
    }

    _.merge(this.settings, changes);

    return Promise.resolve(validatorReturn);
  }
}

/**
 * Transient settings are values that are temporary overrides per-run; these
 * settings are not stored to disk and are automatically reset on next start.
 */
const settingsLayerTransient = new SettingsLayerTransient(defaultTransientSettings, transientSettingsValidator);

export default settingsLayerTransient;
