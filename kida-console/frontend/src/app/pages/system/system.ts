import { Component, OnDestroy, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { SystemFacade } from './system.facade';

@Component({
  selector: 'app-system',
  imports: [IonicModule],
  providers: [SystemFacade],
  templateUrl: './system.html',
  styles: `
    ion-tab-bar {
      justify-content: start;
      border-bottom: var(--kida-border-width) solid var(--ion-border-color);
    }
    ion-tab-button {
      max-width: 12rem;
      min-height: 52px;
      font-family: var(--kida-font);
      font-weight: 700;
    }
    ion-tab-button::part(native):focus-visible {
      outline: 3px solid var(--ion-color-primary);
      outline-offset: -4px;
    }
  `,
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
