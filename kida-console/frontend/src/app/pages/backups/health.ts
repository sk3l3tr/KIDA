import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { restoreDialogFocus, trapDialogFocus } from '../../services/dialog-focus';
import { BackupHealthState } from './health-state';
import { HealthAction } from './health.models';
import { limitedPrecision } from './backups-presentation';

@Component({
  selector: 'app-backup-health',
  imports: [DatePipe, JsonPipe, FormsModule],
  templateUrl: './health.html',
  styleUrl: './backups.scss',
})
export class BackupHealth implements OnDestroy {
  readonly state = input.required<BackupHealthState>();
  readonly limitedPrecision = limitedPrecision;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  private readonly createButton = viewChild<ElementRef<HTMLButtonElement>>('createButton');
  private readonly restoreRequested = signal(false);
  private trigger: Element | null = null;

  constructor() {
    effect(() => {
      const state = this.state();
      if (!state.pending() && this.dialog()?.nativeElement.open)
        this.dialog()?.nativeElement.close();
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
  ngOnDestroy(): void {
    this.restoreRequested.set(false);
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
  prepare(action: HealthAction): void {
    const state = this.state();
    if (state.disabled()) return;
    this.trigger = this.document.activeElement;
    if (!state.prepare(action)) return;
    try {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) throw new Error();
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
    } catch {
      state.cancel();
      const dialog = this.dialog()?.nativeElement;
      if (dialog?.open) dialog.close();
      state.error.set('No se pudo abrir la confirmación.');
      this.restoreRequested.set(true);
    }
  }
  trapFocus(event: KeyboardEvent): void {
    trapDialogFocus(event, this.dialog()?.nativeElement, this.document);
  }
  cancel(): void {
    if (!this.state().pending()) return;
    this.closeConfirmation();
    this.state().cancel();
    this.restoreRequested.set(true);
  }
  confirm(): void {
    if (!this.state().pending()) return;
    this.closeConfirmation();
    this.restoreRequested.set(true);
    this.state().confirm();
  }
  private closeConfirmation(): void {
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
  create(): void {
    const state = this.state();
    if (state.disabled()) return;
    this.trigger = this.document.activeElement;
    this.restoreRequested.set(true);
    state.create();
  }
}
