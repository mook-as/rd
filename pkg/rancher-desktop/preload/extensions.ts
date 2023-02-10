/**
 * This is the preload script dealing with extensions.
 */

import { contextBridge } from 'electron';

import type { SpawnOptions } from '@pkg/main/extensions/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';

/* eslint-disable import/namespace -- that rule doesn't work with TypeScript type-only imports. */
import type { v1 } from '@docker/extension-api-client-types';
import type { OpenDialogOptions } from 'electron';

function isSpawnOptions(options: v1.ExecOptions | v1.SpawnOptions): options is v1.SpawnOptions {
  return 'stream' in options;
}

/** execScope is a marker for execution scope for the exec() functions. */
type execScope = 'vm' | 'docker-cli' | 'host';

// As Electron's contextBridge does not allow custom classes to be passed
// through correctly, we instead create a template object and copy all of its
// properties over.  This is uses more memory (because there's no sharing via
// the prototype), but we should not have so many processes that this is an
// issue.

// We use a bunch of symbols for names of properties we do not want to reflect
// over.
const stream = Symbol('stream');
const stdout = Symbol('stdout');
const stderr = Symbol('stderr');
const id = Symbol('id');

interface execProcess extends v1.ExecProcess {
  /** The identifier for this process. */
  [id]: string;
  [stdout]: string;
  [stderr]: string;
  [stream]: v1.ExecStreamOptions;
}

/**
 * The identifier for the extension (the name of the image).
 */
const extensionId = decodeURIComponent((location.href.match(/:\/\/([^/]+)/)?.[1] ?? '').replace(/(..)/g, '%$1'));

/**
 * The processes that are waiting to complete, keyed by the process ID.
 * This uses weak references so that if the user no longer cares about them we
 * will not either.
 */
const outstandingProcesses: Record<string, WeakRef<execProcess>> = {};

function getTypeErrorMessage(name: string, expectedType: string, object: any) {
  let message = `[ERROR_INVALID_ARG_TYPE]: The "${ name }" argument must be of type ${ expectedType }.`;

  if (typeof object === 'object' && 'constructor' in object && 'name' in object.constructor.name) {
    message += ` Received an instance of ${ object.constructor.name }`;
  } else {
    message += ` Received ${ typeof object }`;
  }

  return message;
}

/**
 * Return an exec function for the given scope.
 * @param scope Whether to run the command on the VM or in the host.
 */
function getExec(scope: execScope): v1.Exec {
  let nextId = 0;

  function exec(cmd: string, args: string[], options?: v1.ExecOptions): Promise<v1.ExecResult>;
  function exec(cmd: string, args: string[], options: v1.SpawnOptions): v1.ExecProcess;
  function exec(cmd: string, args: string[], options?: v1.ExecOptions | v1.SpawnOptions): Promise<v1.ExecResult> | v1.ExecProcess {
    // Do some minimal parameter validation, since passing these to the backend
    // directly can end up with confusing messages otherwise.
    if (typeof cmd !== 'string') {
      throw new TypeError(getTypeErrorMessage('cmd', 'string', cmd));
    }
    if (!Array.isArray(args)) {
      throw new TypeError(getTypeErrorMessage('args', 'array', args));
    }
    for (const [i, arg] of Object.entries(args)) {
      if (typeof arg !== 'string') {
        throw new TypeError(getTypeErrorMessage(`args[${ i }]`, 'string', arg));
      }
    }
    if (!['undefined', 'string'].includes(typeof options?.cwd)) {
      throw new TypeError(getTypeErrorMessage('options.cwd', 'string', options?.cwd));
    }
    if (typeof options?.env !== 'undefined') {
      if (typeof options.env !== 'object') {
        throw new TypeError(getTypeErrorMessage('options.env', 'object', options.env));
      }
      for (const [k, v] of Object.entries(options.env)) {
        if (!['undefined', 'string'].includes(typeof v)) {
          throw new TypeError(getTypeErrorMessage(`options.env.${ k }`, 'string', v));
        }
      }
    }

    const execId = `${ scope }-${ nextId++ }`;
    // Build options to pass to the main process, while not trusting the input
    // too much.
    const safeOptions: SpawnOptions = {
      command:   [cmd].concat(args),
      extension: extensionId,
      id:        execId,
      scope,
      ...(typeof options?.cwd === 'string' ? { cwd: options.cwd } : {}),
      ...(options?.env ? { env: options.env } : {}),
    };

    if (options && isSpawnOptions(options)) {
      const proc: execProcess = {
        [id]:     execId,
        [stdout]: '',
        [stderr]: '',
        [stream]: options.stream,
        close() {
          ipcRenderer.send('extension/spawn/kill', execId);
          delete outstandingProcesses[execId];
        },
      };

      outstandingProcesses[execId] = new WeakRef(proc);
      ipcRenderer.send('extension/spawn/streaming', safeOptions);

      return proc;
    }

    return (async() => {
      const response = await ipcRenderer.invoke('extension/spawn/blocking', safeOptions);

      return {
        ...response,
        lines() {
          return response.stdout.split(/\r?\n/);
        },
        parseJsonLines() {
          return response.stdout.split(/\r?\n/).filter(line => line).map(line => JSON.parse(line));
        },
        parseJsonObject() {
          return JSON.parse(response.stdout);
        },
      };
    })();
  }

  return exec;
}

