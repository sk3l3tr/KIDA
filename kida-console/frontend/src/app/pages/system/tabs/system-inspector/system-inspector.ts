import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from '../../services/system.facade';
import { SystemSectionView } from '../../components/system-section/system-section';
import { SystemSensorTable } from '../../components/system-sensor-table/system-sensor-table';
import { matchesSensor } from '../../components/system-sensor-card/system-sensors';

@Component({
  selector: 'app-system-inspector',
  imports: [IonContent, FormsModule, SystemSectionView, SystemSensorTable],
  templateUrl: './system-inspector.html',
  styleUrls: ['../../system.scss', './system-inspector.scss'],
})
export class SystemInspector {
  readonly state = inject(SystemFacade);
  readonly query = signal('');
  readonly readings = computed(() =>
    this.state.sensors().filter((r) => matchesSensor(r, this.query())),
  );
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
}
