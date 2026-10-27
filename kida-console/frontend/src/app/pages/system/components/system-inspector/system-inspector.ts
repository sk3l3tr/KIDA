import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from '../../system.facade';
import { SystemSectionView } from '../system-section/system-section';
import { SystemData } from '../system-data/system-data';
import { matchesSensor } from '../system-sensor-card/system-sensors';
import { displaySystemValue } from '../../system-format';

@Component({
  selector: 'app-system-inspector',
  imports: [IonContent, FormsModule, SystemSectionView, SystemData],
  templateUrl: './system-inspector.html',
  styleUrl: '../../system.scss',
})
export class SystemInspector {
  readonly state = inject(SystemFacade);
  readonly query = signal('');
  readonly readings = computed(() =>
    this.state.sensors().filter((r) => matchesSensor(r, this.query())),
  );
  readonly display = displaySystemValue;
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
}
