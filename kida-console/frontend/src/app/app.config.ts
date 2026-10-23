import {
  ApplicationConfig,
  provideZoneChangeDetection,
  provideBrowserGlobalErrorListeners,
  LOCALE_ID,
  importProvidersFrom,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import {
  provideHttpClient,
  HTTP_INTERCEPTORS,
  withJsonpSupport,
  withInterceptorsFromDi,
} from '@angular/common/http';
import {
  provideRouter,
  RouteReuseStrategy,
  PreloadAllModules,
  withPreloading,
} from '@angular/router';
import { routes } from './app.routes';
import { provideIonicAngular, IonicRouteStrategy } from '@ionic/angular/standalone';

// ARCA
import {
  ACTIONS_CONFIG,
  GLOBAL_CONFIG,
  LANG_CONFIG,
  MENU_CONFIG,
  ArcaInterceptor,
  CoreComponentsModule,
} from 'arca';
import { appGlobalConfig } from './arca-config/app.global.config';
import { appMenu } from './arca-config/app.menu.config';
import { langConfig } from './arca-config/app.literals';
import { appActions } from './arca-config/app.actions';

registerLocaleData(localeEs);

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection(),
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    { provide: LOCALE_ID, useValue: 'es' },
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withJsonpSupport(), withInterceptorsFromDi()),
    importProvidersFrom(CoreComponentsModule),
    { provide: GLOBAL_CONFIG, useValue: appGlobalConfig },
    { provide: MENU_CONFIG, useValue: appMenu },
    { provide: LANG_CONFIG, useValue: langConfig },
    { provide: ACTIONS_CONFIG, useValue: appActions },
    { provide: HTTP_INTERCEPTORS, useClass: ArcaInterceptor, multi: true },
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideIonicAngular({}),
  ],
};
