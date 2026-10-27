import { Component, computed, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from '../../system.facade';
import { SystemSectionView } from '../system-section/system-section';
import { SystemData } from '../system-data/system-data';
import { SystemSensorCard } from '../system-sensor-card/system-sensor-card';
import { coreStatistics, fields, healthExtras, isCore } from '../system-sensor-card/system-sensors';
import { SystemIndicator } from '../system-indicator/system-indicator';
import { displaySystemValue } from '../../system-format';

@Component({
  selector: 'app-system-overview',
  imports: [IonContent, SystemSectionView, SystemData, SystemSensorCard, SystemIndicator],
  templateUrl: './system-overview.html',
  styleUrl: '../../system.scss',
})
export class SystemOverview {
  readonly statisticNumber = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
  readonly state = inject(SystemFacade);
  readonly isCore = isCore;
  readonly display = displaySystemValue;
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
  readonly statistics = computed(() => coreStatistics(this.state.sensors()));
  readonly extras = computed(() => healthExtras(this.state.health.data()));
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
}
