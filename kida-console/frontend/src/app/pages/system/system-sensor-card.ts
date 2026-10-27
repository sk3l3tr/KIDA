import { Component, computed, input } from '@angular/core';
import { SystemData } from './system-data';
import { SensorReading, criticalRatio } from './system-sensors';
import { displaySystemValue } from './system-format';

@Component({
  selector: 'app-system-sensor-card',
  imports: [SystemData],
  template: `
    <article class="sensor-card" [class.compact]="compact()">
      <div class="sensor-heading">
        <div>
          <strong>{{ display(reading().fields['label']) }}</strong
          ><small
            >{{ display(reading().fields['device']) }} ·
            {{ display(reading().fields['type']) }}</small
          >
        </div>
        <span class="status">{{ display(reading().fields['status']) }}</span>
      </div>
      <div class="sensor-value">
        {{ display(reading().fields['value']) }}
        <small>{{ display(reading().fields['unit']) }}</small>
      </div>
      @if (!compact() && ratio() !== null) {
        <div class="sensor-meter" aria-hidden="true"><span [style.width.%]="ratio()"></span></div>
        <small>Proporción del umbral crítico reportado; no es porcentaje de uso.</small>
      }
      @if (!compact()) {
        <dl class="sensor-limits">
          <div>
            <dt>Máximo reportado</dt>
            <dd>{{ display(reading().fields['max']) }}</dd>
          </div>
          <div>
            <dt>Crítico</dt>
            <dd>{{ display(reading().fields['critical']) }}</dd>
          </div>
          <div>
            <dt>Alarma</dt>
            <dd>{{ display(reading().fields['alarm']) }}</dd>
          </div>
          <div>
            <dt>Fallo</dt>
            <dd>{{ display(reading().fields['fault']) }}</dd>
          </div>
        </dl>
      } @else {
        <small
          >Alarma: {{ display(reading().fields['alarm']) }} · Fallo:
          {{ display(reading().fields['fault']) }}</small
        >
      }
      <details>
        <summary>Lectura original · todos los campos</summary>
        <app-system-data [value]="reading().raw" />
      </details>
    </article>
  `,
  styleUrl: './system-sensor-card.scss',
})
export class SystemSensorCard {
  readonly compact = input(false);
  readonly reading = input.required<SensorReading>();
  readonly ratio = computed(() => criticalRatio(this.reading().fields));
  readonly display = displaySystemValue;
}
