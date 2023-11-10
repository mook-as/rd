import _ from 'lodash';

import { SettingsLayerTransient, TransientSettings, defaultTransientSettings } from '../transient';
import transientSettingsValidator from '../transientValidator';
import { ValidatorReturn } from '../types';

describe('SettingsLayerTransient', () => {
  let subject: SettingsLayerTransient<TransientSettings>;

  beforeEach(() => {
    subject = new SettingsLayerTransient(defaultTransientSettings, transientSettingsValidator);
  });

  describe('get', () => {
    it('should get a default vaule', () => {
      expect(subject.get('noModalDialogs')).toBeFalsy();
    });
  });
  describe('set', () => {
    it('should set a value', () => {
      subject.set('noModalDialogs', true);
      expect(subject.get('noModalDialogs')).toBeTruthy();
    });
    it('should reject unknown values', async() => {
      await expect(subject.set('invalid' as any, '' as never)).resolves.toBeFalsy();
      expect(subject['settings']).toEqual(defaultTransientSettings);
    });
    it('should not reject invalid values', async() => {
      await expect(subject.set('preferences.navItem.current', 'xyzzy' as any)).resolves.toBeTruthy();
      expect(subject['settings']).not.toEqual(defaultTransientSettings);
    });
  });
  describe('merge', () => {
    it('should merge settings', async() => {
      const changes = { noModalDialogs: true };
      const expected = new ValidatorReturn();

      expected.modified = true;
      await expect(subject.merge(changes)).resolves.toEqual(expected);
      expect(subject['settings']).toEqual(_.merge({}, defaultTransientSettings, changes));
    });
    it('should not merge unknown settings', async() => {
      const changes = { invalid: 123 } as any;
      const expected = new ValidatorReturn();

      expected.errors = [expect.stringContaining(`Changing field "invalid" via the API isn't supported`)];
      await expect(subject.merge(changes)).resolves.toEqual(expected);
      expect(subject['settings']).toEqual(defaultTransientSettings);
    });
    it('should reject invalid settings', async() => {
      const changes = { noModalDialogs: 'yes' } as any;
      const expected = new ValidatorReturn();

      expected.errors = ['Invalid value for "noModalDialogs": <"yes">'];
      await expect(subject.merge(changes)).resolves.toEqual(expected);
      expect(subject['settings']).toEqual(defaultTransientSettings);
    });
  });
});
