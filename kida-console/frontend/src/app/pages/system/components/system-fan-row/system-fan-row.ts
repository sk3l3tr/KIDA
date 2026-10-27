import { Component, computed, input } from '@angular/core';
import { displaySystemValue } from '../../system-format';
import { finite, SensorReading } from '../system-sensor-card/system-sensors';

@Component({
  selector: 'app-system-fan-row',
  templateUrl: './system-fan-row.html',
  styleUrl: './system-fan-row.scss',
})
export class SystemFanRow {
  readonly reading = input.required<SensorReading>();
  readonly display = displaySystemValue;
  readonly stopped = computed(() => this.reading().fields['value'] === 0 && this.reading().fields['unit'] === 'RPM');
  readonly spinning = computed(() => {
    const { value, unit, status } = this.reading().fields;
    return finite(value) && value > 0 && unit === 'RPM' && (status === 'OK' || status === 'CRITICAL');
  });
  readonly danger = computed(() => {
    const { alarm, fault, status } = this.reading().fields;
    return alarm === true || fault === true || status === 'CRITICAL';
  });
}
