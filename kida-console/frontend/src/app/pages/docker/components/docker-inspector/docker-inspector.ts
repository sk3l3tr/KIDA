import { Component, inject, input } from '@angular/core';
import { DockerOperationStatus } from '../docker-operation-status/docker-operation-status';
import { DockerSectionStatus } from '../docker-section-status/docker-section-status';
import { SidePanel } from '../../../../components/side-panel/side-panel';
import { ContainerDetails } from '../container-details/container-details';
import { ContainerActions } from '../container-actions/container-actions';
import { ComposeService } from '../../utils/docker.models';
import { DockerFacade } from '../../services/docker.facade';

@Component({
  selector: 'app-docker-inspector',
  imports: [
    DockerOperationStatus,
    DockerSectionStatus,
    SidePanel,
    ContainerDetails,
    ContainerActions,
  ],
  templateUrl: './docker-inspector.html',
  styleUrl: './docker-inspector.scss',
})
export class DockerInspector {
  readonly state = inject(DockerFacade);
  readonly source = input.required<'projects' | 'containers'>();
  readonly fallbackFocus = input<HTMLElement | null>(null);

  activeCount(service: ComposeService): number {
    return service.containers.filter((container) => container.online).length;
  }

  panelOpen(): boolean {
    const selected = this.state.inspectedContainer();
    return (
      (this.source() === 'projects' && this.state.projectPanelOpen() !== null) ||
      (!!selected &&
        (selected.source === 'inventory' ? 'containers' : 'projects') === this.source())
    );
  }
  closePanel(): void {
    if (!this.panelOpen()) return;
    this.state.invalidateConfirmation();
    this.state.projectPanelOpen.set(null);
    this.state.inspectedContainer.set(null);
  }
}
