/**
 * This file contains the main process side code to install extensions.
 * @see @pkg/extensions for the renderer process code.
 */

import type { ContainerEngineClient } from '@pkg/backend/containerEngine';
import { Settings } from '@pkg/config/settings';

export type ExtensionMetadata = {
  icon: string;
  ui?: Record<string, { title: string, root: string, src: string }>;
  vm: { image: string } | { composefile: string } | {};
  host?: { binaries: Record<'darwin' | 'windows' | 'linux', { path: string }[]>[] };
};

/**
 * A singular extension (identified by an image ID).
 * @note A reference of an extension does not imply that it is installed;
 * therefore, some operations may not be valid for uninstall extensions.
 */
export interface Extension {
  /**
   * The image ID for this extension.
   */
  readonly id: string;

  /**
   * Metadata for this extension.
   */
  readonly metadata: Promise<ExtensionMetadata>;

  /**
   * Install this extension.
   * @note If the extension is already installed, this is a no-op.
   * @return Whether the extension was installed.
   */
  install(): Promise<boolean>;
  /**
   * Uninstall this extension.
   * @note If the extension was not installed, this is a no-op.
   * @returns Whether the extension was uninstalled.
   */
  uninstall(): Promise<boolean>;

  /**
   * Extract the given file from the image.
   * @param sourcePath The name of the file (or directory) to extract, relative
   * to the root of the image; for example, `metadata.json`.
   * @param destinationPath The directory to extract into.  If this does not
   * exist and `sourcePath` is a file (rather than a directory), the contents
   * are written directly to the named file (rather than treating it as a
   * directory name).
   */
  extractFile(sourcePath: string, destinationPath: string): Promise<void>;
}

export interface ExtensionManager {
  readonly client: ContainerEngineClient;

  init(config: Settings): Promise<void>;

  /**
   * Get the given extension.
   * @param id The image ID of the extension.
   * @note This may cause the given image to be downloaded.
   * @note The extension will not be automatically installed.
   */
  getExtension(id: string): Extension;

  /**
   * Shut down the extension manager, doing any clean up necessary.
   */
  shutdown(): Promise<void>;
}
