import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { JsonPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ContainerDetails } from './container-details';
import { DockerFacade } from './docker.facade';

@Component({
  selector: 'app-docker-view',
  imports: [IonContent, JsonPipe, ContainerDetails],
  templateUrl: './docker-view.html',
  styleUrl: './docker.scss',
})
export class DockerView {
  readonly state = inject(DockerFacade);
  tab = inject(ActivatedRoute).snapshot.data['tab'] as 'projects' | 'containers';
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
    this.state.heading = () => this.heading()?.nativeElement;
  }
}
