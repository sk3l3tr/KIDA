import { Component, computed, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from '../../system.facade';
import { SystemSectionView } from '../system-section/system-section';
import { SystemData } from '../system-data/system-data';
import { SystemSensorCard } from '../system-sensor-card/system-sensor-card';
import { SystemStorageCard, storageDevices } from '../system-storage-card/system-storage-card';
import { SystemFanRow } from '../system-fan-row/system-fan-row';
import { SystemProcessorPanel } from '../system-processor-panel/system-processor-panel';
import { fields, healthExtras, isCore } from '../system-sensor-card/system-sensors';
import { SystemIndicator } from '../system-indicator/system-indicator';
import { displaySystemValue } from '../../system-format';

@Component({
  selector: 'app-system-overview',
  imports: [IonContent, SystemSectionView, SystemData, SystemSensorCard, SystemStorageCard, SystemFanRow, SystemProcessorPanel, SystemIndicator],
  templateUrl: './system-overview.html',
  styleUrl: '../../system.scss',
})
export class SystemOverview {
  readonly state = inject(SystemFacade);
  readonly isCore = isCore;
  readonly display = displaySystemValue;
  readonly storageDevices = storageDevices;
  readonly packages = computed(() =>
    this.state
      .groups()[0]
      .readings.filter(
        (r) => typeof r.fields['label'] === 'string' && /^Package id \d+$/i.test(r.fields['label']),
      ),
  );
  readonly overall = computed(() =>
    displaySystemValue(fields(this.state.health.data())['overall']),
  );
  readonly alarms = computed(
    () => this.state.sensors().filter((s) => s.fields['alarm'] === true).length,
  );
  readonly faults = computed(
    () => this.state.sensors().filter((s) => s.fields['fault'] === true).length,
  );
  readonly extras = computed(() => healthExtras(this.state.health.data()));
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
}
