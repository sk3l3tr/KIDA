import { JsonPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { SidePanel } from '../../../../components/side-panel/side-panel';
import { DockerFacade } from '../../services/docker.facade';

@Component({
  selector: 'app-docker-compose-version',
  imports: [JsonPipe, SidePanel],
  templateUrl: './docker-compose-version.html',
  styleUrl: './docker-compose-version.scss',
})
export class DockerComposeVersion {
  readonly state = inject(DockerFacade);
  readonly tab = input.required<'projects' | 'containers'>();
  readonly fallbackFocus = input<HTMLElement | null>(null);

  close(): void {
    if (this.state.versionPanelOpen() === this.tab()) this.state.versionPanelOpen.set(null);
  }
}
