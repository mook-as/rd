import { ValidatorReturn } from './validator';

import { RecursiveKeys, RecursivePartialReadonly, RecursiveTypes } from '@pkg/utils/typeUtils';

export { ValidatorReturn } from './validator';

/**
 * SettingsLayer describes an object that can be used to retrieve settings.
 */
export interface SettingsLayer<T extends Record<string, any>> {
  /**
   * Get the current value with the given key.
   * @param key The key to get, as a dotted string: `a.b.c`
   * @returns The current value, or `undefined` if it is not set.
   */
  get<K extends RecursiveKeys<T>>(key: K): RecursiveTypes<T>[K] | undefined;

  /**
   * Get all values.
   */
  getAll(): RecursivePartialReadonly<T>;
}

/**
 * WritableSettingsLayer describes a SettingsLayer that can additionally be
 * used to write settings back to storage.
 */
export interface WritableSettingsLayer<T extends Record<string, any>> extends SettingsLayer<T> {
  /**
   * Set the value of the given key to the given value.
   * @param key The key to set, as a dotted string: `a.b.c`
   * @param value The value to set; it must be the correct type.
   * @returns Whether the write was valid; this would only be true if this layer
   * recognizes the setting.
   * @note This does not do validation; it is possible to set things to invalid
   * values.  As such, arbitrary user input should be set via .merge() instead.
   */
  set<K extends RecursiveKeys<T>>(key: K, value: RecursiveTypes<T>[K]): Promise<boolean>;

  /**
   * Merge the current layer with the given settings, after validating it.
   * @note This is more expensive than set().
   * @param value The settings to update.
   * @note If there are any validation errors, none of the settings are changed.
   */
  merge(value: RecursivePartialReadonly<T>): Promise<ValidatorReturn>
}

/**
 * isWritableSettingsLayer is a type predicate to check that a given
 * SettingsLayer is writable.
 */
export function isWritableSettingsLayer<T extends Record<string, any>>(layer: SettingsLayer<T>): layer is WritableSettingsLayer<T> {
  return typeof (layer as any).set === 'function';
}
