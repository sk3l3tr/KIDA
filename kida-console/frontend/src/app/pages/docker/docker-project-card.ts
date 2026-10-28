import { Component, computed, input, output } from '@angular/core';
import { ComposeProject } from './docker.models';

@Component({
  selector: 'app-docker-project-card',
  templateUrl: './docker-project-card.html',
  styleUrl: './docker-project-card.scss',
})
export class DockerProjectCard {
  readonly project = input.required<ComposeProject>();
  readonly disabled = input(false);
  readonly inspect = output<string>();
  readonly totals = computed(() => {
    const services = this.project().services;
    const containers = services.flatMap((service) => service.containers);
    const active = containers.filter((container) => container.online).length;
    return { services: services.length, containers: containers.length, active };
  });
}
