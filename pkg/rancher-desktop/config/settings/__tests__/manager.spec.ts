import { UserSettings, defaultSettings } from '../defaults';
import { SettingsManager } from '../manager';
import { SettingsLayerTransient, defaultTransientSettings } from '../transient';
import transientSettingsValidator from '../transientValidator';
import { SettingsLayerUser } from '../user';
import userSettingsValidator from '../userValidator';

class SettingsLayerUserNoDisk extends SettingsLayerUser<UserSettings> {
  override load() {
    this.settings = {};

    return Promise.resolve();
  }

  override save() {
    return Promise.resolve();
  }
}

describe('SettingsManager', () => {
  let subject: SettingsManager;

  beforeEach(async() => {
    subject = new SettingsManager();
    // Override the user layer to not read/write to disk
    subject['userLayer'] = new SettingsLayerUserNoDisk(defaultSettings, userSettingsValidator);

    // Override the transient layer to avoid affecting other tests
    subject['transientLayer'] = new SettingsLayerTransient(defaultTransientSettings, transientSettingsValidator);

    subject.loadTransient({});
    await subject.loadDeploymentProfiles();
    await subject.loadUser();
  });

  it('should fetch a default setting', () => {
    expect(subject.get('application.debug')).toBeFalsy();
  });
  it('should fetch a user setting that had been changed', async() => {
    await expect(subject.set({ application: { debug: true } })).resolves.toHaveProperty('errors', []);
    expect(subject.get('application.debug')).toBeTruthy();
  });
  it('should fetch merged settings', async() => {
    await expect(subject.set({ application: { debug: true } })).resolves.toHaveProperty('errors', []);
    expect(subject.get('application')).toMatchObject({
      debug:       true,
      adminAccess: false,
    });
  });
  it.todo('should read default deployment profiles');
  it.todo('should read locked deployment profiles');
  it.todo('should not allow setting locked settings');
  it('should set and fetch transient settings', async() => {
    expect(subject.get('noModalDialogs')).toBeFalsy();
    await expect(subject.setTransient({ noModalDialogs: true })).resolves.toHaveProperty('errors', []);
    expect(subject.get('noModalDialogs')).toBeTruthy();
  });
});
