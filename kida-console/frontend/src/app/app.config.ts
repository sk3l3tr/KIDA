import { authInterceptor } from './auth/auth.interceptor';
import {
  ApplicationConfig,
  provideZoneChangeDetection,
  provideBrowserGlobalErrorListeners,
  LOCALE_ID,
  importProvidersFrom,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { provideHttpClient, withJsonpSupport, withInterceptors } from '@angular/common/http';
import {
  provideRouter,
  RouteReuseStrategy,
  PreloadAllModules,
  withPreloading,
} from '@angular/router';
import { routes } from './app.routes';
import { MenuController as ArcaMenuController } from '@ionic/angular';
import { provideIonicAngular, IonicRouteStrategy, MenuController } from '@ionic/angular/standalone';

// ARCA
import {
  ACTIONS_CONFIG,
  GLOBAL_CONFIG,
  LANG_CONFIG,
  MENU_CONFIG,
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
    provideHttpClient(withJsonpSupport(), withInterceptors([authInterceptor])),
    importProvidersFrom(CoreComponentsModule),
    { provide: GLOBAL_CONFIG, useValue: appGlobalConfig },
    { provide: MENU_CONFIG, useValue: appMenu },
    { provide: LANG_CONFIG, useValue: langConfig },
    { provide: ACTIONS_CONFIG, useValue: appActions },
    provideRouter(routes, withPreloading(PreloadAllModules)),
    provideIonicAngular({}),
    // ARCA uses the module API; share the controller used by standalone Ionic elements.
    { provide: ArcaMenuController, useExisting: MenuController },
  ],
};
