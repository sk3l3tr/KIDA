import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OptionalField } from './backups.models';

/** Form-only state: omission and explicit null remain distinguishable. */
@Component({
  selector: 'app-backup-optional-field',
  imports: [FormsModule],
  template: `
    <label
      >{{ label() }}: modo
      <select
        class="console-control"
        [(ngModel)]="field().mode"
        [ngModelOptions]="{ standalone: true }"
      >
        <option value="omit">Omitir</option>
        <option value="value">Valor</option>
        <option value="null">null explícito</option>
      </select>
    </label>
    @if (field().mode === 'value') {
      <label
        >{{ label() }}: valor
        @if (json()) {
          <textarea
            class="console-control"
            rows="3"
            [(ngModel)]="field().value"
            [ngModelOptions]="{ standalone: true }"
          ></textarea>
        } @else {
          <input
            class="console-control"
            type="text"
            [(ngModel)]="field().value"
            [ngModelOptions]="{ standalone: true }"
          />
        }
      </label>
    }
  `,
})
export class BackupOptionalField {
  readonly field = input.required<OptionalField>();
  readonly label = input.required<string>();
  readonly json = input(false);
}
