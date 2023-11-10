import os from 'os';

import Electron from 'electron';
import _ from 'lodash';
import semver from 'semver';

import settingsLayerDefaults, {
  CacheMode, MountType, ProtocolVersion, SecurityModel, UserSettings, VMType,
} from './defaults';
import { SettingsLayer, ValidatorReturn } from './types';
import { BaseValidator, SettingsValidationMap, SettingsValidator, ValidatorFunc } from './validator';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { parseImageReference, validateImageName, validateImageTag } from '@pkg/utils/dockerUtils';
import { getMacOsVersion } from '@pkg/utils/osVersion';
import { RecursivePartialReadonly } from '@pkg/utils/typeUtils';

type settingsLike = Record<string, any>;

export class UserSettingsValidator extends BaseValidator<UserSettings> implements SettingsValidator<UserSettings> {
  k8sVersions: Array<string> = [];
  synonymsTable: settingsLike|null = null;
  allowedSettings: SettingsValidationMap<UserSettings> = {
    application: {
      adminAccess: this.checkLima(this.checkBoolean),
      debug:       this.checkBoolean,
      extensions:  {
        allowed: {
          enabled: this.checkBoolean,
          list:    this.checkExtensionAllowList,
        },
        installed: this.checkInstalledExtensions,
      },
      pathManagementStrategy: this.checkLima(this.checkEnum(...Object.values(PathManagementStrategy))),
      telemetry:              { enabled: this.checkBoolean },
      /** Whether we should check for updates and apply them. */
      updater:                { enabled: this.checkBoolean },
      autoStart:              this.checkBoolean,
      startInBackground:      this.checkBoolean,
      hideNotificationIcon:   this.checkBoolean,
      window:                 { quitOnClose: this.checkBoolean },
    },
    containerEngine: {
      allowedImages: {
        enabled:  this.checkBoolean,
        patterns: this.checkUniqueStringArray,
      },
      // 'docker' has been canonicalized to 'moby' already, but we want to include it as a valid value in the error message
      name: this.checkEnum('containerd', 'moby', 'docker'),
    },
    virtualMachine: {
      memoryInGB:   this.checkLima(this.checkNumber(1, Number.POSITIVE_INFINITY)),
      numberCPUs:   this.checkLima(this.checkNumber(1, Number.POSITIVE_INFINITY)),
      hostResolver: this.checkPlatform('win32', this.checkBoolean),
    },
    experimental: {
      virtualMachine: {
        mount: {
          type: this.checkLima(this.checkMulti(
            this.checkEnum(...Object.values(MountType)),
            this.checkMountType),
          ),
          '9p': {
            securityModel:   this.checkLima(this.check9P(this.checkEnum(...Object.values(SecurityModel)))),
            protocolVersion: this.checkLima(this.check9P(this.checkEnum(...Object.values(ProtocolVersion)))),
            msizeInKib:      this.checkLima(this.check9P(this.checkNumber(4, Number.POSITIVE_INFINITY))),
            cacheMode:       this.checkLima(this.check9P(this.checkEnum(...Object.values(CacheMode)))),
          },
        },
        socketVMNet:      this.checkPlatform('darwin', this.checkBoolean),
        networkingTunnel: this.checkPlatform('win32', this.checkBoolean),
        useRosetta:       this.checkPlatform('darwin', this.checkRosetta),
        type:             this.checkPlatform('darwin', this.checkMulti(
          this.checkEnum(...Object.values(VMType)),
          this.checkVMType),
        ),
        proxy: {
          enabled:  this.checkPlatform('win32', this.checkBoolean),
          address:  this.checkPlatform('win32', this.checkString),
          password: this.checkPlatform('win32', this.checkString),
          port:     this.checkPlatform('win32', this.checkNumber(1, 65535)),
          username: this.checkPlatform('win32', this.checkString),
          noproxy:  this.checkPlatform('win32', this.checkUniqueStringArray),
        },
      },
    },
    WSL:        { integrations: this.checkPlatform('win32', this.checkBooleanMapping) },
    kubernetes: {
      version: this.checkKubernetesVersion,
      port:    this.checkNumber(1, 65535),
      enabled: this.checkBoolean,
      options: { traefik: this.checkBoolean, flannel: this.checkBoolean },
      ingress: { localhostOnly: this.checkPlatform('win32', this.checkBoolean) },
    },
    portForwarding: { includeKubernetesServices: this.checkBoolean },
    images:         {
      showAll:   this.checkBoolean,
      namespace: this.checkString,
    },
    diagnostics: {
      mutedChecks: this.checkBooleanMapping,
      showMuted:   this.checkBoolean,
    },
  };

