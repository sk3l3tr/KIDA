import { ThemeConfig } from '../lib/theming/model';
export const themeCatalog = [
  {
    id: 'professional',
    name: 'Professional',
    description: 'Minimalista y corporativo',
    modes: ['light', 'dark'],
    defaultMode: 'light',
  },
  {
    id: 'neobrutalism',
    name: 'Neobrutalism',
    description: 'Contrastes, bordes y sombras',
    modes: ['light', 'dark'],
    defaultMode: 'light',
  },
  {
    id: 'sakura',
    name: 'Sakura',
    description: 'Colores suaves y títulos serif',
    modes: ['light', 'dark'],
    defaultMode: 'light',
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    description: 'Monoespaciado y acentos neón',
    modes: ['dark'],
    defaultMode: 'dark',
  },
] as const;
export const themeConfig: ThemeConfig = {
  themes: themeCatalog,
  initial: { theme: 'professional', mode: 'light' },
  namespace: 'kida:appearance',
};
