import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { DOCUMENT, JsonPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { ContainerDetails } from './container-details';
import { DockerFacade } from './docker.facade';
import { DockerIndicators } from './docker-indicators';
import { DockerComposeVersion } from './docker-compose-version';
import { DockerProjectCard } from './docker-project-card';

@Component({
  selector: 'app-docker-view',
  imports: [IonContent, JsonPipe, ContainerDetails, DockerIndicators, DockerComposeVersion, DockerProjectCard],
  templateUrl: './docker-view.html',
  styleUrl: './docker.scss',
})
export class DockerView {
  readonly state = inject(DockerFacade);
  private readonly document = inject(DOCUMENT);
  tab = inject(ActivatedRoute).snapshot.data['tab'] as 'projects' | 'containers';
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');
  constructor() {
    effect(() => {
      const visible = this.state.visibleContainerIds();
      const row = this.document.activeElement?.closest<HTMLElement>('[data-container-id]');
      if (row && !visible.has(row.dataset['containerId'] ?? '')) {
        this.document.getElementById('docker-search')?.focus();
      }
    });
  }
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
    this.state.heading = () => this.heading()?.nativeElement;
  }
}
