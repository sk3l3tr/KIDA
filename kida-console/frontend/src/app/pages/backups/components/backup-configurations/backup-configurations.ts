import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { BackupConfigurationsState } from '../../services/configurations-state';
import { BackupCreateForm } from '../backup-create-form/backup-create-form';
import { limitedPrecision } from '../../utils/backups-presentation';

@Component({
  selector: 'app-backup-configurations',
  imports: [DatePipe, JsonPipe, BackupCreateForm],
  templateUrl: './backup-configurations.html',
  styleUrl: '../../backups.scss',
  styles: `
    :host {
      display: contents;
    }
    :host > .error,
    :host > .success {
      grid-column: 1 / -1;
    }
  `,
})
export class BackupConfigurations {
  readonly state = inject(BackupConfigurationsState);
  readonly limitedPrecision = limitedPrecision;
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');

  constructor() {
    this.state.focusFallback = () => this.listHeading()?.nativeElement;
  }
}
