import { Component, input } from '@angular/core';
import { displaySystemValue } from '../../utils/system-format';
import { SensorReading } from '../system-sensor-card/system-sensors';

@Component({
  selector: 'app-system-sensor-table',
  templateUrl: './system-sensor-table.html',
  styleUrl: './system-sensor-table.scss',
})
export class SystemSensorTable {
  readonly readings = input.required<SensorReading[]>();
  readonly display = displaySystemValue;

  unit(value: unknown, type: unknown): string {
    if (type === 'temperature' && value === 'C') return '°C';
    if (type === 'temperature' && value === 'F') return '°F';
    return value == null || value === '' ? '' : displaySystemValue(value);
  }
}
