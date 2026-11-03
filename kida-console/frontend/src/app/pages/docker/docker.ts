import { Component, OnDestroy, inject } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { DockerFacade } from './services/docker.facade';

@Component({
  selector: 'app-docker',
  imports: [IonicModule],
  providers: [DockerFacade],
  templateUrl: './docker.html',
  styleUrl: './docker-tabs.scss',
})
export class Docker implements OnDestroy {
  readonly state = inject(DockerFacade);
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
