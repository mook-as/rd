import os from 'os';

import _ from 'lodash';

import { IsSettingLeaf, SettingLeaf, SettingsLayer, SettingsLike } from './types';

import { PathManagementStrategy } from '@pkg/integrations/pathManager';
import { RecursiveKeys, RecursivePartialReadonly, RecursiveReadonly, RecursiveTypes } from '@pkg/utils/typeUtils';

export enum VMType {
  QEMU = 'qemu',
  VZ = 'vz',
}
export enum ContainerEngine {
  NONE = '',
  CONTAINERD = 'containerd',
  MOBY = 'moby',
}

export const ContainerEngineNames: Record<ContainerEngine, string> = {
  [ContainerEngine.NONE]:       '',
  [ContainerEngine.CONTAINERD]: 'containerd',
  [ContainerEngine.MOBY]:       'dockerd',
};

export enum MountType {
  NINEP = '9p',
  REVERSE_SSHFS = 'reverse-sshfs',
  VIRTIOFS = 'virtiofs',
}

export enum ProtocolVersion {
  NINEP2000 = '9p2000',
  NINEP2000_U = '9p2000.u',
  NINEP2000_L = '9p2000.L',
}

export enum SecurityModel {
  PASSTHROUGH ='passthrough',
  MAPPED_XATTR = 'mapped-xattr',
  MAPPED_FILE = 'mapped-file',
  NONE = 'none',
}

export enum CacheMode {
  NONE = 'none',
  LOOSE = 'loose',
  FSCACHE = 'fscache',
  MMAP = 'mmap',
}

export const defaultSettings = {
  application: {
    adminAccess: false,
    debug:       false,
    extensions:  {
      allowed: {
        enabled: false,
        list:    [] as Array<string>,
      },
      /** Installed extensions, mapping to the installed version (tag). */
      installed: { } as Record<string, string>,
    },
    pathManagementStrategy: process.platform === 'win32' ? PathManagementStrategy.Manual : PathManagementStrategy.RcFiles,
    telemetry:              { enabled: true },
    /** Whether we should check for updates and apply them. */
    updater:                { enabled: true },
    autoStart:              false,
    startInBackground:      false,
    hideNotificationIcon:   false,
    window:                 { quitOnClose: false },
  },
  containerEngine: {
    allowedImages: {
      enabled:  false,
      patterns: [] as Array<string>,
    },
    name: ContainerEngine.MOBY,
  },
  virtualMachine: {
    memoryInGB:   getDefaultMemory(),
    numberCPUs:   2,
    /**
     * when set to true Dnsmasq is disabled and all DNS resolution
     * is handled by host-resolver on Windows platform only.
     */
    hostResolver: true,
  },
  WSL:        { integrations: {} as Record<string, boolean> },
  kubernetes: {
    /** The version of Kubernetes to launch, as a semver (without v prefix). */
    version: '',
    port:    6443,
    enabled: true,
    options: { traefik: true, flannel: true },
    ingress: { localhostOnly: false },
  },
  portForwarding: { includeKubernetesServices: false },
  images:         {
    showAll:   true,
    namespace: 'k8s.io',
  },
  diagnostics: {
    showMuted:   false,
    mutedChecks: {} as Record<string, boolean>,
  },
  /**
   * Experimental settings - there should not be any UI for these.
   */
  experimental: {
    virtualMachine: {
      /** can only be set to VMType.VZ on macOS Ventura and later */
      type:        VMType.QEMU,
      /** can only be used when type is VMType.VZ, and only on aarch64 */
      useRosetta:  false,
      /** macOS only: if set, use socket_vmnet instead of vde_vmnet. */
      socketVMNet: false,
      mount:       {
        type: MountType.REVERSE_SSHFS,
        '9p': {
          securityModel:   SecurityModel.NONE,
          protocolVersion: ProtocolVersion.NINEP2000_L,
          msizeInKib:      128,
          cacheMode:       CacheMode.MMAP,
        },
      },
      /** windows only: if set, use gvisor based network rather than host-resolver/dnsmasq. */
      networkingTunnel: false,
      proxy:            {
        enabled:  false,
        address:  '',
        password: '',
        port:     3128,
        username: '',
        noproxy:  ['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
          '224.0.0.0/4', '240.0.0.0/4'],
      },
    },
  },
};

function getDefaultMemory() {
  if (os.platform() === 'darwin' || os.platform() === 'linux') {
    const totalMemoryInGB = os.totalmem() / 2 ** 30;

    // 25% of available ram up to a maximum of 6gb
    return Math.min(6, Math.round(totalMemoryInGB / 4.0));
  } else {
    return 2;
  }
}

export type UserSettings = typeof defaultSettings;

export type PartialUserSettings = RecursivePartialReadonly<UserSettings>;

function WrapSubtree<T extends SettingsLike>(input: T): RecursiveReadonly<T> {
  const wrappers: Partial<Record<keyof T, RecursiveReadonly<SettingsLike>>> = {};

  return new Proxy(input, {
    get(target, p) {
      if (typeof p !== 'string') {
        throw new TypeError('Symbols are not allowed');
      }
      const value = target[p];

      if (value === undefined || IsSettingLeaf(value)) {
        return value;
      }
      wrappers[p as keyof T] ||= WrapSubtree(value);

      return wrappers[p];
    },
    set() {
      throw new TypeError('Setting default settings is invalid');
    },
  }) as RecursiveReadonly<T>;
}

const settingsLayerDefaults = WrapSubtree(defaultSettings);

export default settingsLayerDefaults;
