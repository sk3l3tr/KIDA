import { Component, inject, input } from '@angular/core';
import { DockerFacade } from '../../services/docker.facade';

@Component({
  selector: 'app-docker-compose-version',
  templateUrl: './docker-compose-version.html',
  styleUrl: './docker-compose-version.scss',
})
export class DockerComposeVersion {
  readonly state = inject(DockerFacade);
  readonly tab = input.required<'projects' | 'containers'>();
}
