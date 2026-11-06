import { Injectable, Injector, OnDestroy, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Subscription, filter, finalize, take } from 'rxjs';
import { ArcaService } from 'arca';
import { restoreDialogFocus } from '../../../services/dialog-focus';
import { AppDialog } from '../../../components/app-dialog/app-dialog';
import {
  APP_DIALOG_CANCEL,
  APP_DIALOG_OPEN,
  AppDialogConfig,
  AppDialogResult,
  newDialogContext,
} from '../../../components/app-dialog/app-dialog.models';
import { ThemeIdentity } from '../../../../theme/integration';
import { SchedulerService } from './scheduler.service';
import { ListedSchedule, OriginFilter, PendingSchedule, Schedule } from '../utils/scheduler.models';
import { createBody, emptyForm, freezeSnapshot } from '../utils/scheduler-form';
import { ruleSummary, schedulerFailure } from '../utils/scheduler-presentation';

@Injectable()
export class SchedulerFacade implements OnDestroy {
  private readonly service = inject(SchedulerService);
  private readonly identity = inject(ThemeIdentity);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly arca = inject(ArcaService);
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  focusFallback: () => HTMLElement | undefined = () => undefined;
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
  readonly createOpen = signal(false);
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
    this.createOpen.set(false);
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
  openCreate(): void {
    if (!this.active || this.busy() || this.loading()) return;
    this.createOpen.set(true);
  }
  closeCreate(): void {
    this.createOpen.set(false);
    if (this.pending()?.action === 'add') this.cancel();
  }
  prepareDelete(entry: ListedSchedule): void {
    if (!this.active || this.busy() || this.loading() || entry.origin !== 'USER') return;
    this.open({ action: 'delete', body: { id: entry.id }, entry });
  }
  private open(pending: PendingSchedule): void {
    if (this.arca.modals.modalOpen) return;
    this.trigger = this.document.activeElement;
    const snapshot = freezeSnapshot(pending);
    this.pending.set(snapshot);
    this.busy.set(true);
    this.error.set('');
    const context = newDialogContext();
    this.dialogContext = context;
    const config: AppDialogConfig = {
      context,
      title: 'Confirmar programación',
      type: pending.action === 'delete' ? 'danger' : 'confirmation',
      text:
        snapshot.action === 'add'
          ? [
              `Crear: ${snapshot.body.command}`,
              JSON.stringify(snapshot.body.params, null, 2),
              ruleSummary(snapshot.body.schedule),
              `Zona local del navegador: ${this.zone}.`,
            ]
          : [
              `Eliminar: ${snapshot.entry.command}`,
              `Identificador: ${snapshot.body.id}`,
              JSON.stringify(snapshot.entry.params, null, 2),
              ruleSummary(snapshot.entry.schedule),
              'Eliminar la programación no cancela comandos ya encolados.',
              `Zona local del navegador: ${this.zone}.`,
            ],
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        {
          id: 'confirm',
          text: 'Confirmar',
          style: pending.action === 'delete' ? 'danger' : undefined,
        },
      ],
    };
    const failed = () => {
      if (this.dialogContext !== context) return;
      this.closeConfirmation();
      this.busy.set(false);
      this.error.set('No se pudo abrir la confirmación.');
      this.restoreFocus();
    };
    try {
      this.arca.actions.cleanActions(['SCHEDULER_DIALOG_CLOSE', APP_DIALOG_OPEN]);
      this.dialogSubscription = this.arca.actions
        .listenAction('SCHEDULER_DIALOG_CLOSE')
        .pipe(
          filter((result: AppDialogResult) => result?.data?.context === context),
          take(1),
        )
        .subscribe((result: AppDialogResult) => {
          if (!this.active || this.dialogContext !== context || this.pending() !== snapshot) return;
          this.dialogContext = undefined;
          if (result.option === 'confirm') this.confirm();
          else this.cancel();
        });
      void this.arca.modals
        .openModal(AppDialog, config, APP_DIALOG_OPEN, 'SCHEDULER_DIALOG_CLOSE')
        .catch(failed);
    } catch {
      failed();
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
    this.dialogSubscription?.unsubscribe();
    if (this.dialogContext) this.arca.actions.dispatchAction(APP_DIALOG_CANCEL, this.dialogContext);
    this.dialogContext = undefined;
  }
  private restoreFocus(): void {
    if (!this.active) return;
    const generation = this.generation;
    const trigger = this.trigger;
    restoreDialogFocus(
      this.injector,
      trigger,
      this.focusFallback,
      () => this.active && generation === this.generation,
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
