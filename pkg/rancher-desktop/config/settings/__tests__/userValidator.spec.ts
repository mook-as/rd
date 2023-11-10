/* eslint object-curly-newline: ["error", {"consistent": true}] */

import os from 'os';

import _ from 'lodash';
import { SemVer } from 'semver';

import { defaultSettings } from '../defaults';
import { CURRENT_SETTINGS_VERSION, VMType, ValidatorReturn, ContainerEngine, MountType, UserSettings, PartialUserSettings } from '../index';
import { UserSettingsValidator } from '../userValidator';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import * as osVersion from '@pkg/utils/osVersion';

const cfg = _.merge(
  {},
  defaultSettings,
  {
    kubernetes:  { version: '1.23.4' },
    application: { pathManagementStrategy: PathManagementStrategy.Manual },
  });
const subject = new UserSettingsValidator();
let spyPlatform: jest.SpiedFunction<typeof os.platform>;

beforeEach(() => {
  spyPlatform = jest.spyOn(os, 'platform');
});

afterEach(() => {
  spyPlatform.mockRestore();
});

subject.k8sVersions = ['1.23.4', '1.0.0'];
describe(UserSettingsValidator, () => {
  it('should do nothing when given existing settings', () => {
    const result = subject.validateSettings(cfg, cfg);

    expect(result).toEqual(new ValidatorReturn());
  });

  it('should want to apply changes when valid new settings are proposed', () => {
    const newEnabled = !cfg.kubernetes.enabled;
    const newVersion = subject.k8sVersions[1];
    const newEngine = cfg.containerEngine.name === 'moby' ? 'containerd' : 'moby';
    const newFlannelEnabled = !cfg.kubernetes.options.flannel;
    const newConfig = _.merge({}, cfg, {
      containerEngine: { name: newEngine },
      kubernetes:
        {
          enabled: newEnabled,
          version: newVersion,
          options: { flannel: newFlannelEnabled },
        },
    });

    expect(subject.validateSettings(cfg, newConfig)).toMatchObject({
      modified: true,
      errors:   [],
    });
  });

  describe('all standard fields', () => {
    // Special fields that cannot be checked here; this includes enums and maps.
    const specialFields = [
      ['application', 'pathManagementStrategy'],
      ['containerEngine', 'allowedImages', 'locked'],
      ['containerEngine', 'name'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'cacheMode'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'msizeInKib'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'protocolVersion'],
      ['experimental', 'virtualMachine', 'mount', '9p', 'securityModel'],
      ['experimental', 'virtualMachine', 'mount', 'type'],
      ['experimental', 'virtualMachine', 'type'],
      ['experimental', 'virtualMachine', 'useRosetta'],
      ['experimental', 'virtualMachine', 'proxy', 'noproxy'],
      ['kubernetes', 'version'],
      ['version'],
      ['WSL', 'integrations'],
    ];

    // Fields that can only be set on specific platforms.
    const platformSpecificFields: Record<string, ReturnType<typeof os.platform>> = {
      'application.adminAccess':                      'linux',
      'experimental.virtualMachine.socketVMNet':      'darwin',
      'experimental.virtualMachine.networkingTunnel': 'win32',
      'experimental.virtualMachine.proxy.enabled':    'win32',
      'experimental.virtualMachine.proxy.address':    'win32',
      'experimental.virtualMachine.proxy.password':   'win32',
      'experimental.virtualMachine.proxy.port':       'win32',
      'experimental.virtualMachine.proxy.username':   'win32',
      'kubernetes.ingress.localhostOnly':             'win32',
      'virtualMachine.hostResolver':                  'win32',
      'virtualMachine.memoryInGB':                    'darwin',
      'virtualMachine.numberCPUs':                    'linux',
    };

    const spyValidateSettings = jest.spyOn(subject, 'validateSettings');

    function checkSetting(path: string[], defaultSettings: any) {
      const prefix = path.length === 0 ? '' : `${ path.join('.') }.`;
      const props = [];

      if (specialFields.some(specialField => _.isEqual(path, specialField))) {
        return;
      }

      for (const key of Object.keys(defaultSettings)) {
        if (typeof defaultSettings[key] === 'object') {
          checkSetting(path.concat(key), defaultSettings[key]);
        } else {
          if (specialFields.some(specialField => _.isEqual(path.concat(key), specialField))) {
            continue;
          }
          props.push(key);
        }
      }

      if (props.length === 0) {
        return;
      }

      describe.each(props.sort())(`${ prefix }%s`, (key) => {
        const keyPath = path.concat(key);

        if (keyPath.join('.') in platformSpecificFields) {
          beforeEach(() => {
            spyPlatform.mockReturnValue(platformSpecificFields[keyPath.join('.')]);
          });
        }

        it('should never complain when nothing is changed', () => {
          const input = _.set({}, keyPath, _.get(cfg, keyPath));

          expect(subject.validateSettings(cfg, input)).toMatchObject({
            modified: false,
            errors:   [],
          });
        });

        if (specialFields.some(specialField => _.isEqual(path.concat(key), specialField))) {
          return;
        }

        it('should allow changing', () => {
          let newValue: any;

          switch (typeof defaultSettings[key]) {
          case 'boolean':
            newValue = !defaultSettings[key];
            break;
          case 'number':
            newValue = defaultSettings[key] + 1;
            break;
          case 'string':
            newValue = `${ defaultSettings[key] }!`;
            break;
          default:
            expect(['boolean', 'number', 'string']).toContain(typeof defaultSettings[key]);
          }

          const input = _.set({}, keyPath, newValue);

          expect(subject.validateSettings(cfg, input)).toMatchObject({
            modified: true,
            errors:   [],
          });
        });

        it('should disallow invalid values', () => {
          let invalidValue: any;

          if (typeof defaultSettings[key] !== 'string') {
            invalidValue = 'invalid value';
          } else {
            invalidValue = 3;
          }

          const input = _.set({}, keyPath, invalidValue);

          expect(subject.validateSettings(cfg, input)).toMatchObject({
            modified: false,
            errors:   [`Invalid value for "${ prefix }${ key }": <${ JSON.stringify(invalidValue) }>`],
            fatal:    false,
          });
        });

        if (typeof defaultSettings[key] === 'boolean') {
          it('should accept string true', () => {
            const orig = _.merge({}, cfg, _.set({}, keyPath, false));

            expect(subject.validateSettings(orig, _.set({}, keyPath, 'true'))).toMatchObject({
              modified: true,
              errors:   [],
            });
          });
          it('should accept string false', () => {
            const orig = _.merge({}, cfg, _.set({}, keyPath, true));

            expect(subject.validateSettings(orig, _.set({}, keyPath, 'false'))).toMatchObject({
              modified: true,
              errors:   [],
            });
          });
        }
      });
    }

    checkSetting([], cfg);

    it('should have validated at least one setting', () => {
      expect(spyValidateSettings).toHaveBeenCalled();
    });
  });

  describe('containerEngine.name', () => {
    function configWithValue(value: string | ContainerEngine): UserSettings {
      return _.merge({}, cfg, _.set({}, 'containerEngine.name', value));
    }

    describe('should accept valid settings', () => {
      const validKeys = Object.keys(ContainerEngine).filter(x => x !== 'NONE');

      test.each(validKeys)('%s', (key) => {
        const typedKey = key as keyof typeof ContainerEngine;
        const result = subject.validateSettings(
          configWithValue(ContainerEngine.NONE),
          { containerEngine: { name: ContainerEngine[typedKey] } },
        );

        expect(result).toMatchObject({
          modified: true,
          errors:   [],
        });
      });
    });

    it('should reject setting to NONE', () => {
      const input = _.set({}, 'containerEngine.name', ContainerEngine.NONE);

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   [expect.stringContaining('Invalid value for "containerEngine.name": <"">;')],
        fatal:    true,
      });
    });

    describe('should accept aliases', () => {
      const aliases = ['docker'];

      it.each(aliases)('%s', (alias) => {
        const input = _.set({}, 'containerEngine.name', alias);

        expect(subject.validateSettings(configWithValue(ContainerEngine.NONE), input)).toMatchObject({
          modified: true,
          errors:   [],
        });
      });
    });

    it('should reject invalid values', () => {
      const input = _.set({}, 'containerEngine.name', 'pikachu');

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   [expect.stringContaining('Invalid value for "containerEngine.name": <"pikachu">; must be one of ["containerd","moby","docker"]')],
        fatal:    true,
      });
    });
  });

  describe('WSL.integrations', () => {
    beforeEach(() => {
      spyPlatform.mockReturnValue('win32');
    });

    it('should reject invalid values', () => {
      const input = _.set({}, 'WSL.integrations', 3);

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   ['Proposed field "WSL.integrations" should be an object, got <3>.'],
        fatal:    false,
      });
    });

    it('should reject being set on non-Windows', () => {
      spyPlatform.mockReturnValue('haiku');
      const input = _.set({}, 'WSL.integrations.foo', true);

      expect(subject.validateSettings(cfg, input)).toEqual({
        modified: false,
        errors:   [`Changing field "WSL.integrations" via the API isn't supported.`],
        fatal:    true,
      });
    });

    it('should reject invalid configuration', () => {
      const input = _.set({}, 'WSL.integrations.distribution', 3);

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   ['Invalid value for "WSL.integrations.distribution": <3>'],
        fatal:    false,
      });
    });

    it('should allow being changed', () => {
      const original = _.merge({}, cfg, _.set({}, 'WSL.integrations.distribution', false));
      const input = _.set({}, 'WSL.integrations.distribution', true);

      expect(subject.validateSettings(original, input)).toMatchObject({
        modified: true,
        errors:   [],
      });
    });
  });

  describe('kubernetes.version', () => {
    it('should accept a valid version', () => {
      const input = _.set({}, 'kubernetes.version', '1.0.0');

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: true,
        errors:   [],
      });
    });

    it('should reject an unknown version', () => {
      const input = { kubernetes: { version: '3.2.1', enabled: true } };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   [`Kubernetes version "3.2.1" not found.`],
        fatal:    false,
      });
    });

    it('should normalize the version', () => {
      const input = { kubernetes: { version: 'v1.0.0+k3s12345' } };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: true,
        errors:   [],
      });
    });

    it('should reject a non-version value', () => {
      const input = { kubernetes: { version: 'pikachu', enabled: true } };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   [`Kubernetes version "pikachu" not found.`],
        fatal:    false,
      });
    });
  });

  describe('pathManagementStrategy', () => {
    beforeEach(() => {
      spyPlatform.mockReturnValue('linux');
    });
    describe('should accept valid settings', () => {
      test.each(Object.keys(PathManagementStrategy))('%s', (strategy) => {
        const value = PathManagementStrategy[strategy as keyof typeof PathManagementStrategy];
        const original = _.merge({}, cfg, _.set({}, 'application.pathManagementStrategy', PathManagementStrategy.Manual));
        const input = { application: { pathManagementStrategy: value } };

        expect(subject.validateSettings(original, input)).toMatchObject({
          modified: value !== PathManagementStrategy.Manual,
          errors:   [],
        });
      });
    });

    it('should reject invalid values', () => {
      const input = { application: { pathManagementStrategy: 'invalid value' as PathManagementStrategy } };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   [`Invalid value for "application.pathManagementStrategy": <"invalid value">; must be one of ["manual","rcfiles"]`],
        fatal:    true,
      });
    });
  });

  describe('allowedImage lists', () => {
    it('complains about a single duplicate', () => {
      const input: PartialUserSettings = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: ['pattern1', 'pattern2', 'pattern3', 'pattern2'],
          },
        },
      };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   ['field "containerEngine.allowedImages.patterns" has duplicate entries: "pattern2"'],
        fatal:    false,
      });
    });
    it('complains about multiple duplicates', () => {
      const input: PartialUserSettings = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: ['pattern1', 'Pattern2', 'pattern3', 'Pattern2', 'pattern1'],
          },
        },
      };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   ['field "containerEngine.allowedImages.patterns" has duplicate entries: "pattern1", "Pattern2"'],
        fatal:    false,
      });
    });
    it('complains about multiple duplicates that contain only whitespace lengths', () => {
      const input: PartialUserSettings = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: ['pattern1', '  ', 'pattern2', '\t', 'pattern3', ''],
          },
        },
      };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: false,
        errors:   ['field "containerEngine.allowedImages.patterns" has duplicate entries: "", "\t", "  "'],
        fatal:    false,
      });
    });
    it('allows exactly one whitespace value', () => {
      const input: PartialUserSettings = {
        containerEngine: {
          allowedImages: {
            enabled:  true,
            patterns: ['pattern1', 'pattern2', '\t', 'pattern3'],
          },
        },
      };

      expect(subject.validateSettings(cfg, input)).toMatchObject({
        modified: true,
        errors:   [],
      });
    });
  });

  /*
  describe('locked fields', () => {
    describe('containerEngine.allowedImages', () => {
      const allowedImageListConfig: settings.Settings = _.merge({}, cfg, {
        containerEngine: {
          allowedImages: {
            enabled:  false,
            patterns: ['pattern1', 'pattern2', 'pattern3'],
          },
        },
      });

      describe('when a field is locked', () => {
        describe('locking allowedImages.enabled', () => {
          const lockedSettings = { containerEngine: { allowedImages: { enabled: true } } };

          it("can't be changed", () => {
            const input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: true } } };
            const [needToUpdate, errors, isFatal] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

            expect({ needToUpdate, errors, isFatal }).toEqual({
              needToUpdate: false,
              errors:       ['field "containerEngine.allowedImages.enabled" is locked'],
              isFatal:      true,
            });
          });
          it('can be set to the same value', () => {
            const currentEnabled = allowedImageListConfig.containerEngine.allowedImages.enabled;
            const input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: currentEnabled } } };
            const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

            expect({ needToUpdate, errors }).toEqual({
              needToUpdate: false,
              errors:       [],
            });
          });
        });

        describe('locking allowedImages.patterns', () => {
          const lockedSettings = { containerEngine: { allowedImages: { patterns: true } } };

          it("locked allowedImages:patterns-field can't be changed by adding a pattern", () => {
            const input: RecursivePartial<settings.Settings> = {
              containerEngine: {
                allowedImages: {
                  patterns: allowedImageListConfig.containerEngine.allowedImages.patterns.concat('pattern4'),
                },
              },
            };
            const [needToUpdate, errors, isFatal] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

            expect({ needToUpdate, errors, isFatal }).toEqual({
              needToUpdate: false,
              errors:       ['field "containerEngine.allowedImages.patterns" is locked'],
              isFatal:      true,
            });
          });

          it("locked allowedImages:patterns-field can't be changed by removing a pattern", () => {
            const input: RecursivePartial<settings.Settings> = {
              containerEngine: {
                allowedImages: {
                  patterns: allowedImageListConfig.containerEngine.allowedImages.patterns.slice(1),
                },
              },
            };
            const [needToUpdate, errors, isFatal] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

            expect({ needToUpdate, errors, isFatal }).toEqual({
              needToUpdate: false,
              errors:       ['field "containerEngine.allowedImages.patterns" is locked'],
              isFatal:      true,
            });
          });

          it('locked allowedImages:patterns-field can be set to the same value', () => {
            const input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { patterns: allowedImageListConfig.containerEngine.allowedImages.patterns } } };
            const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

            expect({ needToUpdate, errors }).toEqual({
              needToUpdate: false,
              errors:       [],
            });
          });
        });
      });
    });

    describe('checking locks', () => {
      const ceSettings: RecursivePartial<settings.Settings> = {
        containerEngine: {
          allowedImages: {
            enabled:  false,
            patterns: ['pattern1', 'pattern2'],
          },
        },
      };
      const allowedImageListConfig: settings.Settings = _.merge({}, cfg, ceSettings);

      describe('when unlocked', () => {
        it('allows changes', () => {
          const lockedSettings = { containerEngine: { allowedImages: { patterns: false } } };
          let input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: true } } };
          let [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

          expect({ needToUpdate, errors }).toEqual({ needToUpdate: true, errors: [] });

          input = { containerEngine: { allowedImages: { patterns: ['pattern1'] } } };
          ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: true,
            errors:       [],
          });
          input = { containerEngine: { allowedImages: { patterns: ['pattern1', 'pattern2', 'pattern3'] } } };
          ([needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: true,
            errors:       [],
          });
        });
      });

      describe('when locked', () => {
        const lockedSettings = {
          containerEngine: {
            allowedImages: {
              enabled:  true,
              patterns: true,
            },
          },
        };

        it('disallows changes', () => {
          const currentEnabled = allowedImageListConfig.containerEngine.allowedImages.enabled;
          const currentPatterns = allowedImageListConfig.containerEngine.allowedImages.patterns;
          let input: RecursivePartial<settings.Settings> = { containerEngine: { allowedImages: { enabled: !currentEnabled } } };
          let [needToUpdate, errors, isFatal] = subject.validateSettings(allowedImageListConfig, input, lockedSettings);

          expect({ needToUpdate, errors, isFatal }).toEqual({
            needToUpdate: false,
            errors:       ['field "containerEngine.allowedImages.enabled" is locked'],
            isFatal:      true,
          });

          input = { containerEngine: { allowedImages: { patterns: ['picasso'].concat(currentPatterns) } } };
          ([needToUpdate, errors, isFatal] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));
          expect({ needToUpdate, errors, isFatal }).toEqual({
            needToUpdate: false,
            errors:       ['field "containerEngine.allowedImages.patterns" is locked'],
            isFatal:      true,
          });

          input = { containerEngine: { allowedImages: { patterns: currentPatterns.slice(1) } } };
          ([needToUpdate, errors, isFatal] = subject.validateSettings(allowedImageListConfig, input, lockedSettings));

          expect({ needToUpdate, errors, isFatal }).toEqual({
            needToUpdate: false,
            errors:       ['field "containerEngine.allowedImages.patterns" is locked'],
            isFatal:      true,
          });
        });

        it("doesn't complain when no locked fields change", () => {
          const [needToUpdate, errors] = subject.validateSettings(allowedImageListConfig, ceSettings, lockedSettings);

          expect({ needToUpdate, errors }).toEqual({
            needToUpdate: false,
            errors:       [],
          });
        });
      });
    });
  });
  */

  describe('application.extensions.installed', () => {
    test('should accept already-invalid input', () => {
      const changes = { application: { extensions: { installed: { '!invalid name!': '@invalid tag@' } } } };
      const input = _.merge({}, cfg, changes);

      expect(subject.validateSettings(input, changes)).toMatchObject({ modified: false, errors: [] });
    });

    const longString = new Array(255).join('x');

    test.each<[string, any, string[]]>([
      ['should reject non-dict values', 123, ['application.extensions.installed: "123" is not a valid mapping']],
      ['should reject non-string values', { a: 1 }, ['application.extensions.installed: "a" has non-string tag "1"']],
      ['should reject invalid names', { '!!@': 'latest' }, ['application.extensions.installed: "!!@" is an invalid name']],
      ['should accept names with a bare component', { image: 'tag' }, []],
      ['should accept names with a domain', { 'registry.test/name': 'tag' }, []],
      ['should accept names with multiple components', { 'registry.test/dir/name': 'tag' }, []],
      ['should reject invalid tags', { image: 'hello world' }, ['application.extensions.installed: "image" has invalid tag "hello world"']],
      ['should reject overly-long tags', { image: longString }, [`application.extensions.installed: "image" has invalid tag "${ longString }"`]],
    ])('%s', (...[, input, expectedErrors]) => {
      const { errors } = subject.validateSettings(cfg, { application: { extensions: { installed: input } } });

      expect(errors).toEqual(expectedErrors);
    });
  });

  it('should complain about unchangeable fields', () => {
    const unchangeableFieldsAndValues = { version: -1 };

    // Check that we _don't_ ask for update when we have errors.
    const input = { application: { telemetry: { enabled: !cfg.application.telemetry.enabled } } };

    for (const [path, value] of Object.entries(unchangeableFieldsAndValues)) {
      _.set(input, path, value);
    }

    expect(subject.validateSettings(cfg, input)).toMatchObject({
      modified: false,
      errors:   Object.keys(unchangeableFieldsAndValues).map(key => `Changing field "${ key }" via the API isn't supported.`),
      fatal:    false,
    });
  });

  it('complains about mismatches between objects and scalars', () => {
    let result = subject.validateSettings(cfg, { kubernetes: 5 as unknown as Record<string, number> });

    expect(result).toMatchObject({
      modified: false,
      errors:   [expect.stringContaining('Setting "kubernetes" should wrap an inner object, but got <5>')],
    });

    result = subject.validateSettings(cfg, {
      containerEngine: { name: { expected: 'a string' } as unknown as ContainerEngine },
      kubernetes:      {
        version: { expected: 'a string' } as unknown as string,
        options: "ceci n'est pas un objet" as unknown as Record<string, boolean>,
        enabled: true,
      },
    });
    expect(result).toMatchObject({ modified: false,
      errors:   [
        `Invalid value for "containerEngine.name": <{"expected":"a string"}>; must be one of ["containerd","moby","docker"]`,
        'Kubernetes version "[object Object]" not found.',
        `Setting "kubernetes.options" should wrap an inner object, but got <ceci n'est pas un objet>.`,
      ] });
  });

  // Add some fields that are very unlikely to ever collide with newly introduced fields.
  it('should ignore unrecognized settings', () => {
    const input = {
      kubernetes: {
        'durian-sharkanodo': 3,
        version:             CURRENT_SETTINGS_VERSION,
        'jackfruit otto':    12,
        options:             {
          'pitaya*paprika': false,
          traefik:          cfg.kubernetes.options.traefik,
        },
        enabled: true,
      },
      portForwarding: {
        'kiwano // 8 1/2':         'cows',
        includeKubernetesServices: cfg.portForwarding.includeKubernetesServices,
      },
      'feijoa - Alps': [],
    } as unknown as PartialUserSettings;

    expect(subject.validateSettings(cfg, input)).toMatchObject({
      modified: false,
      errors:   expect.arrayContaining([
        expect.stringMatching(/Changing field ".*" via the API/),
        'Kubernetes version "10" not found.',
      ]),
      fatal: false,
    });
  });

  it('should allow empty Kubernetes version when Kubernetes is disabled', () => {
    const input = { kubernetes: { version: '', enabled: false } };

    expect(subject.validateSettings(cfg, input)).toMatchObject({
      modified: true,
      errors:   [],
    });
  });

  it('should disallow empty Kubernetes version when Kubernetes is enabled', () => {
    const input = { kubernetes: { version: '', enabled: true } };

    expect(subject.validateSettings(cfg, input)).toMatchObject({
      modified: false,
      errors:   ['Kubernetes version "" not found.'],
    });
  });

  describe('experimental.virtualMachine.type', () => {
    let spyArch: jest.SpiedFunction<typeof os.arch>;
    let spyMacOsVersion: jest.SpiedFunction<typeof osVersion.getMacOsVersion>;

    beforeEach(() => {
      spyPlatform.mockReturnValue('darwin');
      spyArch = jest.spyOn(os, 'arch');
      spyMacOsVersion = jest.spyOn(osVersion, 'getMacOsVersion');
    });

    afterEach(() => {
      spyArch.mockRestore();
      spyMacOsVersion.mockRestore();
    });

    function singleErrorResult(errorMessage: string) {
      return {
        modified: false,
        errors:   [errorMessage],
      };
    }

    function getVMTypeSetting(vmType: VMType) {
      return {
        experimental: {
          virtualMachine: {
            type: vmType,
          },
        },
      };
    }

    function getMountTypeSetting(mountType: MountType) {
      return {
        experimental: {
          virtualMachine: {
            mount: {
              type: mountType,
            },
          },
        },
      };
    }

    it('should reject VZ if architecture is arm and macOS version < 13.3.0', () => {
      spyArch.mockReturnValue('arm64');
      spyMacOsVersion.mockReturnValue(new SemVer('13.2.0'));

      expect(subject.validateSettings(cfg, getVMTypeSetting(VMType.VZ)))
        .toMatchObject(singleErrorResult(
          'Setting experimental.virtualMachine.type to \"vz\" on ARM requires macOS 13.3 (Ventura) or later.'));
    });

    it('should reject VZ if architecture is Intel macOS version < 13.0.0', () => {
      spyArch.mockReturnValue('x64');
      spyMacOsVersion.mockReturnValue(new SemVer('12.0.0'));

      expect(subject.validateSettings(cfg, getVMTypeSetting(VMType.VZ)))
        .toMatchObject(singleErrorResult(
          'Setting experimental.virtualMachine.type to \"vz\" on Intel requires macOS 13.0 (Ventura) or later.'));
    });

    it('should reject VZ if mount type is 9p', () => {
      spyMacOsVersion.mockReturnValue(new SemVer('13.3.0'));
      const original = _.merge({}, cfg, getMountTypeSetting(MountType.NINEP));

      expect(subject.validateSettings(original, getVMTypeSetting(VMType.VZ)))
        .toMatchObject(singleErrorResult(
          'Setting experimental.virtualMachine.type to \"vz\" requires that ' +
          'experimental.virtual-machine.mount.type is \"reverse-sshfs\" or \"virtiofs\".'));
    });

    it('should reject QEMU if mount type is virtiofs on macOS', () => {
      const original =
        _.merge({}, cfg, getMountTypeSetting(MountType.VIRTIOFS), getVMTypeSetting(VMType.VZ));

      expect(subject.validateSettings(original, getVMTypeSetting(VMType.QEMU)))
        .toMatchObject(singleErrorResult(
          'Setting experimental.virtualMachine.type to \"qemu\" requires that ' +
          'experimental.virtual-machine.mount.type is \"reverse-sshfs\" or \"9p\".',
        ));
    });
  });
});
