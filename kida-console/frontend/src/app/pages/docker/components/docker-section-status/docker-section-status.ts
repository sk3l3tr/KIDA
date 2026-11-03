import { Component, input } from '@angular/core';
import { DockerReading } from '../../services/docker.facade';

@Component({
  selector: 'app-docker-section-status',
  templateUrl: './docker-section-status.html',
})
export class DockerSectionStatus {
  readonly state = input.required<Pick<DockerReading<unknown>, 'loading' | 'error' | 'stale'>>();
  readonly loadingText = input('Actualizando lectura…');
  readonly errorPrefix = input('Error de lectura:');
  readonly staleText = input('Datos anteriores, desactualizados.');
}
