import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Subscription, finalize } from 'rxjs';
import { ThemeIdentity } from '../../../theme/integration';
import { SchedulerService } from './scheduler.service';
import { ListedSchedule, OriginFilter, PendingSchedule, Schedule } from './scheduler.models';
import { createBody, emptyForm, freezeSnapshot } from './scheduler-form';
import { localDate, originLabels, ruleSummary, schedulerFailure } from './scheduler-presentation';

@Component({
  selector: 'app-scheduler',
  imports: [IonContent, FormsModule, DatePipe, JsonPipe],
  templateUrl: './scheduler.html',
  styleUrl: './scheduler.scss',
})
export class Scheduler implements OnDestroy {
  private readonly service = inject(SchedulerService);
  private readonly identity = inject(ThemeIdentity);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  readonly entries = signal<ListedSchedule[] | null>(null);
  readonly loading = signal(false);
  readonly listError = signal('');
  readonly updated = signal<Date | null>(null);
  readonly visibleOrigin = signal<OriginFilter | null>(null);
  readonly busy = signal(false);
  readonly pending = signal<PendingSchedule | null>(null);
  readonly error = signal('');
  readonly result = signal<Schedule | null>(null);
  readonly resultLabel = signal('');
  readonly originLabels = originLabels;
  readonly localDate = localDate;
  readonly ruleSummary = ruleSummary;
  readonly zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  origin: OriginFilter = 'USER';
  form = emptyForm();
  private active = false;
  private generation = 0;
  private subscriptions = new Subscription();
  private trigger: Element | null = null;
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.reset());

  ionViewWillEnter(): void {
    this.reset();
    this.active = true;
    this.refresh();
  }
  ionViewWillLeave(): void {
    this.reset();
  }
  ngOnDestroy(): void {
    this.ionViewWillLeave();
    this.sessionChanges.unsubscribe();
  }
  private reset(): void {
    this.active = false;
    ++this.generation;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.closeConfirmation();
    this.busy.set(false);
    this.loading.set(false);
    this.entries.set(null);
    this.listError.set('');
    this.updated.set(null);
    this.visibleOrigin.set(null);
    this.error.set('');
    this.result.set(null);
    this.resultLabel.set('');
    this.form = emptyForm();
    this.origin = 'USER';
    this.trigger = null;
  }
  selectOrigin(value: string): void {
    if (this.loading() || this.busy() || !['USER', 'INTERNAL', 'ALL'].includes(value)) return;
    this.origin = value as OriginFilter;
    this.refresh();
  }
  refresh(): void {
    if (this.busy()) return;
    this.loadSchedules();
  }
  private loadSchedules(restoreFocus = false): void {
    if (!this.active || this.loading()) return;
    const origin = this.origin;
    this.loading.set(true);
    this.listError.set('');
    this.subscriptions.add(
      this.service
        .list(origin)
        .pipe(
          finalize(() => {
            this.loading.set(false);
            if (restoreFocus) this.restoreFocus();
          }),
        )
        .subscribe({
          next: (entries) => {
            this.entries.set(entries);
            this.visibleOrigin.set(origin);
            this.updated.set(new Date());
          },
          error: (failure) => this.listError.set(schedulerFailure(failure)),
        }),
    );
  }
  prepareAdd(): void {
    if (!this.active || this.busy() || this.loading()) return;
    try {
      this.open({ action: 'add', body: createBody(this.form) });
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Formulario no válido.');
    }
  }
  prepareDelete(entry: ListedSchedule): void {
    if (!this.active || this.busy() || this.loading() || entry.origin !== 'USER') return;
    this.open({ action: 'delete', body: { id: entry.id }, entry });
  }
  private open(pending: PendingSchedule): void {
    this.trigger = this.document.activeElement;
    try {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) throw new Error('Confirmation is unavailable');
      this.pending.set(freezeSnapshot(pending));
      this.busy.set(true);
      this.error.set('');
      dialog.showModal();
      dialog.querySelector<HTMLButtonElement>('[autofocus]')?.focus();
    } catch {
      this.closeConfirmation();
      this.busy.set(false);
      this.error.set('No se pudo abrir la confirmación.');
      this.restoreFocus();
    }
  }
  trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const buttons = this.dialog()?.nativeElement.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    const first = buttons[0],
      last = buttons[buttons.length - 1];
    if (event.shiftKey && this.document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && this.document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  cancel(): void {
    if (!this.pending()) return;
    this.closeConfirmation();
    this.busy.set(false);
    this.restoreFocus();
  }
  private closeConfirmation(): void {
    this.pending.set(null);
    const dialog = this.dialog()?.nativeElement;
    if (dialog?.open) dialog.close();
  }
  private restoreFocus(): void {
    if (!this.active) return;
    const generation = this.generation;
    const trigger = this.trigger;
    afterNextRender(
      {
        write: () => {
          if (!this.active || generation !== this.generation) return;
          const target =
            trigger instanceof HTMLElement && trigger.isConnected && !trigger.matches(':disabled')
              ? trigger
              : this.listHeading()?.nativeElement;
          target?.focus({ preventScroll: true });
        },
      },
      { injector: this.injector },
    );
  }
  confirm(): void {
    const pending = this.pending();
    if (!this.active || !pending) return;
    // Consume the snapshot before dispatch so a double click cannot send it twice.
    this.closeConfirmation();
    this.result.set(null);
    this.resultLabel.set('');
    const request =
      pending.action === 'add' ? this.service.add(pending.body) : this.service.delete(pending.body);
    let succeeded = false;
    this.subscriptions.add(
      request
        .pipe(
          finalize(() => {
            this.busy.set(false);
            if (!succeeded) this.restoreFocus();
          }),
        )
        .subscribe({
          next: (result) => {
            succeeded = true;
            this.result.set(result);
            this.resultLabel.set(
              pending.action === 'add' ? 'Programación creada' : 'Programación eliminada',
            );
            if (pending.action === 'add') this.form = emptyForm();
            this.loadSchedules(true);
          },
          error: (failure) => this.error.set(schedulerFailure(failure, true)),
        }),
    );
  }
}
