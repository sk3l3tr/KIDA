import { Component, forwardRef, input } from '@angular/core';
import { displaySystemValue, systemLabel } from '../../system-format';

@Component({
  selector: 'app-system-data',
  imports: [forwardRef(() => SystemData)],
  templateUrl: './system-data.html',
  styleUrl: './system-data.scss',
})
export class SystemData {
  readonly value = input<unknown>();
  readonly field = input('');
  array(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
  }
  object(value: unknown): [string, unknown][] | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value)
      : null;
  }
  readonly label = systemLabel;
  display(value: unknown): string {
    return displaySystemValue(value, this.field());
  }
}
