import _ from 'lodash';

import { NavItemName, TransientSettings, navItemNames } from './transient';
import { BaseValidator, SettingsValidationMap, SettingsValidator, ValidatorReturn } from './validator';

import { RecursivePartialReadonly } from '@pkg/utils/typeUtils';
import { preferencesNavItems } from '@pkg/window/preferenceConstants';

type TransientSettingsValidationMap = SettingsValidationMap<TransientSettings>;

export class TransientSettingsValidator extends BaseValidator<TransientSettings> implements SettingsValidator<TransientSettings> {
  protected allowedTransientSettings: TransientSettingsValidationMap | null = null;

  validateSettings(currentSettings: RecursivePartialReadonly<TransientSettings>, newSettings: RecursivePartialReadonly<TransientSettings>): ValidatorReturn {
    this.allowedTransientSettings ||= {
      noModalDialogs: this.checkBoolean,
      preferences:    {
        navItem: {
          current:     this.checkPreferencesNavItemCurrent,
          currentTabs: this.checkPreferencesNavItemCurrentTabs,
        },
      },
    };

    return this.checkProposedSettings(
      _.merge({}, currentSettings, newSettings),
      this.allowedTransientSettings,
      currentSettings,
      newSettings,
      '',
    );
  }

  protected checkPreferencesNavItemCurrent(
    mergedSettings: TransientSettings,
    currentValue: NavItemName,
    desiredValue: NavItemName,
    fqname: string,
  ): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (!desiredValue || !navItemNames.includes(desiredValue)) {
      retval.errors.push(`${ fqname }: "${ desiredValue }" is not a valid page name for Preferences Dialog`);
    } else {
      retval.modified = currentValue !== desiredValue;
    }

    return retval;
  }

  protected checkPreferencesNavItemCurrentTabs(
    mergedSettings: TransientSettings,
    currentValue: Record<NavItemName, string | undefined>,
    desiredValue: any,
    fqname: string,
  ): ValidatorReturn {
    const retval = new ValidatorReturn();

    for (const k of Object.keys(desiredValue)) {
      if (!navItemNames.includes(k as NavItemName)) {
        retval.errors.push(`${ fqname }: "${ k }" is not a valid page name for Preferences Dialog`);
        continue;
      }
      if (_.isEqual(currentValue[k as NavItemName], desiredValue[k])) {
        // If the setting is unchanged, allow any value.  This is needed if some
        // settings are not applicable for a platform.
        continue;
      }

      const navItem = preferencesNavItems.find(item => item.name === k);

      if (!navItem?.tabs?.includes(desiredValue[k])) {
        retval.errors.push(`${ fqname }: tab name "${ desiredValue[k] }" is not a valid tab name for "${ k }" Preference page`);
      }
    }

    if (retval.errors.length === 0) {
      retval.modified = !_.isEqual(currentValue, desiredValue);
    }

    return retval;
  }
}

const transientSettingsValidator = new TransientSettingsValidator();

export default transientSettingsValidator;
