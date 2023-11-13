import { RecursivePartialReadonly } from "@pkg/utils/typeUtils";

/**
 * SettingLeaf describes valid types for settings values.
 */
export type SettingLeaf = boolean | number | string | ArrayLike<string>;

export function IsSettingLeaf(input: SettingsLike | SettingLeaf): input is SettingLeaf {
  return typeof input !== 'object' || Array.isArray(input);
}

/**
 * SettingsLike is a subtree of settings.
 */
export type SettingsLike = {
  [T: string]: SettingsLike | SettingLeaf;
};
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
