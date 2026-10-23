import { AuthMode, FooterVisibility, HeaderVisibility, IGlobalConfig } from 'arca';

export const appGlobalConfig: IGlobalConfig = {
  appVersion: '0.0.0',
  devMode: true,
  authMode: AuthMode.eachTokenExpiration,
  appTitle: 'KIDA Console',
  menuChangeOver: 900,
  appHeaderComponent: undefined,
  appFooterComponent: undefined,
  appHeaderVisibility: HeaderVisibility.both,
  appFooterVisibility: FooterVisibility.mobile,
  appNotificationTime: 3000,
  appModalHeight: 0.95,
  security: true,
  accessTokenAttribute: 'accessToken',
  securityURLExceptions: [],
};
