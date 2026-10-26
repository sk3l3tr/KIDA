import { IactionDefinition, UrlRequestFormat, UrlRequestType } from 'arca';
import { environment } from '../../environments/environment';
import { schedulerActions } from '../pages/scheduler/scheduler.actions';

export const appActions: IactionDefinition[] = [
  ...schedulerActions,
  {
    actionName: 'ACCOUNTS_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.admins,
      method: UrlRequestType.GET,
      format: UrlRequestFormat.json,
      responseActionName: 'ACCOUNTS_RESPONSE',
      errorActionName: 'ACCOUNTS_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'CREATE_ACCOUNT_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.admins,
      method: UrlRequestType.POST,
      format: UrlRequestFormat.json,
      responseActionName: 'CREATE_ACCOUNT_RESPONSE',
      errorActionName: 'CREATE_ACCOUNT_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'RENAME_ACCOUNT_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.rename,
      method: UrlRequestType.PATCH,
      format: UrlRequestFormat.json,
      responseActionName: 'RENAME_ACCOUNT_RESPONSE',
      errorActionName: 'RENAME_ACCOUNT_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'CHANGE_PASSWORD_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.password,
      method: UrlRequestType.PUT,
      format: UrlRequestFormat.json,
      responseActionName: 'CHANGE_PASSWORD_RESPONSE',
      errorActionName: 'CHANGE_PASSWORD_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'DELETE_ACCOUNT_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.delete,
      method: UrlRequestType.DELETE,
      format: UrlRequestFormat.json,
      responseActionName: 'DELETE_ACCOUNT_RESPONSE',
      errorActionName: 'DELETE_ACCOUNT_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'LOGIN_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.login,
      method: UrlRequestType.POST,
      format: UrlRequestFormat.json,
      responseActionName: 'LOGIN_RESPONSE',
      errorActionName: 'LOGIN_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'LOGOUT_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.logout,
      method: UrlRequestType.POST,
      format: UrlRequestFormat.json,
      responseActionName: 'LOGOUT_RESPONSE',
      errorActionName: 'LOGOUT_ERROR',
      useLoader: true,
    },
  },
  {
    actionName: 'SESSION_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.session,
      method: UrlRequestType.GET,
      format: UrlRequestFormat.json,
      responseActionName: 'SESSION_RESPONSE',
      errorActionName: 'SESSION_ERROR',
      useLoader: false,
    },
  },
  {
    actionName: 'CSRF_REQUEST',
    urlRequest: {
      endpoint: environment.apiBaseUrl + environment.endpoints.csrf,
      method: UrlRequestType.GET,
      format: UrlRequestFormat.json,
      responseActionName: 'CSRF_RESPONSE',
      errorActionName: 'CSRF_ERROR',
      useLoader: true,
    },
  },
];
