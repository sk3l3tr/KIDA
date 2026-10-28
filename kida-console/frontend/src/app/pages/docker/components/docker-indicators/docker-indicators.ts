import { Component, computed, inject } from '@angular/core';
import { DockerFacade } from '../../services/docker.facade';

@Component({
  selector: 'app-docker-indicators',
  templateUrl: './docker-indicators.html',
  styleUrl: './docker-indicators.scss',
})
export class DockerIndicators {
  readonly state = inject(DockerFacade);
  readonly serviceCount = computed(() => {
    const projects = this.state.projects.data();
    return projects === null
      ? null
      : projects.reduce((total, project) => total + project.services.length, 0);
  });
}
