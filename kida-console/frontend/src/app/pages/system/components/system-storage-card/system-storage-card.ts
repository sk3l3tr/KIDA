import { Component, computed, input } from '@angular/core';
import { displaySystemValue } from '../../utils/system-format';
import { criticalRatio, SensorReading } from '../system-sensor-card/system-sensors';

export function storageDevices(readings: SensorReading[]): SensorReading[][] {
  const devices = new Map<string, SensorReading[]>();
  for (const reading of readings) {
    const device = reading.fields['device'];
    if (typeof device !== 'string' || !device) continue;
    const group = devices.get(device) ?? [];
    group.push(reading);
    devices.set(device, group);
  }
  return [...devices.values()];
}

@Component({
  selector: 'app-system-storage-card',
  templateUrl: './system-storage-card.html',
  styleUrls: ['../system-icon.scss', './system-storage-card.scss'],
})
export class SystemStorageCard {
  readonly readings = input.required<SensorReading[]>();
  readonly reading = computed(
    () =>
      this.readings().find(
        ({ fields }) =>
          typeof fields['label'] === 'string' && fields['label'].toLowerCase() === 'composite',
      ) ?? this.readings()[0],
  );
  readonly secondary = computed(() =>
    this.readings().filter((reading) => reading !== this.reading()),
  );
  readonly rawPercentage = computed(() => {
    if (criticalRatio(this.reading().fields) === null) return null;
    const { value, critical } = this.reading().fields;
    const result = ((value as number) / (critical as number)) * 100;
    return Number.isFinite(result) ? result : null;
  });
  readonly ratio = computed(() =>
    this.rawPercentage() === null ? null : criticalRatio(this.reading().fields),
  );
  readonly percentage = computed(() =>
    this.rawPercentage() === null
      ? 'Desconocido'
      : `${new Intl.NumberFormat('es', { maximumFractionDigits: 2 }).format(this.rawPercentage()!)} %`,
  );
  readonly display = displaySystemValue;
}
