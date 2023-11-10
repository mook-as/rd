import _ from 'lodash';

import { ValidatorReturn } from '../types';
import { BaseValidator, SettingsValidationMap } from '../validator';

import clone from '@pkg/utils/clone';
import { RecursivePartialReadonly } from '@pkg/utils/typeUtils';

describe('BaseValidator', () => {
  const defaultSettings = {
    boolean: true, number: 1, enum: 'one', string: 'yes', unchanged: 'fixed',
  };

  type Settings = typeof defaultSettings;

  class Validator extends BaseValidator<Settings> {
    readonly allowedSettings: SettingsValidationMap<Settings> = {
      boolean:   this.checkBoolean,
      number:    this.checkNumber(2, 5),
      enum:      this.checkEnum('one', 'two', 'three'),
      string:    this.checkString,
      unchanged: this.checkUnchanged,
    };

    override validateSettings(currentSettings: RecursivePartialReadonly<Settings>, newSettings: RecursivePartialReadonly<Settings>): ValidatorReturn {
      return this.checkProposedSettings(
        _.merge({}, currentSettings, newSettings),
        this.allowedSettings,
        currentSettings,
        newSettings,
        '',
      );
    }
  }

  const subject = new Validator();

  it('should accept empty input', () => {
    expect(subject.validateSettings({}, {})).toEqual(new ValidatorReturn());
  });

  it.each([
    ['valid unchanged boolean', { boolean: true }],
    ['valid changed boolean', { boolean: false }],
    ['valid unchanged number', { number: 1 }],
    ['valid changed number', { number: 3 }],
    ['valid unchanged enum', { enum: 'one' }],
    ['valid changed enum', { enum: 'three' }],
    ['valid unchanged string', { string: 'yes' }],
    ['valid changed string', { string: 'new value' }],
    ['valid unchanged immutable', { unchanged: 'fixed' }],
  ])('should accept %s', (desc, input) => {
    const expected = new ValidatorReturn();

    expected.modified = !_.isMatch(defaultSettings, input);
    expect(subject.validateSettings(clone(defaultSettings), input as any)).toEqual(expected);
  });

  it.each([
    ['invalid boolean', { boolean: 3 }],
    ['invalid number', { number: 'hello' }],
    ['number too small', { number: 0 }],
    ['number too large', { number: 10 }],
    ['invalid enum', { enum: 'four' }],
    ['invalid string', { string: false }],
  ])('should reject %s', (desc, input) => {
    const errors = [expect.stringContaining(`Invalid value for "${ Object.keys(input)[0] }":`)];

    expect(subject.validateSettings({}, input as any)).toMatchObject({ errors });
  });

  it('should reject changing immutable fields', () => {
    expect(subject.validateSettings({}, { unchanged: 'changed' })).toMatchObject({ errors: [expect.stringContaining('Changing field "unchanged"')] });
  });

  it('should reject changing unknown fields', () => {
    const expected = new ValidatorReturn();

    expected.errors = [expect.stringContaining(`Changing field "unknown" via the API isn't supported`)];
    expect(subject.validateSettings({}, { unknown: 1 } as any)).toEqual(expected);
  });
});
