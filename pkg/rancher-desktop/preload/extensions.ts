/**
 * This is the preload script dealing with extensions.
 */

import { contextBridge } from 'electron';

import { ipcRenderer } from '@pkg/utils/ipcRenderer';
import Latch from '@pkg/utils/latch';

/* eslint-disable import/namespace -- that rule doesn't work with TypeScript type-only imports. */
import type { v1 } from '@docker/extension-api-client-types';

function isSpawnOptions(options: v1.ExecOptions | v1.SpawnOptions): options is v1.SpawnOptions {
  return 'stream' in options;
}

class ExecProcess implements v1.ExecProcess, v1.ExecResult {
  constructor(id: string, stream?: v1.ExecStreamOptions) {
    this.id = id;
    this.stream = stream;

    if (this.stream?.splitOutputLines) {
      this.consumeOutput = (key, data) => {
        if (!data) {
          return;
        }
        this[key] += data;
        while (true) {
          const [_match, line, rest] = /^(.*?)\r?\n(.*)$/s.exec(this[key]) ?? [];

          if (typeof line === 'undefined') {
            return;
          }
          this.stream?.onOutput?.({ [key]: line } as { stdout: string } | { stderr: string });
          this[key] = rest;
        }
      };
    }
  }

  /** The identifier for this process. */
  id: string;
  stream?: v1.ExecStreamOptions;

  close(): void {
    throw new Error('Method not implemented.');
  }

  lines(): string[] {
    return this.stdout.split(/\r?\n/);
  }

  parseJsonLines(): any[] {
    return this.lines().map(line => JSON.parse(line));
  }

  parseJsonObject() {
    return JSON.parse(this.stdout);
  }

  cmd?: string | undefined;
  killed?: boolean | undefined;
  signal?: string | undefined;
  code?: number | undefined;
  stdout = '';
  stderr = '';
  done = Latch();

  consumeOutput: (key: 'stdout' | 'stderr', data: string) => void = (key, data) => {
    this.stream?.onOutput?.({ [key]: data } as { stdout: string } | { stderr: string });
  };
}

/**
 * The processes that are waiting to complete, keyed by the process ID.
 * This uses weak references so that if the user no longer cares about them we
 * will not either.
 */
const outstandingProcesses: Record<string, WeakRef<ExecProcess>> = {};

/**
 * Return an exec function for the given scope.
 * @param scope Whether to run the command on the VM or in the host.
 */
function getExec(scope: 'host' | 'vm'): v1.Exec {
  let nextId = 0;

  function exec(cmd: string, args: string[], options?: v1.ExecOptions): Promise<v1.ExecResult>;
  function exec(cmd: string, args: string[], options: v1.SpawnOptions): v1.ExecProcess;
  function exec(cmd: string, args: string[], options?: v1.ExecOptions | v1.SpawnOptions): Promise<v1.ExecResult> | v1.ExecProcess {
    const isSpawn = options && isSpawnOptions(options);
    const commandLine = [cmd].concat(args);
    const process = new ExecProcess(`${ scope }-${ nextId++ }`, isSpawn ? options.stream : undefined);

    outstandingProcesses[process.id] = new WeakRef(process);
    process.cmd = commandLine.join(' ');
    if (isSpawn) {
      ipcRenderer.invoke('extension/spawn', commandLine, {
        id: process.id, scope, ...options,
      });

      return process;
    }

    return (async() => {
      await ipcRenderer.invoke('extension/spawn', commandLine, {
        id: process.id, scope, ...options,
      });
      await process.done;

      return process;
    })();
  }

  return exec;
}

ipcRenderer.on('extension/spawn/output', (_, id, data) => {
  const process = outstandingProcesses[id]?.deref();

  if (!process) {
    // The process handle has gone away on our side, no need to do anything.
    delete outstandingProcesses[id];

    return;
  }
  if (process.stream) {
    if (process.stream.onOutput) {
      for (const key of ['stdout', 'stderr'] as const) {
        const input = data[key];

        if (input) {
          process.consumeOutput(key, input);
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
    // The process handle has gone away on our side, no need to do anything.
    delete outstandingProcesses[id];

    return;
  }

  if (process.stream) {
    process.stream.onError?.(error);
  } else {
    process.killed = true;
    if (typeof error === 'string') {
      process.signal = error;
    } else if (typeof error === 'number') {
      process.code = error;
    } else {
      process.done.reject(error);

      return;
    }
  }
  process.done.resolve();
});

ipcRenderer.on('extension/spawn/close', (_, id, exitCode) => {
  const process = outstandingProcesses[id]?.deref();

  if (!process) {
    // The process handle has gone away on our side, no need to do anything.
    delete outstandingProcesses[id];

    return;
  }

  if (process.stream) {
    process.stream.onClose?.(exitCode);
  }

  process.killed = true;
  process.code = exitCode;
  process.done.resolve();
});

class Client implements v1.DockerDesktopClient {
  extension: v1.Extension = {} as any;
  desktopUI: v1.DesktopUI = {} as any;
  host: v1.Host = {
    openExternal: (url: string) => {
      ipcRenderer.send('extension/open-external', url);
    },
  } as any;

  docker = {
    cli: { exec: getExec('host') },
    listContainers() {

    },
    listImages() {

    },
  } as any;
}

export default function initExtensions(): Promise<void> {
  if (document.location.protocol === 'x-rd-extension:') {
    const ddClient = new Client();

    contextBridge.exposeInMainWorld('ddClient', ddClient);
  } else {
    console.log(`Not doing preload on ${ document.location.protocol }`);
  }

  return Promise.resolve();
}
