import { Component, computed, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from '../../services/system.facade';
import {
  SystemStorageCard,
  storageDevices,
} from '../../components/system-storage-card/system-storage-card';
import { SystemFanRow } from '../../components/system-fan-row/system-fan-row';
import { SystemProcessorPanel } from '../../components/system-processor-panel/system-processor-panel';
import { fields, healthExtras } from '../../components/system-sensor-card/system-sensors';
import { SystemIndicator } from '../../components/system-indicator/system-indicator';
import { displaySystemValue } from '../../utils/system-format';
import { Masonry, MasonryItem } from '../../../../components/masonry/masonry';

@Component({
  selector: 'app-system-overview',
  imports: [
    IonContent,
    SystemStorageCard,
    SystemFanRow,
    SystemProcessorPanel,
    SystemIndicator,
    Masonry,
    MasonryItem,
  ],
  templateUrl: './system-overview.html',
  styleUrl: '../../system.scss',
})
export class SystemOverview {
  readonly state = inject(SystemFacade);
  readonly otherName = (device: unknown, label: unknown): string => {
    if (typeof device === 'string') {
      if (/^iwlwifi/i.test(device)) return 'Wi-Fi';
      const zone = /^acpitz_(\d+)$/i.exec(device);
      if (zone) return `Zona térmica ACPI ${zone[1]}`;
    }
    return displaySystemValue(label);
  };
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
