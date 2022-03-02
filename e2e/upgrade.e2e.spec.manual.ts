import os from 'os';
import path from 'path';
import { ElectronApplication, BrowserContext, _electron, Page } from 'playwright';
import { test, expect } from '@playwright/test';
import { createDefaultSettings, playwrightReportAssets, kubectl, helm } from './utils/TestUtils';
import { NavPage } from './pages/nav-page';

let page: Page;

async function waitForStartup(appDir: string | undefined, page: Page) {
  expect(page).toBeDefined();

  const navPage = new NavPage(page);

  await navPage.progressBecomesReady();
  await expect(navPage.progressBar).toBeHidden({timeout: 5 * 60 * 1000});

  const output = await kubectl({ appDir }, 'cluster-info');

  expect(output).toMatch(/is running at ./);
}

test.describe('upgraded data', () => {
  test.describe.configure({ mode: 'serial' });
  test.slow();

  let app: ElectronApplication;

  test.afterAll(async() => {
    await app?.context().tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
    await app?.close();
  });

  test('Run old build', async() => {
    createDefaultSettings();
    const appDir = process.env.OLD_DIR;

    expect(appDir).toBeDefined();
    if (!appDir) {
      throw new Error('OLD_DIR not defined');
    }
    app = await _electron.launch({
      acceptDownloads: false,
      cwd:             appDir,
      executablePath:  path.join(appDir, 'rancher-desktop'),
    });
    const context = app.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await app.firstWindow();
  });

  test('Wait for old application to start up', () => waitForStartup(process.env.OLD_DIR, page));

  test('Install application', async() => {
    await helm({ appDir: process.env.OLD_DIR }, 'repo', 'add', 'bitnami', 'https://charts.bitnami.com/bitnami');
    await helm({ appDir: process.env.OLD_DIR }, 'upgrade', '--install', 'wordpress', 'bitnami/wordpress',
      '--set', 'service.type=NodePort',
      '--set', 'volumePermissions.enabled=true',
      '--set', 'mariadb.volumePermissions.enabled=true',
      '--set', 'wordpressPassword=a',
      '--timeout=20m',
      '--wait');
  });

  test('Quit the old version', async() => {
    await app?.context().tracing.stop({ path: playwrightReportAssets(path.basename(__filename)) });
    await app?.close();
  });

  test('Start the new version', async() => {
    const appDir = process.env.NEW_DIR;

    expect(appDir).toBeDefined();
    if (!appDir) {
      throw new Error('NEW_DIR not defined');
    }
    app = await _electron.launch({
      acceptDownloads: false,
      cwd:             appDir,
      executablePath:  path.join(appDir, 'rancher-desktop'),
    });
    const context = app.context();

    await context.tracing.start({ screenshots: true, snapshots: true });
    page = await app.firstWindow();
  });

  test('Wait for new application to startup', () => waitForStartup(process.env.NEW_DIR, page));
});
