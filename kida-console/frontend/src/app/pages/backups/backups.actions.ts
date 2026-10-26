import { IactionDefinition, UrlRequestFormat, UrlRequestType } from 'arca';
import { environment } from '../../../environments/environment';

export const backupActions: IactionDefinition[] = (
  [
    ['CONFIG_LIST', '/config', UrlRequestType.GET],
    ['CONFIG_CREATE', '/config/create', UrlRequestType.POST],
    ['CONFIG_DELETE', '/config/delete', UrlRequestType.POST],
    ['RUN', '/run', UrlRequestType.POST],
  ] as const
).map(([name, path, method]) => ({
  actionName: `BACKUP_${name}_REQUEST`,
  urlRequest: {
    endpoint: `${environment.apiBaseUrl}/backup${path}`,
    method,
    format: UrlRequestFormat.json,
    responseActionName: `BACKUP_${name}_RESPONSE`,
    errorActionName: `BACKUP_${name}_ERROR`,
    useLoader: false,
  },
}));
