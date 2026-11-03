import { Component, inject } from '@angular/core';
import { DockerOperationStatus } from '../../components/docker-operation-status/docker-operation-status';
import { DockerSectionStatus } from '../../components/docker-section-status/docker-section-status';
import { IonContent } from '@ionic/angular/standalone';
import { DockerFacade } from '../../services/docker.facade';
import { DockerIndicators } from '../../components/docker-indicators/docker-indicators';
import { DockerInspector } from '../../components/docker-inspector/docker-inspector';
import { Masonry, MasonryItem } from '../../../../components/masonry/masonry';
import { DockerProjectCard } from '../../components/docker-project-card/docker-project-card';

@Component({
  selector: 'app-docker-projects',
  imports: [
    IonContent,
    DockerOperationStatus,
    DockerSectionStatus,
    DockerIndicators,
    DockerInspector,
    Masonry,
    MasonryItem,
    DockerProjectCard,
  ],
  templateUrl: './docker-projects.html',
  styleUrl: '../../docker.scss',
})
export class DockerProjects {
  readonly state = inject(DockerFacade);

  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
}
