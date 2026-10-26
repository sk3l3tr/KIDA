import { IactionDefinition, UrlRequestFormat, UrlRequestType } from 'arca';
import { environment } from '../../../environments/environment';

export const backupActions: IactionDefinition[] = (
  [
    ['CONFIG_LIST', '/config', UrlRequestType.GET],
    ['CONFIG_CREATE', '/config/create', UrlRequestType.POST],
    ['CONFIG_DELETE', '/config/delete', UrlRequestType.POST],
    ['RUN', '/run', UrlRequestType.POST],
    ['HEALTH_LIST', '/health', UrlRequestType.GET],
    ['HEALTH_GET', '/health/get?run_id={run_id}', UrlRequestType.GET],
    ['HEALTH_CREATE', '/health/create', UrlRequestType.POST],
    ['HEALTH_START', '/health/start', UrlRequestType.POST],
    ['HEALTH_RUN', '/health/run', UrlRequestType.POST],
    ['HEALTH_STOP', '/health/stop', UrlRequestType.POST],
    ['HEALTH_DELETE', '/health/delete', UrlRequestType.POST],
    ['HEALTH_REPORT_LIST', '/health/reports', UrlRequestType.GET],
    ['HEALTH_REPORT_GET', '/health/reports/get?run_id={run_id}', UrlRequestType.GET],
    ['HEALTH_REPORT_DELETE', '/health/reports/delete', UrlRequestType.POST],
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
