import os from 'os';

import { test, expect, _electron } from '@playwright/test';

import { NavPage } from './pages/nav-page';
import { createDefaultSettings, startRancherDesktop, teardown, tool } from './utils/TestUtils';

import { Settings } from '@pkg/config/settings';
import { reopenLogs } from '@pkg/utils/logging';

import type { ElectronApplication, Page } from '@playwright/test';

let page: Page;

/**
 * Using test.describe.serial make the test execute step by step, as described on each `test()` order
 * Playwright executes test in parallel by default and it will not work for our app backend loading process.
 * */
test.describe.serial('Container Engine', () => {
  let electronApp: ElectronApplication;

  test.beforeAll(async() => {
    await tool('rdctl', 'factory-reset', '--verbose');
    reopenLogs();
  });

  test.beforeAll(async() => {
    createDefaultSettings({ application: { adminAccess: false } });

    electronApp = await startRancherDesktop(__filename, { mock: false });
    page = await electronApp.firstWindow();
  });

  test.afterAll(() => teardown(electronApp, __filename));

  test('wait for the container engine to be ready', async() => {
    const navPage = new NavPage(page);

    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();
  });

  test('should run uname -m on containers from different architectures', async() => {
    test.skip(os.platform() === 'win32', 'binfmt_misc is not supported on Windows');
    // Are we running moby or containerd? Run tests with that engine first,
    // and then switch to the other.
    const navPage = new NavPage(page);
    const settings: Settings = JSON.parse(await tool('rdctl', 'list-settings'));
    const engine = settings.containerEngine.name;
    const [otherEngine, toolName, otherToolName] = engine === 'containerd' ? ['moby', 'nerdctl', 'docker'] : ['containerd', 'docker', 'nerdctl'];

    // Run `uname -m` on two platforms using a more complex syntax
    // nerdctl/docker run --rm --platform linux/amd64 --entrypoint uname busybox -m
    //
    // These tests also verify that `busybox` is getting a correct `argv[0]` after emulator/interpreter processing
    expect(await tool(toolName, 'run', '--rm', '--platform', 'linux/amd64', '--entrypoint', 'uname', 'busybox', '-m'))
      .toContain('x86_64');
    expect(await tool(toolName, 'run', '--rm', '--platform', 'linux/arm64', '--entrypoint', 'uname', 'busybox', '-m'))
      .toContain('aarch64');

    await tool('rdctl', 'set', '--container-engine', otherEngine);
    await expect(navPage.progressBar).not.toBeHidden();
    await navPage.progressBecomesReady();
    await expect(navPage.progressBar).toBeHidden();

    // And run the same tests with the other container command
    expect(await tool(otherToolName, 'run', '--rm', '--platform', 'linux/amd64', '--entrypoint', 'uname', 'busybox', '-m'))
      .toContain('x86_64');
    expect(await tool(otherToolName, 'run', '--rm', '--platform', 'linux/arm64', '--entrypoint', 'uname', 'busybox', '-m'))
      .toContain('aarch64');
  });
});
