import { IactionDefinition, UrlRequestFormat, UrlRequestType } from 'arca';
import { environment } from '../../../environments/environment';

export const systemActions: IactionDefinition[] = (
  [
    ['INFO', 'info', UrlRequestType.GET],
    ['HEALTH', 'health', UrlRequestType.GET],
    ['WAKE_CAPABILITIES', 'wake-capabilities', UrlRequestType.GET],
    ['SHUTDOWN', 'shutdown', UrlRequestType.POST],
    ['REBOOT', 'reboot', UrlRequestType.POST],
    ['POWER_CYCLE', 'power-cycle', UrlRequestType.POST],
  ] as const
).map(([name, path, method]) => ({
  actionName: `SYSTEM_${name}_REQUEST`,
  urlRequest: {
    endpoint: `${environment.apiBaseUrl}/system/${path}`,
    method,
    format: UrlRequestFormat.json,
    responseActionName: `SYSTEM_${name}_RESPONSE`,
    errorActionName: `SYSTEM_${name}_ERROR`,
    useLoader: false,
  },
}));
