import { AuthMode, FooterVisibility, HeaderVisibility, IGlobalConfig } from 'arca';
import { AppFooterComponent } from '../components/app-footer/app-footer.component';
import { AppHeaderComponent } from '../components/app-header/app-header.component';

export const appGlobalConfig: IGlobalConfig = {
  appVersion: '0.0.0',
  // ARCA dev mode logs action payloads, including login credentials.
  devMode: false,
  authMode: AuthMode.eachTokenExpiration,
  appTitle: 'KIDA Console',
  menuChangeOver: 900,
  appHeaderComponent: AppHeaderComponent,
  appFooterComponent: AppFooterComponent,
  appHeaderVisibility: HeaderVisibility.both,
  appFooterVisibility: FooterVisibility.mobile,
  appNotificationTime: 3000,
  appModalHeight: 0.95,
  // Authentication is enforced by FastAPI sessions and authInterceptor.
  security: false,
  accessTokenAttribute: 'accessToken',
  securityURLExceptions: [],
};
