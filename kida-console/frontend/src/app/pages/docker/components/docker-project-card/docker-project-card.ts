import { Component, computed, inject, input, output } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { ContainerDetails } from '../container-details/container-details';
import { DockerFacade, serviceKeys } from '../../services/docker.facade';
import { ComposeProject, ComposeService } from '../../utils/docker.models';

@Component({
  selector: 'app-docker-project-card',
  imports: [IonicModule, ContainerDetails],
  templateUrl: './docker-project-card.html',
  styleUrl: './docker-project-card.scss',
})
export class DockerProjectCard {
  readonly state = inject(DockerFacade);
  readonly project = input.required<ComposeProject>();
  readonly disabled = input(false);
  readonly inspect = output<string>();
  readonly keys = computed(() => serviceKeys(this.project()));
  activeCount(service: ComposeService): number {
    return service.containers.filter((container) => container.online).length;
  }
  isInspected(service: string, id: string): boolean {
    const selected = this.state.inspectedContainer();
    return (
      selected?.project === this.project().name &&
      selected.service === service &&
      selected.id === id
    );
  }
  toggleContainer(service: string, id: string): void {
    this.state.inspectedContainer.set(
      this.isInspected(service, id) ? null : { project: this.project().name, service, id },
    );
  }
  changeServices(event: CustomEvent): void {
    if (event.target !== event.currentTarget) return;
    const value = event.detail.value;
    this.state.setExpandedServices(this.project().name, Array.isArray(value) ? value : []);
  }
  readonly totals = computed(() => {
    const services = this.project().services;
    const containers = services.flatMap((service) => service.containers);
    const active = containers.filter((container) => container.online).length;
    return { services: services.length, containers: containers.length, active };
  });
}
