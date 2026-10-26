import {
  Component,
  ElementRef,
  Injector,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { restoreDialogFocus } from '../../services/dialog-focus';
import { BackupHealthState } from './health-state';
import { limitedPrecision } from './backups-presentation';

@Component({
  selector: 'app-backup-health',
  imports: [DatePipe, JsonPipe, FormsModule],
  templateUrl: './health.html',
  styleUrl: './backups.scss',
})
export class BackupHealth {
  readonly state = input.required<BackupHealthState>();
  readonly limitedPrecision = limitedPrecision;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly createButton = viewChild<ElementRef<HTMLButtonElement>>('createButton');
  private readonly restoreRequested = signal(false);
  private trigger: Element | null = null;

  constructor() {
    effect(() => {
      const state = this.state();
      if (!this.restoreRequested() || state.disabled()) return;
      this.restoreRequested.set(false);
      restoreDialogFocus(
        this.injector,
        this.trigger,
        () => this.createButton()?.nativeElement,
        () => !state.disabled() && !!this.createButton()?.nativeElement.isConnected,
      );
    });
  }
  create(): void {
    const state = this.state();
    if (state.disabled()) return;
    this.trigger = this.document.activeElement;
    this.restoreRequested.set(true);
    state.create();
  }
}
