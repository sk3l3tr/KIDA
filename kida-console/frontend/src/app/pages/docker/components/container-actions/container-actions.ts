import { Component, computed, inject, input } from '@angular/core';
import { DockerFacade } from '../../services/docker.facade';
import { ContainerAction } from '../../utils/docker.models';

@Component({
  selector: 'app-container-actions',
  templateUrl: './container-actions.html',
  styleUrl: './container-actions.scss',
  host: { '[class.compact]': 'compact()' },
})
export class ContainerActions {
  readonly state = inject(DockerFacade);
  readonly containerId = input.required<string>();
  readonly actions = input<readonly ContainerAction[]>(this.state.actions);
  readonly compact = input(false);
  readonly container = computed(
    () => this.state.inventory.data()?.containers.find((c) => c.id === this.containerId()) ?? null,
  );
  readonly labels: Record<ContainerAction, string> = {
    start: 'Arrancar',
    stop: 'Parar',
    restart: 'Reiniciar',
    delete: 'Eliminar',
  };
}
