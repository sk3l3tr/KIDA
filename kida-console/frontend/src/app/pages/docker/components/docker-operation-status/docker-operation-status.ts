import { JsonPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { DockerFacade } from '../../services/docker.facade';

@Component({
  selector: 'app-docker-operation-status',
  imports: [JsonPipe],
  templateUrl: './docker-operation-status.html',
  styles: `
    p,
    h3 {
      overflow-wrap: anywhere;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      max-height: 22rem;
      overflow: auto;
      font-size: 0.85rem;
    }
  `,
})
export class DockerOperationStatus {
  readonly state = inject(DockerFacade);
  readonly showDetails = input(false);
}