  validateSettings(
    currentSettings: SettingsLayer<UserSettings>,
    newSettings: RecursivePartialReadonly<UserSettings>,
  ): ValidatorReturn {
    this.canonicalizeSynonyms(newSettings);

    return this.checkProposedSettings(
      _.merge({}, currentSettings, newSettings),
      this.allowedSettings,
      currentSettings,
      newSettings,
      '',
    );
  }

  /**
   * checkLima ensures that the given parameter is only set on Lima-based platforms.
   * @note This should not be used for things with default values.
   */
  protected checkLima<C, D>(validator: ValidatorFunc<UserSettings, C, D>): ValidatorFunc<UserSettings, C, D> {
    return (mergedSettings: UserSettings, currentValue: C, desiredValue: D, fqname: string) => {
      const retval = new ValidatorReturn();

      if (!['darwin', 'linux'].includes(os.platform())) {
        retval.fatal = true;
        retval.errors.push(this.notSupported(fqname));
      } else {
        retval.merge(validator.call(this, mergedSettings, currentValue, desiredValue, fqname));
      }

      return retval;
    };
  }

  protected checkRosetta(mergedSettings: UserSettings, currentValue: boolean, desiredValue: boolean, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (desiredValue && !currentValue) {
      // Turning Rosetta on requires checking that we can do so.
      if (mergedSettings.experimental.virtualMachine.type !== VMType.VZ) {
        retval.errors.push(`Setting ${ fqname } can only be enabled when experimental.virtual-machine.type is "${ VMType.VZ }".`);
        retval.fatal = true;
      } else if (!Electron.app.runningUnderARM64Translation && os.arch() !== 'arm64') {
        retval.errors.push(`Setting ${ fqname } can only be enabled on aarch64 systems.`);
        retval.fatal = true;
      } else {
        retval.modified = true;
      }
    } else {
      retval.modified = true;
    }

    return retval;
  }

  protected checkVMType(mergedSettings: UserSettings, currentValue: string, desiredValue: string, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (desiredValue === VMType.VZ) {
      if (os.arch() === 'arm64' && semver.gt('13.3.0', getMacOsVersion())) {
        retval.fatal = true;
        retval.errors.push(`Setting ${ fqname } to "${ VMType.VZ }" on ARM requires macOS 13.3 (Ventura) or later.`);
      } else if (semver.gt('13.0.0', getMacOsVersion())) {
        retval.fatal = true;
        retval.errors.push(`Setting ${ fqname } to "${ VMType.VZ }" on Intel requires macOS 13.0 (Ventura) or later.`);
      } else if (mergedSettings.experimental.virtualMachine.mount.type === MountType.NINEP) {
        retval.errors.push(
          `Setting ${ fqname } to "${ VMType.VZ }" requires that experimental.virtual-machine.mount.type is ` +
          `"${ MountType.REVERSE_SSHFS }" or "${ MountType.VIRTIOFS }".`);
      } else {
        retval.modified = true;
      }
    } else if (desiredValue === VMType.QEMU) {
      if (mergedSettings.experimental.virtualMachine.mount.type === MountType.VIRTIOFS && os.platform() === 'darwin') {
        retval.errors.push(
          `Setting ${ fqname } to "${ VMType.QEMU }" requires that experimental.virtual-machine.mount.type is ` +
          `"${ MountType.REVERSE_SSHFS }" or "${ MountType.NINEP }".`);
      } else {
        retval.modified = true;
      }
    } else {
      retval.modified = true;
    }

    return retval;
  }

  protected checkMountType(mergedSettings: UserSettings, currentValue: string, desiredValue: string, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();
    let error: string | undefined;

    if (desiredValue === MountType.VIRTIOFS && mergedSettings.experimental.virtualMachine.type !== VMType.VZ && os.platform() === 'darwin') {
      error = `Setting ${ fqname } to "${ MountType.VIRTIOFS }" requires that experimental.virtual-machine.type is "${ VMType.VZ }".`;
    } else if (desiredValue === MountType.VIRTIOFS && mergedSettings.experimental.virtualMachine.type !== VMType.QEMU && os.platform() === 'linux') {
      error = `Setting ${ fqname } to "${ MountType.VIRTIOFS }" requires that experimental.virtual-machine.type is "${ VMType.QEMU }".`;
    } else if (desiredValue === MountType.NINEP && mergedSettings.experimental.virtualMachine.type !== VMType.QEMU) {
      error = `Setting ${ fqname } to "${ MountType.NINEP }" requires that experimental.virtual-machine.type is "${ VMType.QEMU }".`;
    }

    if (error) {
      retval.errors.push(error);
    } else {
      retval.modified = true;
    }

    return retval;
  }

