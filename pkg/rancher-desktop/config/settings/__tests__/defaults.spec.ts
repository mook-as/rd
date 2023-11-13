import subject from '@pkg/config/settings/defaults';

describe('SettingsLayerDefaults', () => {
  it('should allow reading a value', () => {
    expect(subject.application.debug).toEqual(false);
  });
  it('should disallow setting', () => {
    expect(() => {
      (subject as any).application.debug = true;
    }).toThrow();
  });
});
