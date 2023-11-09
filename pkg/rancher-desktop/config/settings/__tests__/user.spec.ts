import fs from 'fs';
import os from 'os';
import path from 'path';

import _ from 'lodash';

import { SettingsLayerUser } from '../user';
import { BaseValidator, SettingsValidationMap, SettingsValidator, ValidatorReturn } from '../validator';

import clone from '@pkg/utils/clone';
import { RecursivePartialReadonly } from '@pkg/utils/typeUtils';

describe('SettingsLayerUser', () => {
  const defaultSettings = {
    string: 'hello',
    number: 42,
    array:  ['one', 'two', 'three'],
    extra:  'extra',
    child:  {
      string: 'yes',
      number: 12345,
      array:  ['this', 'is', 'a', 'thing'],
      extra:  'extra',
    },
  };

  type Settings = typeof defaultSettings;

  class SettingsLayerUserTest<T extends Record<string, any>> extends SettingsLayerUser<T> {
    // Override the load method to be a no-op.
    override load(): Promise<void> {
      this.settings = {};

      return Promise.resolve();
    }
  }

  class TestUserValidator extends BaseValidator<Settings> implements SettingsValidator<Settings> {
    readonly allowedSettings: SettingsValidationMap<Settings> = {
      string: this.checkString,
      number: this.checkNumber(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
      array:  this.checkNothing,
      extra:  this.checkString,
      child:  {
        string: this.checkString,
        number: this.checkNumber(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
        array:  this.checkNothing,
        extra:  this.checkString,
      },
    };

    checkNothing(): ValidatorReturn {
      return new ValidatorReturn();
    }

    validateSettings(currentSettings: RecursivePartialReadonly<Settings>, newSettings: RecursivePartialReadonly<Settings>): ValidatorReturn {
      return this.checkProposedSettings(
        _.merge({}, currentSettings, newSettings),
        this.allowedSettings,
        currentSettings,
        newSettings,
        '',
      );
    }
  }

  const subject = new SettingsLayerUserTest(defaultSettings, new TestUserValidator());

  beforeEach(() => subject.load());

  describe('save', () => {
    let workDir = '';

    beforeEach(async() => {
      workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rd-settings-user-'));
    });
    afterEach(async() => {
      if (workDir) {
        await fs.promises.rm(workDir, { recursive: true });
      }
    });

    it('should write out the file', async() => {
      const expected = { pikachu: 'xyzzy' };
      const settingsPath = path.join(workDir, 'settings.json');

      (subject as any).settingsPath = settingsPath;
      subject['settings'] = expected as any;
      await subject.save();
      const raw = await fs.promises.readFile(settingsPath, 'utf-8');

      expect(JSON.parse(raw)).toEqual(expected);
    });
  });

  describe('get', () => {
    it('should return the expected value', () => {
      subject['settings'] = clone(defaultSettings);
      expect(subject.get('string')).toEqual('hello');
      expect(subject.get('number')).toEqual(42);
      expect(subject.get('array')).toEqual(['one', 'two', 'three']);
      expect(subject.get('missing' as any)).toBeUndefined();
      expect(subject.get('child.string')).toEqual('yes');
      expect(subject.get('child.number')).toEqual(12345);
      expect(subject.get('child.array')).toEqual(['this', 'is', 'a', 'thing']);
      expect(subject.get('child')).toEqual(defaultSettings.child);
      expect(subject.get('child.missing' as any)).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should support setting values', async() => {
      await expect(subject.set('string', 'value')).resolves.toBeTruthy();
      expect(subject['settings']).toHaveProperty('string', 'value');
    });
    it('should ignore unknown values', async() => {
      await expect(subject.set('unknown' as any, 123)).resolves.toBeFalsy();
      expect(subject['settings']).not.toHaveProperty('unknown');
    });
    it('should allow setting invalid values', async() => {
      await expect(subject.set('number', 'this is a string' as any)).resolves.toBeTruthy();
      expect(subject['settings']).toHaveProperty('number', 'this is a string');
    });
  });

  describe('merge', () => {
    it('should merge settings', async() => {
      const changes = {
        string: 'world',
        number: 99,
        array:  ['element'],
        child:  {
          string: 'no', number: 54321, array: ['yes'],
        },
      };

      subject['settings'] = clone(defaultSettings);
      await expect(subject.merge(changes)).resolves.toBeInstanceOf(ValidatorReturn);
      expect(subject['settings']).toMatchObject(changes);
      expect(subject.get('extra')).toEqual('extra');
      expect(subject.get('child')).toHaveProperty('extra', 'extra');
    });

    it('should not merge unknown settings', async() => {
      const changes = {
        unknown: 'value',
        child:   { unknown: 'value' },
      } as any;
      const expected = new ValidatorReturn();

      expected.errors = expect.arrayContaining([
        expect.stringContaining(`Changing field "unknown" via the API isn't supported`),
        expect.stringContaining(`Changing field "child.unknown" via the API isn't supported`),
      ]);
      subject['settings'] = clone(defaultSettings);
      await expect(subject.merge(changes)).resolves.toEqual(expected);
      expect(subject['settings']).toEqual(defaultSettings);
    });
  });
});