  protected checkPlatform<C, D>(platform: NodeJS.Platform, validator: ValidatorFunc<UserSettings, C, D>) {
    return (mergedSettings: UserSettings, currentValue: C, desiredValue: D, fqname: string) => {
      const retval = new ValidatorReturn();

      if (os.platform() !== platform) {
        retval.errors.push(this.notSupported(fqname));
        retval.fatal = true;
      } else {
        retval.merge(validator.call(this, mergedSettings, currentValue, desiredValue, fqname));
      }

      return retval;
    };
  }

  protected check9P<C, D>(validator: ValidatorFunc<UserSettings, C, D>) {
    return (mergedSettings: UserSettings, currentValue: C, desiredValue: D, fqname: string) => {
      const retval = new ValidatorReturn();

      if (mergedSettings.experimental.virtualMachine.mount.type !== MountType.NINEP) {
        if (!_.isEqual(currentValue, desiredValue)) {
          retval.errors.push(`Setting ${ fqname } can only be changed when experimental.virtualMachine.mount.type is "${ MountType.NINEP }".`);
          retval.fatal = true;
        }
      } else {
        retval.merge(validator.call(this, mergedSettings, currentValue, desiredValue, fqname));
      }

      return retval;
    };
  }

  protected checkKubernetesVersion(mergedSettings: UserSettings, currentValue: string, desiredVersion: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (!mergedSettings.kubernetes.enabled && desiredVersion === '') {
      // If Kubernetes is disabled, we allow setting the desired version to an empty string.
      retval.modified = true;
    } else if (this.k8sVersions.length === 0) {
      // If no Kubernetes versions are available, we allow it being set to anything.
      // This is typically during startup.
      retval.modified = true;
    } else if (!this.k8sVersions.includes(desiredVersion)) {
      retval.errors.push(`Kubernetes version "${ desiredVersion }" not found.`);
    } else {
      retval.modified = true;
    }

    return retval;
  }

  /**
   * Ensures settings that are objects adhere to their type of
   * Record<string, boolean>. This is useful for checking that values other than
   * booleans are not unintentionally added to settings like WSLIntegrations
   * and mutedChecks.
   */
  protected checkBooleanMapping<S>(mergedSettings: S, currentValue: Record<string, boolean>, desiredValue: Record<string, boolean>, fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (typeof (desiredValue) !== 'object') {
      retval.errors.push(`Proposed field "${ fqname }" should be an object, got <${ desiredValue }>.`);
    } else {
      let changed = Object.keys(currentValue).some(k => !(k in desiredValue));

      for (const [key, value] of Object.entries(desiredValue)) {
        if (typeof value !== 'boolean' && value !== null) {
          retval.errors.push(this.invalidSettingMessage(`${ fqname }.${ key }`, desiredValue[key]));
        } else {
          changed ||= currentValue[key] !== value;
        }
      }
      retval.modified = retval.errors.length === 0 && changed;
    }

    return retval;
  }

  protected checkUniqueStringArray<S>(mergedSettings: S, currentValue: string[], desiredValue: string[], fqname: string): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (!Array.isArray(desiredValue) || desiredValue.some(s => typeof (s) !== 'string')) {
      retval.errors.push(this.invalidSettingMessage(fqname, desiredValue));

      return retval;
    }
    const duplicateValues = this.findDuplicates(desiredValue);

    if (duplicateValues.length > 0) {
      duplicateValues.sort(Intl.Collator().compare);
      retval.errors.push(`field "${ fqname }" has duplicate entries: "${ duplicateValues.join('", "') }"`);
    } else {
      retval.modified = currentValue.length !== desiredValue.length || currentValue.some((v, i) => v !== desiredValue[i]);
    }