ipcRenderer.on('extension/spawn/output', (_, id, data) => {
  const process = outstandingProcesses[id]?.deref();

  if (!process) {
    // The process handle has gone away on our side, just try to kill it.
    ipcRenderer.send('extension/spawn/kill', id);
    delete outstandingProcesses[id];
    console.debug(`Process ${ id } not found, discarding.`);

    return;
  }
  if (process[stream].onOutput) {
    for (const key of ['stdout', 'stderr'] as const) {
      const input = data[key];
      const keySym = { stdout, stderr }[key] as typeof stdout | typeof stderr;

      if (input) {
        process[keySym] += input;
        while (true) {
          const [_match, line, rest] = /^(.*?)\r?\n(.*)$/s.exec(process[keySym]) ?? [];

          if (typeof line === 'undefined') {
            return;
          }
          process[stream].onOutput?.({ [key]: line } as {stdout:string} | {stderr:string});
          process[keySym] = rest;
        }
      }
    }
  }
});

ipcRenderer.on('extension/spawn/error', (_, id, error) => {
  const process = outstandingProcesses[id]?.deref();

  if (!process) {
    // The process handle has gone away on our side, just try to kill it.
    ipcRenderer.send('extension/spawn/kill', id);
    delete outstandingProcesses[id];

    return;
  }

  process[stream].onError?.(error);
});

ipcRenderer.on('extension/spawn/close', (_, id, returnValue) => {
  const process = outstandingProcesses[id]?.deref();

  if (!process) {
    // The process handle has gone away on our side, just try to kill it.
    ipcRenderer.send('extension/spawn/kill', id);
    delete outstandingProcesses[id];

    return;
  }

  process[stream]?.onClose?.(typeof returnValue === 'number' ? returnValue : -1);
});

class Client implements v1.DockerDesktopClient {
  constructor(info: { platform: string, arch: string, hostname: string }) {
    Object.assign(this.host, info);
  }

  extension: v1.Extension = {
    vm: {
      service: {
        get: (url) => {
          return this.extension.vm?.service?.request({
            url, method: 'GET', headers: {}, data: undefined,
          });
        },
        post(url, data) {
          return this.request({
            url, method: 'POST', headers: {}, data,
          });
        },
        put(url, data) {
          return this.request({
            url, method: 'PUT', headers: {}, data,
          });
        },
        patch(url, data) {
          return this.request({
            url, method: 'PATCH', headers: {}, data,
          });
        },
        delete(url) {
          return this.request({
            url, method: 'DELETE', headers: {}, data: undefined,
          });
        },
        head(url) {
          return this.request({
            url, method: 'HEAD', headers: {}, data: undefined,
          });
        },
        request: async(config) => {
          console.debug('Making API request', config);

          try {
            const result = await ipcRenderer.invoke('extension/vm/httpFetch', config);

            console.debug(`${ config.url } response:`, result);

            try {
              return JSON.parse(result);
            } catch (ex) {
              return result;
            }
          } catch (ex) {
            console.debug(`${ config.url } error:`, ex);
            throw ex;
          }
        },
      },
    } as v1.ExtensionVM,
    host:  { cli: { exec: getExec('host') } },
    image: extensionId,
  };

  desktopUI: v1.DesktopUI = {
    dialog: {
      showOpenDialog(options: OpenDialogOptions): Promise<v1.OpenDialogResult> {
        return ipcRenderer.invoke('extension/dialog/showOpenDialog', options ?? {});
      },
    },
    navigate: {} as any,
    toast:    {
      success(message) {
        ipcRenderer.send('extension/ui/toast', 'success', String(message));
      },
      warning(message) {
        ipcRenderer.send('extension/ui/toast', 'warning', String(message));
      },
      error(message) {
        ipcRenderer.send('extension/ui/toast', 'error', String(message));
      },
    },
  };

  host: v1.Host = {
    openExternal: (url: string) => {
      ipcRenderer.send('extension/open-external', url);
    },
    platform: '<unknown>',
    arch:     '<unknown>',
    hostname: '<unknown>',
  };

  docker = {
    cli:            { exec: getExec('docker-cli') },
    listContainers: async(options: {all?: boolean, limit?: number, size?: boolean, filters?: string} = {}) => {
      const args = ['ls', '--format={{json .}}'];

      args.push(`--all=${ options.all ?? false }`);
      if ((options.limit ?? -1) > -1) {
        args.push(`--last=${ options.limit }`);
      }
      args.push(`--size=${ options.size ?? false }`);
      if (options.filters !== undefined) {
        args.push(`--filter=${ options.filters }`);
      }

      return (await this.docker.cli.exec('container', args)).parseJsonObject();
    },
    listImages: async(options: {all?: boolean, filters?: string, digests?: boolean} = {}) => {
      const args = ['ls', '--format={{json .}'];

      args.push(`--all=${ options.all ?? false }`);
      if (options.filters !== undefined) {
        args.push(`--filter=${ options.filters }`);
      }
      args.push(`--digests=${ options.digests ?? false }`);

      return (await this.docker.cli.exec('image', args)).parseJsonObject();
    },
  };
}

export default async function initExtensions(): Promise<void> {
  if (document.location.protocol === 'x-rd-extension:') {
    const info = await ipcRenderer.invoke('extension/info');
    const ddClient = new Client(info);

    contextBridge.exposeInMainWorld('ddClient', ddClient);
  } else {
    console.debug(`Not doing preload on ${ document.location.protocol }`);
  }
}
