import { Component, input } from '@angular/core';

@Component({
  selector: 'app-system-indicator',
  template: `<div class="panel">
    <small>{{ label() }} </small
    ><strong [class.primary]="value() === 'OK'">
      @if (value() === 'OK') {
        <span class="i i-check-circle"></span>
      }

      {{ value() }}</strong
    >
    @if (detail()) {
      <small>{{ detail() }}</small>
    }
  </div>`,
  styles: `
    :host {
      min-width: 0;
      max-height: 7.5rem;
    }
    .panel {
      height: 100%;
      padding: var(--kida-space);
      border-width: var(--kida-border-width);
      border-radius: var(--kida-radius);
      box-shadow: var(--kida-shadow), var(--kida-effect);
      overflow-wrap: anywhere;
    }
    strong {
      display: block;
      font-size: clamp(1.4rem, 3vw, 2rem);
      margin-top: 0.5rem;
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class SystemIndicator {
  readonly label = input.required<string>();
  readonly value = input.required<string | number>();
  readonly detail = input('');
}
