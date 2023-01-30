/**
 * This is the preload script dealing with extensions.
 */

import { contextBridge } from 'electron';

import type { SpawnOptions } from '@pkg/main/extensions/types';
import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import Latch from '@pkg/utils/latch';

/* eslint-disable import/namespace -- that rule doesn't work with TypeScript type-only imports. */
import type { v1 } from '@docker/extension-api-client-types';

function isSpawnOptions(options: v1.ExecOptions | v1.SpawnOptions): options is v1.SpawnOptions {
  return 'stream' in options;
}

// As Electron's contextBridge does not allow custom classes to be passed
// through correctly, we instead create a template object and copy all of its
// properties over.  This is uses more memory (because there's no sharing via
// the prototype), but we should not have so many processes that this is an
// issue.

// We use a bunch of symbols for names of properties we do not want to reflect
// over.
const consumeOutput = Symbol('consumeOutput');
const stream = Symbol('stream');
const stdout = Symbol('stdout');
const stderr = Symbol('stderr');
const id = Symbol('id');
const done = Symbol('done');

interface execReturn {
  /** The identifier for this process. */
  [id]: string;
  [consumeOutput](key: 'stdout' | 'stderr', data: string): void;
  [done]: ReturnType<typeof Latch>;
}

interface execResult extends v1.ExecResult, execReturn {
  killed: boolean;
  code?: number;
  signal?: NodeJS.Signals;
  stdout: string;
  stderr: string;
}

interface execProcess extends v1.ExecProcess, execReturn {
  [stdout]: string;
  [stderr]: string;
  [stream]: v1.ExecStreamOptions;
}

function isProcess(input: execReturn): input is execProcess {
  return 'close' in input;
}

/**
 * execProcessTemplate is the object template used when the caller requests
 * streaming data.
 */
const execProcessTemplate: Omit<execProcess, typeof id | typeof done | typeof stream> = {
  close() {
  },
  [stdout]: '',
  [stderr]: '',
  [consumeOutput](this: execProcess, key, data) {
    if (!data) {
      return;
    }
    const keySym = { stdout, stderr }[key] as typeof stdout | typeof stderr;

    this[keySym] += data;
    while (true) {
      const [_match, line, rest] = /^(.*?)\r?\n(.*)$/s.exec(this[keySym]) ?? [];

      if (typeof line === 'undefined') {
        return;
      }
      this[stream]?.onOutput?.({ [key]: line } as { stdout: string } | { stderr: string });
      this[keySym] = rest;
    }
  },
};

const execResultTemplate: Omit<execResult, typeof id | typeof done> = {
  killed: false,
  lines(): string[] {
    return this.stdout.split(/\r?\n/);
  },
  parseJsonLines(): any[] {
    return this.lines().map(line => JSON.parse(line));
  },
  parseJsonObject() {
    return JSON.parse(this.stdout);
  },
  [consumeOutput](this: execResult, key, data) {
    this[key] += data;
  },
  stdout: '',
  stderr: '',
};

/**
 * The identifier for the extension (the name of the image).
 */
const extensionId = decodeURIComponent((location.href.match(/:\/\/([^/]+)/)?.[1] ?? '').replace(/(..)/g, '%$1'));

/**
 * The processes that are waiting to complete, keyed by the process ID.
 * This uses weak references so that if the user no longer cares about them we
 * will not either.
 */
const outstandingProcesses: Record<string, WeakRef<execResult | execProcess>> = {};

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
function getExec(scope: 'host' | 'vm'): v1.Exec {
  let nextId = 0;

  function exec(cmd: string, args: string[], options?: v1.ExecOptions): Promise<v1.ExecResult>;
  function exec(cmd: string, args: string[], options: v1.SpawnOptions): v1.ExecProcess;
  function exec(cmd: string, args: string[], options?: v1.ExecOptions | v1.SpawnOptions): Promise<v1.ExecResult> | v1.ExecProcess {
    const commandLine = [cmd].concat(args);

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
      extension: extensionId,
      id:        execId,
      scope,
      ...(typeof options?.cwd === 'string' ? { cwd: options.cwd } : {}),
      ...(options?.env ? { env: options.env } : {}),
    };

    if (options && isSpawnOptions(options)) {
      const proc: execProcess = Object.assign({
        [id]:     execId,
        [done]:   Latch(),
        [stdout]: '',
        [stderr]: '',
        [stream]: options.stream,
      }, execProcessTemplate);

      outstandingProcesses[execId] = new WeakRef(proc);
      ipcRenderer.invoke('extension/spawn', commandLine, safeOptions);

      return proc;
    }

    return (async() => {
      const proc: execResult = Object.assign({
        [id]:     execId,
        [done]:   Latch(),
        [stdout]: '',
        [stderr]: '',
      }, execResultTemplate);

      outstandingProcesses[execId] = new WeakRef(proc);
      await proc[done];

      return proc;
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

    return;
  }
  if (isProcess(process)) {
    if (process[stream].onOutput) {
      for (const key of ['stdout', 'stderr'] as const) {
        const input = data[key];

        if (input) {
          process[consumeOutput](key, input);
        }
      }
    }
  } else {
    for (const key of ['stdout', 'stderr'] as const) {
      const input = data[key];

      if (input) {
        process[key] += input;
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

  if (isProcess(process)) {
    process[stream].onError?.(error);
    process[done].resolve();
  } else {
    process.killed = true;
    process[done].reject(error);
  }
});

ipcRenderer.on('extension/spawn/close', (_, id, returnValue) => {
  const process = outstandingProcesses[id]?.deref();

  if (!process) {
    // The process handle has gone away on our side, just try to kill it.
    ipcRenderer.send('extension/spawn/kill', id);
    delete outstandingProcesses[id];

    return;
  }

  if (isProcess(process)) {
    process[stream]?.onClose?.(typeof returnValue === 'number' ? returnValue : -1);
  } else {
    process.killed = true;
    if (typeof returnValue === 'number') {
      process.code = returnValue;
    } else {
      process.signal = returnValue;
    }
  }
  process[done].resolve();
});

class Client implements v1.DockerDesktopClient {
  constructor(info: { platform: string, arch: string, hostname: string }) {
    Object.assign(this.host, info);
  }

  extension: v1.Extension = {
    vm:    {} as v1.ExtensionVM,
    host:  { cli: { exec: getExec('host') } },
    image: extensionId,
  };

  desktopUI: v1.DesktopUI = {} as any;
  host: v1.Host = {
    openExternal: (url: string) => {
      ipcRenderer.send('extension/open-external', url);
    },
    platform: '<unknown>',
    arch:     '<unknown>',
    hostname: '<unknown>',
  };

  docker = {
    cli: { exec: getExec('host') },
    listContainers() {

    },
    listImages() {

    },
  } as any;
}

export default async function initExtensions(): Promise<void> {
  if (document.location.protocol === 'x-rd-extension:') {
    const info = await ipcRenderer.invoke('extension/info');
    const ddClient = new Client(info);

    contextBridge.exposeInMainWorld('ddClient', ddClient);
  } else {
    console.log(`Not doing preload on ${ document.location.protocol }`);
  }
}
