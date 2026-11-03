import { Component, ElementRef, input, output, viewChild } from '@angular/core';
import { PendingContainer } from '../../utils/docker.models';
import { actionLabels } from '../../utils/docker-presentation';

@Component({
  selector: 'app-docker-confirmation',
  templateUrl: './docker-confirmation.html',
})
export class DockerConfirmation {
  readonly pending = input<PendingContainer | null>(null);
  readonly resolved = output<boolean>();
  readonly keydown = output<KeyboardEvent>();
  readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('confirmation');
  readonly labels = actionLabels;
}
