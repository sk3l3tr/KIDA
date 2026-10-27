import { Component, OnDestroy, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { SystemFacade } from './system.facade';

@Component({
  selector: 'app-system',
  imports: [IonicModule],
  providers: [SystemFacade],
  templateUrl: './system.html',
  styleUrl: './system-tabs.scss',
})
export class System implements OnDestroy {
  readonly state = inject(SystemFacade);
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
  ionViewWillLeave(): void {
    this.state.ionViewWillLeave();
  }
  ngOnDestroy(): void {
    this.state.ionViewWillLeave();
  }
}
