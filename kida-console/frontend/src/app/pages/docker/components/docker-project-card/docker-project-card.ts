import { Component, computed, inject, input, output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { DockerFacade } from '../../services/docker.facade';
import { projectTotals, serviceKeys } from '../../utils/docker-presentation';
import { ComposeProject, ComposeService } from '../../utils/docker.models';

@Component({
  selector: 'app-docker-project-card',
  imports: [IonicModule],
  templateUrl: './docker-project-card.html',
  styleUrl: './docker-project-card.scss',
})
export class DockerProjectCard {
  readonly state = inject(DockerFacade);

  readonly project = input.required<ComposeProject>();
  readonly disabled = input(false);
  readonly inspect = output<string>();

  readonly keys = computed(() => serviceKeys(this.project()));
  readonly totals = computed(() => {
    const totals = projectTotals(this.project());
    return { services: totals.services, containers: totals.containers, active: totals.online };
  });

  activeCount(service: ComposeService): number {
    return service.containers.filter((container) => container.online).length;
  }

  changeServices(event: CustomEvent): void {
    if (event.target !== event.currentTarget) return;
    const value = event.detail.value;
    this.state.setExpandedServices(this.project().name, Array.isArray(value) ? value : []);
  }

}
