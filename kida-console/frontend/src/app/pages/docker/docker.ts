import { Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { DockerFacade } from './services/docker.facade';
import { DockerConfirmationService } from './services/docker-confirmation.service';

@Component({
  selector: 'app-docker',
  imports: [IonicModule],
  providers: [DockerFacade, DockerConfirmationService],
  templateUrl: './docker.html',
  styleUrl: './docker-tabs.scss',
})
export class Docker implements OnDestroy {
  readonly state = inject(DockerFacade);
  readonly confirmations = inject(DockerConfirmationService);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  constructor() {
    this.confirmations.dialog = () => this.dialog()?.nativeElement;
  }
  trapFocus(event: KeyboardEvent): void {
    this.confirmations.trapFocus(event, () => this.state.cancel());
  }
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
