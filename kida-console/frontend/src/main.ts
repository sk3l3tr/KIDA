import { bootstrapTheme } from './lib/theming/model';
import { browserThemeStorage } from './lib/theming/theme.service';
import { themeConfig } from './theme/catalog';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

bootstrapTheme(themeConfig, document.documentElement, browserThemeStorage);
document.documentElement.classList.toggle(
  'ion-palette-dark',
  document.documentElement.dataset['mode'] === 'dark',
);

if (window.location.pathname !== '/login')
  document.documentElement.setAttribute('data-identity-pending', '');

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
