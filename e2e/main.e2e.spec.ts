import path from 'path';
import { Application, SpectronClient } from 'spectron';
import { BrowserWindow } from 'electron';
import NavBarPage from './pages/navbar';
import GeneralPage from './pages/general';
import KubernetesPage from './pages/kubernetes';
import PortForwardingPage from './pages/portforwarding';
import ImagesPage from './pages/images';
import TroubleshootingPage from './pages/troubleshooting';
const electronPath = require('electron');

jest.setTimeout(60_000);

describe('Rancher Desktop', () => {
  let app:Application;
  let client: SpectronClient;
  let browserWindow: BrowserWindow;
  let navBarPage: NavBarPage;
  let generalPage: GeneralPage;
  let kubernetesPage: KubernetesPage;
  let portForwardingPage: PortForwardingPage;
  let imagesPage: ImagesPage;
  let troubleShootingPage: TroubleshootingPage;

  beforeAll(async() => {
    app = new Application({
      // 'any' typing is required for now as other alternate usage/import 
      //  cause issues running the tests. Without 'any' typescript
      //  complains of type mismatch.
      path: electronPath as any, 
      args: [path.dirname(__dirname)],
      env:  { SPECTRON_RUN: 'yes' }
    });

    await app.start();
    client = app.client;
    browserWindow = app.browserWindow;
    navBarPage = new NavBarPage(app);
  });

  afterAll(async() => {
    if (app && app.isRunning()) {
      await app.stop();
    }
  });

  it('opens the window', async() => {
    await client.waitUntilWindowLoaded();
    // typescript doesn't see a value of await in below statement, but
    // removing await makes the statement not wait till the app window loads
    // Also, Alternate ways to get the app window title, for example using client
    // didn't work. So, Leaving 'await' for now. We may need to review this and 
    // fix this in future.
    const title =  await browserWindow.getTitle();

    expect(title).toBe('Rancher Desktop');
  });

  it('should display welcome message in general tab', async() => {
    generalPage = await navBarPage.getGeneralPage();

    expect(await generalPage.getTitle()).toBe('Welcome to Rancher Desktop');
  });

  it('should switch to Kubernetes Settings tab', async() => {
    kubernetesPage = await navBarPage.getKubernetesPage();

    expect(await kubernetesPage.getResetKubernetesButtonText()).toBe('Reset Kubernetes');
  });

  it('should switch to Port Forwarding tab', async() => {
    portForwardingPage = await navBarPage.getPortForwardingPage();

    expect(portForwardingPage).not.toBeNull();
  });

  it('should switch to Images tab', async() => {
    imagesPage = await navBarPage.getImagesPage();

    expect(imagesPage).not.toBeNull();
  });

  it('should switch to Troubleshooting tab', async() => {
    troubleShootingPage = await navBarPage.getTroubleshootingPage();

    expect(await troubleShootingPage.getFactoryResetButtonText()).toBe('Factory Reset');
  });
});