    return retval;
  }

  protected findDuplicates(list: string[]): string[] {
    let whiteSpaceMembers = [];
    const firstInstance = new Set<string>();
    const duplicates = new Set<string>();
    const isWhiteSpaceRE = /^\s*$/;

    for (const member of list) {
      if (isWhiteSpaceRE.test(member)) {
        whiteSpaceMembers.push(member);
      } else if (!firstInstance.has(member)) {
        firstInstance.add(member);
      } else {
        duplicates.add(member);
      }
    }
    if (whiteSpaceMembers.length === 1) {
      whiteSpaceMembers = [];
    }

    return Array.from(duplicates).concat(whiteSpaceMembers);
  }

  protected checkInstalledExtensions(
    mergedSettings: UserSettings,
    currentValue: Record<string, string>,
    desiredValue: any,
    fqname: string,
  ): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (_.isEqual(desiredValue, currentValue)) {
      // Accept no-op changes
      return retval;
    }

    if (typeof desiredValue !== 'object' || !desiredValue) {
      retval.errors.push(`${ fqname }: "${ desiredValue }" is not a valid mapping`);

      return retval;
    }

    for (const [name, tag] of Object.entries(desiredValue)) {
      if (!validateImageName(name)) {
        retval.errors.push(`${ fqname }: "${ name }" is an invalid name`);
      }
      if (typeof tag !== 'string') {
        retval.errors.push(`${ fqname }: "${ name }" has non-string tag "${ tag }"`);
      } else if (!validateImageTag(tag)) {
        retval.errors.push(`${ fqname }: "${ name }" has invalid tag "${ tag }"`);
      }
    }

    if (retval.errors.length === 0) {
      retval.modified = !_.isEqual(desiredValue, currentValue);
    }

    return retval;
  }

  protected checkExtensionAllowList(
    mergedSettings: UserSettings,
    currentValue: string[],
    desiredValue: any,
    fqname: string,
  ): ValidatorReturn {
    const retval = new ValidatorReturn();

    if (_.isEqual(desiredValue, currentValue)) {
      // Accept no-op changes
      return retval;
    }

    retval.merge(this.checkUniqueStringArray(mergedSettings, currentValue, desiredValue, fqname));

    if (retval.errors.length > 0) {
      return retval;
    }

    for (const pattern of desiredValue as string[]) {
      if (!parseImageReference(pattern, true)) {
        retval.errors.push(`${ fqname }: "${ pattern }" does not describe an image reference`);
      }
    }

    return retval;
  }

  canonicalizeSynonyms(newSettings: settingsLike): void {
    this.synonymsTable ||= {
      containerEngine: { name: this.canonicalizeContainerEngine },
      kubernetes:      { version: this.canonicalizeKubernetesVersion },
    };
    this.canonicalizeSettings(this.synonymsTable, newSettings, []);
  }

  protected canonicalizeSettings(synonymsTable: settingsLike, newSettings: settingsLike, prefix: string[]): void {
    for (const k in newSettings) {
      if (typeof newSettings[k] === 'object') {
        this.canonicalizeSettings(synonymsTable[k] ?? {}, newSettings[k], prefix.concat(k));
      } else if (typeof synonymsTable[k] === 'function') {
        synonymsTable[k].call(this, newSettings, k);
      } else if (typeof settingsLayerDefaults.get(prefix.concat(k)) === 'boolean') {
        this.canonicalizeBool(newSettings, k);
      } else if (typeof settingsLayerDefaults.get(prefix.concat(k)) === 'number') {
        this.canonicalizeNumber(newSettings, k);
      }
    }
  }

  protected canonicalizeKubernetesVersion(newSettings: settingsLike, index: string): void {
    const desiredValue: string = newSettings[index];
    const ptn = /^(v?)(\d+\.\d+\.\d+)((?:\+k3s\d+)?)$/;
    const m = ptn.exec(desiredValue);

    if (m && (m[1] || m[3])) {
      newSettings[index] = m[2];
    }
  }

  protected canonicalizeContainerEngine(newSettings: settingsLike, index: string): void {
    if (newSettings[index] === 'docker') {
      newSettings[index] = 'moby';
    }
  }

  protected canonicalizeBool(newSettings: settingsLike, index: string): void {
    const desiredValue: boolean|string = newSettings[index];

    if (desiredValue === 'true') {
      newSettings[index] = true;
    } else if (desiredValue === 'false') {
      newSettings[index] = false;
    }
  }

  protected canonicalizeNumber(newSettings: settingsLike, index: string): void {
    const desiredValue: number | string = newSettings[index];

    if (typeof desiredValue === 'string') {
      const parsedValue = parseInt(desiredValue, 10);

      // Ignore NaN; we'll fail validation later.
      if (!Number.isNaN(parsedValue)) {
        newSettings[index] = parsedValue;
      }
    }
  }
}

const userSettingsValidator = new UserSettingsValidator();

export default userSettingsValidator;
