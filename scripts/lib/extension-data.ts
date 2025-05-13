/**
 * This file contains routines to manage the extension data at
 * pkg/rancher-desktop/assets/extension-data.yaml
 */

import childProcess from 'child_process';
import fs from 'fs';
import util from 'util';

import yaml from 'yaml';

import { DownloadContext, getPublishedReleaseTagNames, VersionedDependency } from './dependencies';

const EXTENSION_PATH = 'scripts/assets/extension-data.yaml';

/**
 * Information about an extension we manage in the bundled marketplace.
 * This is loaded from `scripts/assets/extension-data.yaml`.
 */
export interface extensionInfo {
  /** Whether this extension is compatible with containerd; defaults to true. */
  containerd_compatible?: boolean;
  /** Override for the logo. */
  logo?: string;
  /** GitHub repository, as "org/repo", used to check for updates. */
  github_repo?: string;
}

export class Extension extends VersionedDependency {
  constructor(ref: string, info: extensionInfo) {
    super();
    const [name, tag] = ref.split(':', 2);

    this.name = name;
    this.currentVersion = Promise.resolve(tag);
    this.info = info;
  }

  /** The extension name, i.e. the image name, including the tag. */
  readonly name: string;
  readonly currentVersion: Promise<string>;
  readonly info: extensionInfo;

  download(context: DownloadContext): Promise<void> {
    // There is no download for marketplace extension data.
    return Promise.resolve();
  }

  async getAvailableVersions(): Promise<string[]> {
    if (!this.info.github_repo) {
      return Promise.resolve([]);
    }
    const [owner, repo] = this.info.github_repo.split('/', 2);

    return await getPublishedReleaseTagNames(owner, repo);
  }

  async updateManifest(newVersion: string): Promise<Set<string>> {
    // We want to try to keep the YAML comments; so we do string replace instead.
    const fileContents = await fs.promises.readFile(EXTENSION_PATH, 'utf-8');
    const oldRef = `${ this.name }:${ await this.currentVersion }`;
    const newRef = `${ this.name }:${ newVersion }`;
    const newContents = fileContents.replaceAll(oldRef, newRef);

    console.log({fileContents, newContents, oldRef, newRef});
    await fs.promises.writeFile(EXTENSION_PATH, newContents, 'utf-8');

    return new Set([EXTENSION_PATH]);
  }

  async generateMarketplaceData() {
    const ref = `${ this.name }:${ await this.currentVersion }`;
    const execFile = util.promisify(childProcess.execFile);
    const { stdout:out } = await execFile('docker', ['image', 'list', '--format=json', ref]);

    if (!out.trim()) {
      // Image not found
      console.log(`Pulling image ${ ref }`);
      await execFile('docker', ['pull', ref]);
    }
    const { stdout } = await execFile('docker', ['inspect', ref]);
    const data = JSON.parse(stdout)[0];
    const labels = data.Config.Labels;

    return {
      slug:                  this.name,
      version:               await this.currentVersion,
      containerd_compatible: this.info.containerd_compatible ?? true,
      labels,
      title:                 labels['org.opencontainers.image.title'],
      logo:                  this.info.logo ?? labels['com.docker.desktop.extension.icon'],
      publisher:             labels['org.opencontainers.image.vendor'],
      short_description:     labels['org.opencontainers.image.description'],
    };
  }
}

export function getExtensions(withGitHubRepo = false): Extension[] {
  const infoData: Record<string, extensionInfo> = yaml.parse(fs.readFileSync(EXTENSION_PATH, 'utf-8'));
  let entries = Object.entries(infoData);

  if (withGitHubRepo) {
    entries = entries.filter(([, e]) => !!e.github_repo);
  }

  return entries.map(([ref, info]) => new Extension(ref, info));
}
