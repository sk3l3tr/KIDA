import { IactionDefinition, UrlRequestFormat, UrlRequestType } from 'arca';
import { environment } from '../../../../environments/environment';

export const dockerActions: IactionDefinition[] = (
  [
    ['CONTAINERS_LIST', '/containers', UrlRequestType.GET],
    ['COMPOSE_PROJECTS', '/compose/projects', UrlRequestType.GET],
    ['COMPOSE_INSPECT', '/compose/projects/inspect?project={project}', UrlRequestType.GET],
    ['CONTAINER_START', '/containers/start', UrlRequestType.POST],
    ['CONTAINER_STOP', '/containers/stop', UrlRequestType.POST],
    ['CONTAINER_RESTART', '/containers/restart', UrlRequestType.POST],
    ['CONTAINER_DELETE', '/containers/delete', UrlRequestType.POST],
  ] as const
).map(([name, path, method]) => ({
  actionName: `DOCKER_${name}_REQUEST`,
  urlRequest: {
    endpoint: `${environment.apiBaseUrl}/docker${path}`,
    method,
    format: UrlRequestFormat.json,
    responseActionName: `DOCKER_${name}_RESPONSE`,
    errorActionName: `DOCKER_${name}_ERROR`,
    useLoader: false,
  },
}));
