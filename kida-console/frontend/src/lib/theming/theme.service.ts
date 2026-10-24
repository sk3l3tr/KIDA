import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  inject,
  makeEnvironmentProviders,
  signal,
} from '@angular/core';
import {
  ThemeConfig,
  ThemeMode,
  ThemeStorage,
  applyAppearance,
  resolveAppearance,
  themeKey,
  validateConfig,
} from './model';

export const THEME_CONFIG = new InjectionToken<ThemeConfig>('THEME_CONFIG');
export const THEME_STORAGE = new InjectionToken<ThemeStorage>('THEME_STORAGE', {
  providedIn: 'root',
  factory: () => browserThemeStorage,
});
// Access localStorage inside each operation: even its getter may throw.
export const browserThemeStorage: ThemeStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};
export function provideTheming(config: ThemeConfig) {
  return makeEnvironmentProviders([{ provide: THEME_CONFIG, useValue: validateConfig(config) }]);
}
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly config = inject(THEME_CONFIG);
  private readonly storage = inject(THEME_STORAGE);
  private readonly document = inject(DOCUMENT);
  private readonly currentScope = signal<string | null>(null);
  private readonly state = signal(resolveAppearance(this.config, null));
  private readonly unsaved = new Map<string, string>();
  private readonly storageFailure = signal(false);
  readonly scope = this.currentScope.asReadonly();
  readonly appearance = this.state.asReadonly();
  readonly theme = computed(() => this.state().theme);
  readonly preferredMode = computed(() => this.state().preferredMode);
  readonly mode = computed(() => this.state().mode);
  readonly persistenceUnavailable = this.storageFailure.asReadonly();
  readonly themes = this.config.themes;

  constructor() {
    this.read();
    const listener = (event: StorageEvent) => {
      try {
        if (event.storageArea && event.storageArea !== this.document.defaultView?.localStorage)
          return;
      } catch {
        this.storageFailure.set(true);
        return;
      }
      if (event.key === null || event.key === themeKey(this.config, this.scope())) {
        if (event.key === null) this.unsaved.clear();
        else this.unsaved.delete(themeKey(this.config, this.scope()));
        this.read();
      }
    };
    this.document.defaultView?.addEventListener('storage', listener);
    inject(DestroyRef).onDestroy(() =>
      this.document.defaultView?.removeEventListener('storage', listener),
    );
  }
  setScope(scope: string | null): void {
    if (scope === this.scope()) return;
    this.currentScope.set(scope);
    // Logout keeps the visible appearance, without writing either scope.
    if (scope !== null) this.read();
  }
  selectTheme(theme: string): void {
    if (!this.themes.some((definition) => definition.id === theme))
      throw new Error('Unknown theme');
    this.select(theme, this.preferredMode());
  }
  selectMode(mode: ThemeMode): void {
    if (!this.themes.find((theme) => theme.id === this.theme())!.modes.includes(mode)) {
      throw new Error('Unsupported mode');
    }
    this.select(this.theme(), mode);
  }
  private select(theme: string, mode: ThemeMode): void {
    const raw = JSON.stringify({ version: 1, theme, mode });
    this.apply(raw);
    for (const key of new Set([themeKey(this.config, this.scope()), themeKey(this.config, null)])) {
      try {
        this.storage.setItem(key, raw);
        this.unsaved.delete(key);
      } catch {
        this.unsaved.set(key, raw);
        this.storageFailure.set(true);
      }
    }
  }
  private read(): void {
    const key = themeKey(this.config, this.scope());
    let raw: string | null = this.unsaved.get(key) ?? null;
    try {
      if (raw === null) raw = this.storage.getItem(key);
    } catch {
      this.storageFailure.set(true);
    }
    this.apply(raw);
  }
  private apply(raw: string | null): void {
    const appearance = resolveAppearance(this.config, raw);
    applyAppearance(this.document.documentElement, appearance);
    this.state.set(appearance);
  }
}
