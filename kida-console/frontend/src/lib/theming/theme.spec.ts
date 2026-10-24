import { TestBed } from '@angular/core/testing';
import { ThemeConfig, bootstrapTheme, resolveAppearance, themeKey, validateConfig } from './model';
import { THEME_STORAGE, ThemeService, provideTheming } from './theme.service';

// Intentionally independent of KIDA's catalog and integration.
const config: ThemeConfig = {
  namespace: 'test:themes',
  initial: { theme: 'first', mode: 'light' },
  themes: [
    { id: 'first', modes: ['light', 'dark'], defaultMode: 'light' },
    { id: 'second', modes: ['light'], defaultMode: 'light' },
    { id: 'third', modes: ['dark'], defaultMode: 'dark' },
    { id: 'night', modes: ['dark'], defaultMode: 'dark' },
    { id: 'fifth', modes: ['light', 'dark'], defaultMode: 'dark' },
  ],
};
const record = (theme = 'fifth', mode = 'dark', version = 1) =>
  JSON.stringify({ version, theme, mode });

describe('Portable theming engine', () => {
  let values: Map<string, string>;
  let storage: {
    getItem: ReturnType<typeof vi.fn<(key: string) => string | null>>;
    setItem: ReturnType<typeof vi.fn<(key: string, value: string) => void>>;
  };
  function service() {
    return TestBed.inject(ThemeService);
  }
  function event(key: string | null, newValue = record('night')) {
    // Deliberately stale payload: the listener must read current storage.
    window.dispatchEvent(new StorageEvent('storage', { key, newValue }));
  }
  beforeEach(() => {
    values = new Map();
    storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    TestBed.configureTestingModule({
      providers: [provideTheming(config), { provide: THEME_STORAGE, useValue: storage }],
    });
  });
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-pending');
  });

  it('accepts a new catalog entry without engine changes and keeps preferred mode', () => {
    const themes = service();
    themes.selectTheme('fifth');
    themes.selectMode('light');
    themes.selectTheme('night');
    expect(themes.appearance()).toEqual({ theme: 'night', preferredMode: 'light', mode: 'dark' });
    themes.selectTheme('fifth');
    expect(themes.mode()).toBe('light');
    expect(() => themes.selectTheme('missing')).toThrow();
    themes.selectTheme('night');
    expect(() => themes.selectMode('light')).toThrow();
  });
  it.each([
    { ...config, themes: [] },
    { ...config, namespace: '' },
    { ...config, themes: [config.themes[0], config.themes[0]] },
    { ...config, themes: [{ id: 'bad id', modes: ['light'], defaultMode: 'light' }] },
    { ...config, themes: [{ id: 'bad', modes: ['light'], defaultMode: 'dark' }] },
    { ...config, themes: [{ id: 'bad', modes: ['system'], defaultMode: 'system' }] },
    { ...config, initial: { theme: 'missing', mode: 'light' } },
  ])('rejects incompatible configuration %j', (value) => {
    expect(() => validateConfig(value as ThemeConfig)).toThrow();
  });
  it.each([
    null,
    '{',
    'null',
    '[]',
    record('missing'),
    record('fifth', 'system'),
    record('fifth', 'dark', 2),
  ])('resolves invalid preference %s without rewriting it', (raw) => {
    values.set(themeKey(config, null), raw!);
    expect(service().appearance()).toEqual(resolveAppearance(config, null));
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('replaces an unknown schema only on explicit selection', () => {
    const key = themeKey(config, '1');
    values.set(key, record('fifth', 'dark', 42));
    const themes = service();
    themes.setScope('1');
    expect(values.get(key)).toContain('42');
    themes.selectTheme('fifth');
    expect(JSON.parse(values.get(key)!).version).toBe(1);
  });
  it('resolves accounts independently and keeps the appearance after logout', () => {
    values.set(themeKey(config, null), record());
    const themes = service();
    expect(themes.theme()).toBe('fifth');
    themes.setScope('1');
    expect(themes.theme()).toBe('first');
    themes.selectTheme('night');
    expect(values.get(themeKey(config, '1'))).toBe(values.get(themeKey(config, null)));
    themes.setScope('2');
    expect(themes.theme()).toBe('first');
    themes.setScope('1');
    expect(themes.theme()).toBe('night');
    storage.setItem.mockClear();
    themes.setScope(null);
    expect(themes.theme()).toBe('night');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('synchronizes only the current scope and never echoes events', () => {
    const themes = service();
    themes.setScope('1');
    values.set(themeKey(config, null), record());
    event(themeKey(config, null));
    expect(themes.theme()).toBe('first');
    values.set(themeKey(config, '2'), record());
    event(themeKey(config, '2'));
    expect(themes.theme()).toBe('first');
    values.set(themeKey(config, '1'), record());
    event(themeKey(config, '1'));
    expect(themes.theme()).toBe('fifth');
    values.delete(themeKey(config, '1'));
    event(themeKey(config, '1'));
    expect(themes.theme()).toBe('first');
    values.set(themeKey(config, '1'), record());
    event(null);
    expect(themes.theme()).toBe('fifth');
    values.clear();
    event(null);
    expect(themes.theme()).toBe('first');
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it('updates anonymous appearance from global changes and clear', () => {
    const themes = service();
    values.set(themeKey(config, null), record());
    event(themeKey(config, null));
    expect(themes.theme()).toBe('fifth');
    values.clear();
    event(null);
    expect(themes.theme()).toBe('first');
  });
  it('continues in memory when reads and writes are blocked', () => {
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const themes = service();
    themes.setScope('1');
    themes.selectTheme('fifth');
    expect(themes.theme()).toBe('fifth');
    expect(themes.persistenceUnavailable()).toBe(true);
    expect(document.documentElement.dataset['theme']).toBe('fifth');
  });
  it('clears unsaved preferences in inactive scopes after external clear()', () => {
    storage.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    const themes = service();
    themes.setScope('1');
    themes.selectTheme('fifth');
    themes.setScope('2');
    themes.selectTheme('night');
    event(null);
    expect(themes.theme()).toBe('first');
    themes.setScope('1');
    expect(themes.theme()).toBe('first');
  });

  it('bootstraps with the same pure resolver and releases paint protection on failure', () => {
    values.set(themeKey(config, null), record());
    bootstrapTheme(config, document.documentElement, storage);
    expect(document.documentElement.dataset['theme']).toBe('fifth');
    expect(service().appearance()).toEqual(resolveAppearance(config, record()));
    document.documentElement.setAttribute('data-theme-pending', '');
    storage.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    bootstrapTheme(config, document.documentElement, storage);
    expect(document.documentElement.hasAttribute('data-theme-pending')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });
});
