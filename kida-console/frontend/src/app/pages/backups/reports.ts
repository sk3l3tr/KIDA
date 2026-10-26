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
import { restoreDialogFocus, trapDialogFocus } from '../../services/dialog-focus';
import { BackupReportsState } from './reports-state';
import { limitedPrecision } from './backups-presentation';

@Component({
  selector: 'app-backup-reports',
  imports: [DatePipe, JsonPipe],
  templateUrl: './reports.html',
  styleUrl: './backups.scss',
})
export class BackupReports implements OnDestroy {
  readonly state = input.required<BackupReportsState>();
  readonly limitedPrecision = limitedPrecision;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
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
        () => this.listHeading()?.nativeElement,
        () => !state.disabled() && !!this.listHeading()?.nativeElement.isConnected,
      );
    });
  }
  ngOnDestroy(): void {
    this.restoreRequested.set(false);
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
  prepare(id: string): void {
    const state = this.state();
    if (state.disabled()) return;
    this.trigger = this.document.activeElement;
    if (!state.prepare(id)) return;
    try {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) throw new Error();
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
    } catch {
      state.cancel();
      this.closeConfirmation();
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
}
