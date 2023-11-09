import { RecursiveKeys, RecursivePartialReadonly, RecursiveTypes } from '@pkg/utils/typeUtils';

export type SettingsLike = Record<string, any>;
export type VersionedSettingsLike<T extends SettingsLike = SettingsLike> = T & { version: number };

/**
 * ValidatorReturn describes the return value of a ValidatorFunc.
 */
export class ValidatorReturn {
  /** Whether the settings would be changed. */
  modified = false;
  /** Any errors that would result from the change. */
  errors: string[] = [];
  /** Whether any error is fatal. */
  fatal = false;

  merge(from: ValidatorReturn): ValidatorReturn {
    this.modified ||= from.modified;
    this.errors.push(...from.errors);
    this.fatal ||= from.fatal;

    return this;
  }
}

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
   * @param value The settings to update.
   * @note This is more expensive than set().
   * @note This assumes any migrations and validations have already taken place.
   */
  merge(value: RecursivePartialReadonly<T>): void
}

/**
 * isWritableSettingsLayer is a type predicate to check that a given
 * SettingsLayer is writable.
 */
export function isWritableSettingsLayer<T extends Record<string, any>>(layer: SettingsLayer<T>): layer is WritableSettingsLayer<T> {
  return typeof (layer as any).set === 'function';
}
