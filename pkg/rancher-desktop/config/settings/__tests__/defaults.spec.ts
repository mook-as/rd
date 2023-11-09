import subject from '@pkg/config/settings/defaults';

describe('SettingsLayerDefaults', () => {
  it('should allow reading a value', () => {
    expect(subject.get('application.debug')).toEqual(false);
  });
});
