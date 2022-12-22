import { VMExecutor } from '@pkg/backend/backend';
import { ContainerEngineClient, ContainerRunOptions } from '@pkg/backend/containerEngine';
import { spawnFile } from '@pkg/utils/childProcess';
import Logging from '@pkg/utils/logging';
import { executable } from '@pkg/utils/resources';
import { defined } from '@pkg/utils/typeUtils';

const console = Logging.moby;

export default class MobyClient implements ContainerEngineClient {
  constructor(vm: VMExecutor, endpoint: string) {
    this.vm = vm;
    this.endpoint = endpoint;
  }

  readonly vm: VMExecutor;
  readonly executable = executable('docker');
  readonly endpoint: string;

  /**
   * Run docker (CLI) with the given arguments, returning stdout.
   * @param args
   * @returns
   */
  protected async runTool(...args: string[]): Promise<string> {
    const { stdout } = await spawnFile(
      this.executable,
      args,
      { stdio: ['ignore', 'pipe', console], env: { DOCKER_HOST: this.endpoint } });

    return stdout;
  }

  protected async makeContainer(imageID: string): Promise<string> {
    const container = (await this.runTool('create', '--entrypoint=/', imageID)).split(/\r?\n/).pop()?.trim();

    if (!container) {
      throw new Error(`Failed to create container ${ imageID }`);
    }

    return container;
  }

  readFile(imageID: string, filePath: string): Promise<string>;
  readFile(imageID: string, filePath: string, options: { encoding?: BufferEncoding; }): Promise<string>;
  async readFile(imageID: string, filePath: string, options?: { encoding?: BufferEncoding }): Promise<string> {
    const encoding = options?.encoding ?? 'utf-8';
    const container = await this.makeContainer(imageID);

    try {
      const stdout = await this.runTool('cp', `${ container }:${ filePath }`, '-');

      return Buffer.from(stdout).toString(encoding);
    } finally {
      await spawnFile(this.executable, ['rm', container], { stdio: console });
    }
  }

  copyFile(imageID: string, sourcePath: string, destinationPath: string): Promise<void>;
  copyFile(imageID: string, sourcePath: string, destinationPath: string, options: { resolveSymlinks: false; }): Promise<void>;
  async copyFile(imageID: string, sourcePath: string, destinationPath: string, options?: { resolveSymlinks?: boolean }): Promise<void> {
    const resolveSymlinks = options?.resolveSymlinks !== false;
    const container = await this.makeContainer(imageID);

    try {
      const args = ['cp', resolveSymlinks ? '--follow-link' : undefined, `${ container }:${ sourcePath }`, destinationPath].filter(defined);

      await spawnFile(this.executable, args, { stdio: console });
    } finally {
      await spawnFile(this.executable, ['rm', container], { stdio: console });
    }
  }

  async run(imageID: string, options?: ContainerRunOptions): Promise<string> {
    const args = ['container', 'run', '--detach'];

    args.push('--restart', options?.restart === 'always' ? 'always' : 'no');
    if (options?.name) {
      args.push('--name', options.name);
    }
    args.push(imageID);

    return (await this.runTool(...args)).trim();
  }
}
