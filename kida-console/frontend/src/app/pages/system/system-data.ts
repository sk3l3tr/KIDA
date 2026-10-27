import { Component, forwardRef, input } from '@angular/core';
import { displaySystemValue, systemLabel } from './system-format';

@Component({
  selector: 'app-system-data',
  imports: [forwardRef(() => SystemData)],
  template: `
    @if (array(value()); as items) {
      @if (!items.length) {
        <span>Sin elementos</span>
      } @else {
        <ul>
          @for (item of items; track $index) {
            <li><app-system-data [value]="item" /></li>
          }
        </ul>
      }
    } @else if (object(value()); as entries) {
      @if (!entries.length) {
        <span>Sin campos</span>
      }
      <dl>
        @for (entry of entries; track entry[0]) {
          <dt>{{ label(entry[0]) }}</dt>
          <dd><app-system-data [value]="entry[1]" [field]="entry[0]" /></dd>
        }
      </dl>
    } @else {
      <span>{{ display(value()) }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    dl {
      margin: 0;
    }
    dt {
      color: var(--kida-muted);
      font-size: 0.9rem;
      margin-top: 0.65rem;
    }
    dd {
      margin: 0.15rem 0 0.5rem 0.75rem;
    }
    ul {
      padding-left: 1.25rem;
      margin: 0.25rem 0;
    }
    li + li {
      margin-top: 0.75rem;
    }
  `,
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
