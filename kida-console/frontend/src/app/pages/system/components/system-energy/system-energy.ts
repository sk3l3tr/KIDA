import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { SystemData } from '../system-data/system-data';
import { SystemRtcCard } from '../system-rtc-card/system-rtc-card';
import { SystemFacade } from '../../system.facade';

@Component({
  selector: 'app-system-energy',
  imports: [IonContent, FormsModule, SystemData, SystemRtcCard],
  templateUrl: './system-energy.html',
  styleUrl: '../../system.scss',
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
