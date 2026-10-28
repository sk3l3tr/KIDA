import { Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { DockerFacade } from './docker.facade';

@Component({
  selector: 'app-docker',
  imports: [IonicModule],
  providers: [DockerFacade],
  templateUrl: './docker.html',
  styleUrl: './docker-tabs.scss',
})
export class Docker implements OnDestroy {
  readonly state = inject(DockerFacade);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  constructor() {
    this.state.dialog = () => this.dialog()?.nativeElement;
  }
  ionViewWillEnter(): void { this.state.ionViewWillEnter(); }
  ionViewWillLeave(): void { this.state.ionViewWillLeave(); }
  ngOnDestroy(): void { this.state.ionViewWillLeave(); }
}
