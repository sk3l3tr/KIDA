import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { DOCUMENT, JsonPipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { SidePanel } from '../../components/side-panel/side-panel';
import { Masonry, MasonryItem } from '../../components/masonry/masonry';
import { ContainerDetails } from './components/container-details/container-details';
import { ContainerActions } from './components/container-actions/container-actions';
import { DockerFacade } from './services/docker.facade';
import { DockerIndicators } from './components/docker-indicators/docker-indicators';
import { DockerProjectCard } from './components/docker-project-card/docker-project-card';

@Component({
  selector: 'app-docker-view',
  imports: [
    IonContent,
    SidePanel,
    JsonPipe,
    ContainerDetails,
    ContainerActions,
    DockerIndicators,
    DockerProjectCard,
    Masonry,
    MasonryItem,
  ],
  templateUrl: './docker-view.html',
  styleUrl: './docker.scss',
})
export class DockerView {
  readonly state = inject(DockerFacade);
  private readonly document = inject(DOCUMENT);
  readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');

  tab = inject(ActivatedRoute).snapshot.data['tab'] as 'projects' | 'containers';

  constructor() {
    effect(() => {
      const visible = this.state.visibleContainerIds();
      const row = this.document.activeElement?.closest<HTMLElement>('[data-container-id]');
      if (row && !visible.has(row.dataset['containerId'] ?? '')) {
        this.document.getElementById('docker-search')?.focus();
      }
    });
  }

  panelOpen(): boolean {
    const selected = this.state.inspectedContainer();
    return (
      (this.tab === 'projects' && this.state.projectPanelOpen() !== null) ||
      (!!selected && (selected.source === 'inventory' ? 'containers' : 'projects') === this.tab)
    );
  }
  closePanel(): void {
    if (!this.panelOpen()) return;
    this.state.invalidateConfirmation();
    this.state.projectPanelOpen.set(null);
    this.state.inspectedContainer.set(null);
  }
  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
    this.state.heading = () => this.listHeading()?.nativeElement;
  }
}
