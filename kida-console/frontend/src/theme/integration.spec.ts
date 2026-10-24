import { TestBed } from '@angular/core/testing';
import { THEME_STORAGE, ThemeService, provideTheming } from '../lib/theming/theme.service';
import { themeKey } from '../lib/theming/model';
import { themeConfig } from './catalog';
import { ThemeIdentity, provideKidaThemeIntegration } from './integration';

describe('KIDA identity and Ionic adaptation', () => {
  let identity: ThemeIdentity;
  let themes: ThemeService;
  let values: Map<string, string>;
  let write: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    values = new Map();
    write = vi.fn((key: string, value: string) => {
      values.set(key, value);
    });
    TestBed.configureTestingModule({
      providers: [
        provideTheming(themeConfig),
        provideKidaThemeIntegration(),
        {
          provide: THEME_STORAGE,
          useValue: { getItem: (key: string) => values.get(key) ?? null, setItem: write },
        },
      ],
    });
    identity = TestBed.inject(ThemeIdentity);
    themes = TestBed.inject(ThemeService);
  });
  it('writes no account preference until confirmation, including during restoration errors', () => {
    identity.begin();
    themes.selectTheme('sakura');
    expect(write.mock.calls.map((call) => call[0])).toEqual([themeKey(themeConfig, null)]);
    const revision = identity.begin();
    identity.confirm(revision, 10);
    themes.selectTheme('tokyo');
    expect(values.has(themeKey(themeConfig, '10'))).toBe(true);
    write.mockClear();
    identity.begin(); // no confirmation: network error
    themes.selectTheme('neobrutalism');
    expect(write.mock.calls.map((call) => call[0])).toEqual([themeKey(themeConfig, null)]);
  });
  it('discards rapid stale confirmations and results after logout', () => {
    const first = identity.begin();
    const second = identity.begin();
    identity.confirm(second, 2);
    identity.confirm(first, 1);
    expect(themes.scope()).toBe('2');
    themes.selectTheme('tokyo');
    identity.clear();
    identity.confirm(second, 2);
    expect(themes.scope()).toBeNull();
    expect(themes.theme()).toBe('tokyo');
    write.mockClear();
    themes.selectTheme('sakura');
    expect(write.mock.calls.map((call) => call[0])).toEqual([themeKey(themeConfig, null)]);
  });
  it('restores by immutable ID and preserves mode preference through Tokyo', () => {
    identity.confirm(identity.begin(), 1);
    themes.selectTheme('sakura');
    themes.selectMode('light');
    themes.selectTheme('tokyo');
    TestBed.tick();
    expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(true);
    // A rename changes no theme identity; repeated confirmation uses the same ID.
    identity.confirm(identity.begin(), 1);
    themes.selectTheme('professional');
    TestBed.tick();
    expect(themes.mode()).toBe('light');
    expect(document.documentElement.classList.contains('ion-palette-dark')).toBe(false);
  });
});
