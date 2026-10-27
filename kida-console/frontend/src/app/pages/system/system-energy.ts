import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { SystemFacade } from './system.facade';
import { SystemData } from './system-data';
import { SystemSectionView } from './system-section';

@Component({
  selector: 'app-system-energy',
  imports: [IonContent, FormsModule, SystemData, SystemSectionView],
  templateUrl: './system-energy.html',
  styleUrl: './system.scss',
})
export class SystemEnergy {
  readonly state = inject(SystemFacade);
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
    this.state.enterEnergy();
  }
  ionViewWillLeave(): void {
    this.state.leaveEnergy();
  }
}
