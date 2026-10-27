import { Component, computed, input } from '@angular/core';
import { displaySystemValue } from '../../system-format';
import { SystemSensorCard } from '../system-sensor-card/system-sensor-card';
import { coreStatistics, isCore, SensorReading } from '../system-sensor-card/system-sensors';

@Component({
  selector: 'app-system-processor-panel',
  imports: [SystemSensorCard],
  templateUrl: './system-processor-panel.html',
  styleUrl: './system-processor-panel.scss',
})
export class SystemProcessorPanel {
  readonly readings = input.required<SensorReading[]>();
  readonly packages = input.required<SensorReading[]>();
  readonly statisticNumber = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
  readonly display = displaySystemValue;
  readonly statistics = computed(() => coreStatistics(this.readings()));
  readonly cores = computed(() => this.readings().filter((reading) => isCore(reading.fields)));
  readonly otherProcessorReadings = computed(() => {
    const packages = new Set(this.packages().map((reading) => reading.index));
    return this.readings().filter(
      (reading) => !isCore(reading.fields) && !packages.has(reading.index),
    );
  });

  statisticsFor(reading: SensorReading) {
    const unit = reading.fields['unit'];
    const normalized = unit === '°C' ? 'C' : unit === '°F' ? 'F' : unit;
    return this.statistics().find(
      (stats) => stats.device === reading.fields['device'] && stats.unit === normalized,
    );
  }
}
