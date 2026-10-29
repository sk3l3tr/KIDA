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
  date(value: string | null): string {
    if (value === null) return 'No disponible';
    const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(value);
    if (calendar) {
      const year = Number(calendar[1]),
        month = Number(calendar[2]),
        day = Number(calendar[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return value;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toISOString().replace('T', ' ').replace('Z', ' UTC');
  }
  readonly display = display;
  readonly counter = counter;
  readonly limitedPrecision = limitedPrecision;
}
