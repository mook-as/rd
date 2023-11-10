import _ from 'lodash';

import { SettingsLike, ValidatorReturn } from './types';

import { RecursivePartialReadonly } from '@pkg/utils/typeUtils';

/**
 * ValidatorFunc describes a validation function; it is used to check if a
 * given proposed setting is compatible.
 * @param mergedSettings The root of the merged settings object.
 * @param currentValue The value of the setting, before changing.
 * @param desiredValue The new value that the user is setting.
 * @param fqname The fully qualified name of the setting, for formatting in error messages.
 * @note If the desired value is equal to the current value, the validator
 * function will not be called.
 */
export type ValidatorFunc<S, C, D> =
  (mergedSettings: S, currentValue: C, desiredValue: D, fqname: string) => ValidatorReturn;

/**
 * SettingsValidationMapEntry describes validators that are valid for some
 * subtree of the full settings object.  The value must be either a ValidatorFunc
 * for that subtree, or an object containing validators for each member of the
 * subtree.
 */
type SettingsValidationMapEntry<S, T> = {
  [k in keyof T]:
  T[k] extends string | Array<string> | number | boolean | undefined?
  ValidatorFunc<S, T[k], T[k]> :
  T[k] extends Record<string, infer V> ?
  SettingsValidationMapEntry<S, T[k]> | ValidatorFunc<S, T[k], Record<string, V>> :
  never;
};

/**
 * SettingsValidationMap describes the full set of validators that will be used
 * for all settings.
 */
export type SettingsValidationMap<T> = SettingsValidationMapEntry<T, T>;

export interface SettingsValidator<T> {
  validateSettings(currentSettings: RecursivePartialReadonly<T>, newSettings: RecursivePartialReadonly<T>): ValidatorReturn;
}

export abstract class BaseValidator<T> implements SettingsValidator<T> {
  abstract validateSettings(currentSettings: RecursivePartialReadonly<T>, newSettings: RecursivePartialReadonly<T>): ValidatorReturn;

  /**
   * The core function for checking proposed user settings.
   * Walks the input: the user-provided object holding the new (and existing settings) against a verifier:
   * 1. Complains about any fields in the input that aren't in the verifier
   * 2. Recursively walks child-objects in the input and verifier
   * 3. Calls validation functions off the verifier
   * @param mergedSettings - The root object of the merged current and new settings
   * @param allowedSettings - The verifier
   * @param currentSettings - The current preferences object
   * @param newSettings - User's proposed new settings
   * @param prefix - For error messages only, e.g. '' for root, 'kubernetes.options', etc.
   */
  protected checkProposedSettings<S>(
    mergedSettings: S,
    allowedSettings: SettingsLike,
    currentSettings: SettingsLike,
    newSettings: SettingsLike,
    prefix: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    for (const k in newSettings) {
      const fqname = prefix ? `${ prefix }.${ k }` : k;

      if (!(k in allowedSettings)) {
        retval.errors.push(this.notSupported(fqname));
        continue;
      }
      if (typeof (allowedSettings[k]) === 'object') {
        if (typeof (newSettings[k]) === 'object') {
          retval.merge(this.checkProposedSettings(mergedSettings, allowedSettings[k], currentSettings[k], newSettings[k], fqname));
        } else {
          retval.errors.push(`Setting "${ fqname }" should wrap an inner object, but got <${ newSettings[k] }>.`);
        }
      } else if (typeof (newSettings[k]) === 'object') {
        if (typeof allowedSettings[k] === 'function') {
          // Special case for things like `.WSLIntegrations` which have unknown fields.
          const validator: ValidatorFunc<S, any, any> = allowedSettings[k];

          if (!_.isEqual(currentSettings[k], newSettings[k])) {
            retval.merge(validator.call(this, mergedSettings, currentSettings[k], newSettings[k], fqname));
          }
        } else {
          // newSettings[k] should be valid JSON because it came from `JSON.parse(incoming-payload)`.
          // It's an internal error (HTTP Status 500) if it isn't.
          retval.errors.push(`Setting "${ fqname }" should be a simple value, but got <${ JSON.stringify(newSettings[k]) }>.`);
        }
      } else if (typeof allowedSettings[k] === 'function') {
        const validator: ValidatorFunc<S, any, any> = allowedSettings[k];

        if (!_.isEqual(currentSettings[k], newSettings[k])) {
          retval.merge(validator.call(this, mergedSettings, currentSettings[k], newSettings[k], fqname));
        }
      } else {
        retval.errors.push(this.notSupported(fqname));
      }
    }

    retval.modified &&= retval.errors.length === 0;

    return retval;
  }

  protected invalidSettingMessage(fqname: string, desiredValue: any): string {
    return `Invalid value for "${ fqname }": <${ JSON.stringify(desiredValue) }>`;
  }

  protected notSupported(fqname: string) {
    return `Changing field "${ fqname }" via the API isn't supported.`;
  }

  protected checkMulti<S, C, D>(...validators: ValidatorFunc<S, C, D>[]) {
    return (mergedSettings: S, currentValue: C, desiredValue: D, fqname: string) => {
      const retval = new ValidatorReturn();

      for (const validator of validators) {
        retval.merge(validator.call(this, mergedSettings, currentValue, desiredValue, fqname));
      }

      return retval;
    };
  }

  /**
   * checkBoolean is a generic checker for simple boolean values.
   */
  protected checkBoolean<S>(mergedSettings: S, currentValue: boolean, desiredValue: boolean, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (typeof desiredValue !== 'boolean') {
      retval.errors.push(this.invalidSettingMessage(fqname, desiredValue));
    } else {
      retval.modified = true;
    }

    return retval;
  }

  /**
   * checkNumber returns a checker for a number in the given range, inclusive.
   */
  protected checkNumber(min: number, max: number) {
    return <S>(mergedSettings: S, currentValue: number, desiredValue: number, fqname: string) => {
      const retval = new ValidatorReturn();

      if (typeof desiredValue !== 'number') {
        retval.errors.push(this.invalidSettingMessage(fqname, desiredValue));
      } else if (desiredValue < min || desiredValue > max) {
        retval.errors.push(this.invalidSettingMessage(fqname, desiredValue));
      } else {
        retval.modified = true;
      }

      return retval;
    };
  }

  protected checkEnum(...validValues: string[]) {
    return <S>(mergedSettings: S, currentValue: string, desiredValue: string, fqname: string) => {
      const retval = new ValidatorReturn();
      const explanation = `must be one of ${ JSON.stringify(validValues) }`;

      if (typeof desiredValue !== 'string') {
        retval.errors.push(`${ this.invalidSettingMessage(fqname, desiredValue) }; ${ explanation }`);
      } else if (!validValues.includes(desiredValue)) {
        retval.errors.push(`Invalid value for "${ fqname }": <${ JSON.stringify(desiredValue) }>; ${ explanation }`);
        retval.fatal = true;
      } else {
        retval.modified = true;
      }

      return retval;
    };
  }

  protected checkString<S>(mergedSettings: S, currentValue: string, desiredValue: string, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (typeof desiredValue !== 'string') {
      retval.errors.push(this.invalidSettingMessage(fqname, desiredValue));
    } else {
      retval.modified = true;
    }

    return retval;
  }

  protected checkUnchanged<S>(mergedSettings: S, currentValue: any, desiredValue: any, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    retval.errors.push(this.notSupported(fqname));

    return retval;
  }
}
