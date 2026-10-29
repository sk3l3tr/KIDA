import { Injectable, inject } from '@angular/core';
import { ArcaRequestService } from '../../../services/arca-request.service';
import {
  ComposeProject,
  ContainerAction,
  ContainerResult,
  DockerContainers,
} from '../utils/docker.models';

@Injectable({ providedIn: 'root' })
export class DockerService {
  private readonly requests = inject(ArcaRequestService);
  list() {
    return this.requests.request<DockerContainers>('DOCKER_CONTAINERS_LIST');
  }
  projects() {
    return this.requests.request<ComposeProject[]>('DOCKER_COMPOSE_PROJECTS');
  }
  inspect(project: string) {
    return this.requests.request<ComposeProject>('DOCKER_COMPOSE_INSPECT', {
      project: encodeURIComponent(project),
    });
  }
  act(action: ContainerAction, container: string) {
    return this.requests.request<ContainerResult>(`DOCKER_CONTAINER_${action.toUpperCase()}`, {
      container,
    });
  }
}
