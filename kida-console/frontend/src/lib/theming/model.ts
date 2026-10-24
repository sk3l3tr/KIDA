export type ThemeMode = 'light' | 'dark';
export interface ThemeDefinition {
  readonly id: string;
  readonly modes: readonly ThemeMode[];
  readonly defaultMode: ThemeMode;
}
export interface ThemePreference {
  theme: string;
  mode: ThemeMode;
}
export interface ThemeConfig {
  readonly themes: readonly ThemeDefinition[];
  readonly initial: ThemePreference;
  readonly namespace: string;
}
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function validateConfig(config: ThemeConfig): ThemeConfig {
  const ids = new Set<string>();
  if (!config.namespace || !config.themes.length) throw new Error('Invalid theme configuration');
  for (const theme of config.themes) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(theme.id) ||
      ids.has(theme.id) ||
      !theme.modes.length ||
      new Set(theme.modes).size !== theme.modes.length ||
      theme.modes.some((mode) => mode !== 'light' && mode !== 'dark') ||
      !theme.modes.includes(theme.defaultMode)
    )
      throw new Error('Invalid theme definition');
    ids.add(theme.id);
  }
  const initial = config.themes.find((theme) => theme.id === config.initial.theme);
  if (!initial?.modes.includes(config.initial.mode)) throw new Error('Invalid initial theme');
  return config;
}
export function themeKey(config: ThemeConfig, scope: string | null): string {
  return `${config.namespace}:${scope === null ? 'global' : `account:${encodeURIComponent(scope)}`}`;
}
/** Unknown schemas and malformed records are absent; reads never rewrite storage. */
export function resolveAppearance(config: ThemeConfig, raw: string | null) {
  let preference = config.initial;
  try {
    const value = JSON.parse(raw ?? 'null');
    if (
      value?.version === 1 &&
      config.themes.some((theme) => theme.id === value.theme) &&
      (value.mode === 'light' || value.mode === 'dark')
    ) {
      preference = { theme: value.theme, mode: value.mode };
    }
  } catch {
    /* Invalid preferences use the configured default. */
  }
  const definition = config.themes.find((theme) => theme.id === preference.theme)!;
  return {
    theme: definition.id,
    preferredMode: preference.mode,
    mode: definition.modes.includes(preference.mode) ? preference.mode : definition.defaultMode,
  };
}
export type ThemeAppearance = ReturnType<typeof resolveAppearance>;
export function applyAppearance(root: HTMLElement, appearance: ThemeAppearance): void {
  root.dataset['theme'] = appearance.theme;
  root.dataset['mode'] = appearance.mode;
  root.style.colorScheme = appearance.mode;
}
export function bootstrapTheme(
  config: ThemeConfig,
  root: HTMLElement,
  storage: ThemeStorage,
): void {
  validateConfig(config);
  let raw: string | null = null;
  try {
    raw = storage.getItem(themeKey(config, null));
  } catch {
    /* Storage can be blocked. */
  }
  try {
    applyAppearance(root, resolveAppearance(config, raw));
  } finally {
    root.removeAttribute('data-theme-pending');
  }
}
