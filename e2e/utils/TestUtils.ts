/**
 * TestUtils exports functions required for the E2E test specs.
 */
import os from 'os';
import fs from 'fs';
import path from 'path';
import paths from '../../src/utils/paths';
import * as childProcess from '../../src/utils/childProcess';

/**
 * Create empty default settings to bypass gracefully
 * FirstPage window.
 */
export function createDefaultSettings() {
  createSettingsFile(paths.config);
}

function createSettingsFile(settingsDir: string) {
  const settingsData = '{}';
  const settingsJson = JSON.stringify(settingsData);
  const fileSettingsName = 'settings.json';
  const settingsFullPath = path.join(settingsDir, fileSettingsName);

  if (!fs.existsSync(settingsFullPath)) {
    fs.mkdirSync(settingsDir, { recursive: true });
    fs.writeFileSync(path.join(settingsDir, fileSettingsName), settingsJson);
    console.log('Default settings file successfully created on: ', `${ settingsDir }/${ fileSettingsName }`);
  } else {
    try {
      const contents = fs.readFileSync(settingsFullPath, { encoding: 'utf-8' });
      const settings = JSON.parse(contents.toString());

      if (settings.kubernetes?.enabled === false) {
        console.log(`Warning: updating settings.kubernetes.enabled to true.`);
        settings.kubernetes.enabled = true;
        fs.writeFileSync(settingsFullPath, JSON.stringify(settings), { encoding: 'utf-8' });
      }
    } catch (err) {
      console.log(`Failed to process ${ settingsFullPath }: ${ err }`);
    }
  }
}

/**
 * Create playwright trace package based on the spec file name.
 * @returns path string along with spec file
 * @example main.e2e.spec.ts-pw-trace.zip
 */
export function playwrightReportAssets(fileName: string) {
  return path.join(__dirname, '..', 'reports', `${ fileName }-pw-trace.zip`);
}

/**
 * helm teardown
 * it ensure that all helm test installation contents will be deleted.
 */
export async function tearDownHelm() {
  await helm('repo', 'remove', 'bitnami');
  await kubectl('delete', 'deploy', 'nginx-sample', '--namespace', 'default');
}

/**
 * Run the given tool with the given arguments, returning its standard output.
 */
export async function tool(options: {tool: string, appDir?: string}, ...args: string[]): Promise<string> {
  const packagedPath = os.platform() === 'darwin' ? ['Contents', 'Resources'] : ['resources'];
  const appDir = options.appDir ? path.join(options.appDir, ...packagedPath) : path.join(path.dirname(__dirname), '..');
  const filename = os.platform().startsWith('win') ? `${ options.tool }.exe` : options.tool;
  const exe = path.join(appDir, 'resources', os.platform(), 'bin', filename);

  try {
    console.log(`Running ${ exe } ${ args.join(' ') }...`);
    const { stdout, stderr } = await childProcess.spawnFile(exe, args, { stdio: 'pipe' });

    console.log(stderr);

    return stdout;
  } catch (ex:any) {
    console.error(`Error running ${ options.tool } ${ args.join(' ') }`, ex);
    console.error(`stdout: ${ ex.stdout }`);
    console.error(`stderr: ${ ex.stderr }`);
    throw ex;
  }
}

/**
 * Run `kubectl` with given arguments.
 * @returns standard output of the command.
 * @example await kubectl('version')
 */
export async function kubectl(options: {appDir?: string}, ...args: string[]): Promise<string>;
export async function kubectl(...args: string[]): Promise<string>;
export async function kubectl(optionOrArg: {appDir?: string} | string, ...args: string[] ): Promise<string> {
  const options: {tool: string, appDir?: string} = { tool: 'kubectl' };

  if (typeof optionOrArg === 'string') {
    args.unshift(optionOrArg);
  } else {
    Object.assign(options, optionOrArg);
  }

  return await tool(options, '--context', 'rancher-desktop', ...args);
}

/**
 * Run `helm` with given arguments.
 * @returns standard output of the command.
 * @example await helm('version')
 */
export async function helm(options: {appDir?: string}, ...args: string[]): Promise<string>;
export async function helm(...args: string[]): Promise<string>;
export async function helm(optionOrArg: {appDir?: string} | string, ...args: string[] ): Promise<string> {
  const options: {tool: string, appDir?: string} = { tool: 'helm' };

  if (typeof optionOrArg === 'string') {
    args.unshift(optionOrArg);
  } else {
    Object.assign(options, optionOrArg);
  }

  return await tool(options, '--kube-context', 'rancher-desktop', ...args);
}
