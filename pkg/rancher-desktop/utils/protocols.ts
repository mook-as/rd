import path from 'path';
import { URL } from 'url';

import { app, ProtocolRequest, ProtocolResponse, protocol } from 'electron';

import { isDevEnv } from '@pkg/utils/environment';
import Latch from '@pkg/utils/latch';
import Logging from '@pkg/utils/logging';
import paths from '@pkg/utils/paths';

const console = Logging.background;

/**
 * Create a URL that consists of a base combined with the provided path
 * @param relPath The destination path for the requested resource
 * @returns A URL that consists of the combined base (http://localhost:8888)
 * and provided path
 */
function redirectedUrl(relPath: string) {
  if (isDevEnv) {
    return `http://localhost:8888${ relPath }`;
  }

  return path.join(app.getAppPath(), 'dist', 'app', relPath);
}

function getMimeTypeForPath(filePath: string): string {
  const mimeTypeMap: Record<string, string> = {
    css:  'text/css',
    html: 'text/html',
    js:   'text/javascript',
    json: 'application/json',
    png:  'image/png',
    svg:  'image/svg+xml',
  };
  const mimeType = mimeTypeMap[path.extname(filePath).toLowerCase().replace(/^\./, '')];

  return mimeType || 'text/html';
}

/**
 * Constructs an appropriate protocol response based on the environment
 * (dev, prod, etc...). Used for the registered protocol.
 * @param request The original Electron ProtocolRequest
 * @param redirectUrl The fully-qualified redirect URL
 * @param relPath The relative path to the requested resource
 * @returns A properly structured result for the registered protocol
 */
function getProtocolResponse(
  request: ProtocolRequest,
  redirectUrl: string,
  relPath: string,
): ProtocolResponse {
  if (isDevEnv) {
    return {
      method:   request.method,
      referrer: request.referrer,
      url:      redirectUrl,
    };
  }

  return {
    path:     redirectUrl,
    mimeType: getMimeTypeForPath(relPath),
  };
}

// Latch that is set when the app:// protocol handler has been registered.
// This is used to ensure that we don't attempt to open the window before we've
// done that, when the user attempts to open a second instance of the window.
export const protocolsRegistered = Latch();

/**
 * Set up protocol handler for app://
 * This is needed because in packaged builds we'll not be allowed to access
 * file:// URLs for our resources. Use the same app:// protocol for both dev and
 * production environments.
 */
function setupAppProtocolHandler() {
  const registrationProtocol = isDevEnv ? protocol.registerHttpProtocol : protocol.registerFileProtocol;

  const result = registrationProtocol('app', (request, callback) => {
    console.debug(`Resolving ${ request.url }`);
    const relPath = decodeURI(new URL(request.url).pathname);
    const redirectUrl = redirectedUrl(relPath);
    const result = getProtocolResponse(request, redirectUrl, relPath);

    callback(result);
  });

  console.error(`Registered protocol app://: ${ result }`);
}

/**
 * Set up protocol handler for x-rd-extension://
 *
 * This handler is used for extensions; the format is:
 * x-rd-extensions://<extension id>/...
 * Where the extension id is the extension image id, hex encoded (to avoid
 * issues with slashes).  Base64 was not available in Vue.
 */
function setupExtensionProtocolHandler() {
  const scheme = 'x-rd-extension';
  const ok = protocol.registerFileProtocol(scheme, (request, callback) => {
    console.error(`Resolving ${ request.url }`);
    const url = new URL(request.url);
    const extensionID = Buffer.from(url.hostname, 'hex').toString('ascii');
    const filepath = path.join(paths.extensionRoot, extensionID, url.pathname);
    const result = { path: filepath, mimeType: getMimeTypeForPath(filepath) };

    console.error(`Resolving ${ url } ->`, result);
    callback(result);
  });

  console.error(`Registerd protocol ${ scheme }://: ${ ok }`);
}

export function setupProtocolHandlers() {
  try {
    setupAppProtocolHandler();
    setupExtensionProtocolHandler();

    protocolsRegistered.resolve();
    console.error('protocol handlers registered');
  } catch (ex) {
    console.error('Error registering protocol handlers:', ex);
  }
}
