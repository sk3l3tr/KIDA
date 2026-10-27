import { Component, computed, input } from '@angular/core';
import { SystemData } from '../system-data/system-data';
import { SensorReading, criticalRatio } from './system-sensors';
import { displaySystemValue } from '../../system-format';

@Component({
  selector: 'app-system-sensor-card',
  imports: [SystemData],
  templateUrl: './system-sensor-card.html',
  styleUrl: './system-sensor-card.scss',
})
export class SystemSensorCard {
  readonly compact = input(false);
  readonly reading = input.required<SensorReading>();
  readonly ratio = computed(() => criticalRatio(this.reading().fields));
  readonly display = displaySystemValue;
}
