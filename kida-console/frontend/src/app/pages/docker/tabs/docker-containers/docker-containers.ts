import { Component, inject, effect } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { DockerOperationStatus } from '../../components/docker-operation-status/docker-operation-status';
import { DockerSectionStatus } from '../../components/docker-section-status/docker-section-status';
import { IonContent } from '@ionic/angular/standalone';
import { DockerFacade } from '../../services/docker.facade';
import { DockerIndicators } from '../../components/docker-indicators/docker-indicators';
import { DockerInspector } from '../../components/docker-inspector/docker-inspector';
import { ContainerActions } from '../../components/container-actions/container-actions';

@Component({
  selector: 'app-docker-containers',
  imports: [
    IonContent,
    DockerOperationStatus,
    DockerSectionStatus,
    DockerIndicators,
    DockerInspector,
    ContainerActions,
  ],
  templateUrl: './docker-containers.html',
  styleUrls: ['../../docker.scss', './docker-containers.scss'],
})
export class DockerContainers {
  readonly state = inject(DockerFacade);

  private readonly document = inject(DOCUMENT);
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
  }
}
