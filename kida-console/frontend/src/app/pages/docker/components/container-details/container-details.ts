import { Component, input } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { DockerContainer } from '../../utils/docker.models';
import { counter, display, limitedPrecision } from '../../utils/docker-presentation';

@Component({
  selector: 'app-container-details',
  imports: [JsonPipe],
  templateUrl: './container-details.html',
  styleUrl: './container-details.scss',
})
export class ContainerDetails {
  readonly container = input.required<DockerContainer>();
  readonly display = display;
  readonly counter = counter;
  readonly limitedPrecision = limitedPrecision;
}
