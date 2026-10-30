import { Component, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SystemRtcCard } from '../../components/system-rtc-card/system-rtc-card';
import { SystemPowerCard } from '../../components/system-power-card/system-power-card';
import { SystemCycleCard } from '../../components/system-cycle-card/system-cycle-card';
import { SystemFacade } from '../../services/system.facade';
import { Masonry, MasonryItem } from '../../../../components/masonry/masonry';

@Component({
  selector: 'app-system-energy',
  imports: [IonContent, SystemRtcCard, SystemPowerCard, SystemCycleCard, Masonry, MasonryItem],
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
