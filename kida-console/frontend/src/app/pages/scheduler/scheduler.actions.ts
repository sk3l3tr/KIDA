import { IactionDefinition, UrlRequestFormat, UrlRequestType } from 'arca';
import { environment } from '../../../environments/environment';

export const schedulerActions: IactionDefinition[] = (
  [
    ['LIST', '?origin={origin}', UrlRequestType.GET],
    ['ADD', '/add', UrlRequestType.POST],
    ['DELETE', '/delete', UrlRequestType.POST],
  ] as const
).map(([name, path, method]) => ({
  actionName: `SCHEDULER_${name}_REQUEST`,
  urlRequest: {
    endpoint: `${environment.apiBaseUrl}/scheduler${path}`,
    method,
    format: UrlRequestFormat.json,
    responseActionName: `SCHEDULER_${name}_RESPONSE`,
    errorActionName: `SCHEDULER_${name}_ERROR`,
    useLoader: false,
  },
}));
