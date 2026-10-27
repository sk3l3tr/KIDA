import { Component, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SystemData } from '../system-data/system-data';
import { SystemRtcCard } from '../system-rtc-card/system-rtc-card';
import { SystemPowerCard } from '../system-power-card/system-power-card';
import { SystemCycleCard } from '../system-cycle-card/system-cycle-card';
import { SystemFacade } from '../../system.facade';

@Component({
  selector: 'app-system-energy',
  imports: [IonContent, SystemData, SystemRtcCard, SystemPowerCard, SystemCycleCard],
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
