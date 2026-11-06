import { Injectable, Injector, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Observable, Subscription, filter, finalize, take } from 'rxjs';
import { ArcaService } from 'arca';
import { classifyCoreFailure } from '../../../services/core-failure';
import { restoreDialogFocus } from '../../../services/dialog-focus';
import { AppDialog } from '../../../components/app-dialog/app-dialog';
import {
  APP_DIALOG_CANCEL,
  APP_DIALOG_OPEN,
  AppDialogConfig,
  AppDialogResult,
  newDialogContext,
} from '../../../components/app-dialog/app-dialog.models';
import { BackupsService } from './backups.service';
import { BackupJob, PendingBackup, Queued } from '../utils/backups.models';
import { createBody, emptyForm } from '../utils/backups-form';
import { backupFailure } from '../utils/backups-presentation';

@Injectable()
export class BackupConfigurationsState {
  private readonly service = inject(BackupsService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly arca = inject(ArcaService);
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  focusFallback: () => HTMLElement | undefined = () => undefined;
  readonly occupied = computed(() => this.loading() || this.busy());
  readonly operationsBlocked = computed(() => this.occupied() || this.blocked());
  private blocked: () => boolean = () => false;
  readonly entries = signal<BackupJob[] | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(
    () => this.entries()?.find((job) => job.id === this.selectedId()) ?? null,
  );
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly listError = signal('');
  readonly error = signal('');
  readonly uncertainties = signal<string[]>([]);
  readonly updated = signal<Date | null>(null);
  readonly pending = signal<PendingBackup | null>(null);
  readonly result = signal<BackupJob | Queued | null>(null);
  readonly resultLabel = signal('');
  form = emptyForm();
  readonly active = signal(false);
  private generation = 0;
  private viewRevision = 0;
  private subscriptions = new Subscription();
  private trigger: Element | null = null;
  enter(blocked: () => boolean): void {
    this.blocked = blocked;
    this.active.set(true);
    this.refresh();
  }
  reset(): void {
    this.active.set(false);
    ++this.generation;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.closeConfirmation();
    this.entries.set(null);
    this.selectedId.set(null);
    this.loading.set(false);
    this.busy.set(false);
    this.listError.set('');
    this.error.set('');
    this.uncertainties.set([]);
    this.updated.set(null);
    this.result.set(null);
    this.resultLabel.set('');
    this.form = emptyForm();
    this.trigger = null;
  }
  leaveTab(): void {
    ++this.viewRevision;
    if (this.pending()) this.busy.set(false);
    this.closeConfirmation();
    this.selectedId.set(null);
    this.trigger = null;
  }
  private available(): boolean {
    return this.active() && !this.operationsBlocked();
  }
  select(id: string): void {
    if (this.available()) this.selectedId.set(id);
  }
  refresh(): void {
    if (this.available()) this.load();
  }
  private load(restoreFocus = false): void {
    if (!this.active() || this.loading()) return;
    const generation = this.generation;
    const viewRevision = this.viewRevision;
    const current = () => this.active() && generation === this.generation;
    this.loading.set(true);
    this.listError.set('');
    this.subscriptions.add(
      this.service
        .list()
        .pipe(
          finalize(() => {
            if (!current()) return;
            this.loading.set(false);
            if (restoreFocus && viewRevision === this.viewRevision) this.restoreFocus();
          }),
        )
        .subscribe({
          next: (data) => {
            if (!current()) return;
            this.entries.set(data.backups);
            this.updated.set(new Date());
            if (!data.backups.some((job) => job.id === this.selectedId()))
              this.selectedId.set(null);
          },
          error: (failure) => {
            if (current()) this.listError.set(backupFailure(failure));
          },
        }),
    );
  }
  create(): void {
    if (!this.available()) return;
    this.trigger = this.document.activeElement;
    this.error.set('');
    try {
      const body = createBody(this.form);
      this.write(
        this.service.create(body),
        'Crear configuración',
        body.name,
        (result, currentView) => {
          this.form = emptyForm();
          if (currentView) this.selectedId.set((result as BackupJob).id);
          this.resultLabel.set('Configuración creada');
        },
      );
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Formulario no válido.');
    }
  }
  prepare(action: PendingBackup['action'], job: BackupJob): void {
    if (!this.available() || this.arca.modals.modalOpen) return;
    this.trigger = this.document.activeElement;
    const snapshot = Object.freeze({ action, id: job.id, name: job.name });
    this.pending.set(snapshot);
    this.busy.set(true);
    this.error.set('');
    const context = newDialogContext();
    this.dialogContext = context;
    const config: AppDialogConfig = {
      context,
      title: 'Confirmar operación de backup',
      type: action === 'delete' ? 'danger' : 'confirmation',
      text: [
        `Acción: ${action === 'delete' ? 'Eliminar configuración' : 'Solicitar backup'}`,
        `Nombre: ${snapshot.name}`,
        `ID: ${snapshot.id}`,
        action === 'delete'
          ? 'Eliminar la configuración no elimina sus archivos de backup.'
          : 'La admisión en cola no confirma el inicio ni la finalización del backup.',
      ],
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        { id: 'confirm', text: 'Confirmar', style: action === 'delete' ? 'danger' : undefined },
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
      this.arca.actions.cleanActions(['BACKUP_DIALOG_CLOSE', APP_DIALOG_OPEN]);
      this.dialogSubscription = this.arca.actions
        .listenAction('BACKUP_DIALOG_CLOSE')
        .pipe(
          filter((result: AppDialogResult) => result?.data?.context === context),
          take(1),
        )
        .subscribe((result: AppDialogResult) => {
          if (!this.active() || this.dialogContext !== context || this.pending() !== snapshot)
            return;
          this.dialogContext = undefined;
          if (result.option === 'confirm') this.confirm();
          else this.cancel();
        });
      void this.arca.modals
        .openModal(AppDialog, config, APP_DIALOG_OPEN, 'BACKUP_DIALOG_CLOSE')
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
    if (!this.active()) return;
    const generation = this.generation;
    const viewRevision = this.viewRevision;
    restoreDialogFocus(
      this.injector,
      this.trigger,
      this.focusFallback,
      () => this.active() && generation === this.generation && viewRevision === this.viewRevision,
    );
  }
  confirm(): void {
    const pending = this.pending();
    if (!this.active() || !pending) return;
    this.closeConfirmation();
    const deleting = pending.action === 'delete';
    this.write(
      deleting ? this.service.delete(pending.id) : this.service.run(pending.id),
      deleting ? 'Eliminar configuración' : 'Solicitar backup',
      `${pending.name} (${pending.id})`,
      (result) => {
        this.resultLabel.set(
          deleting
            ? 'Configuración eliminada; sus archivos se conservan'
            : (result as Queued).state === 'QUEUED'
              ? 'Solicitud admitida en cola; no confirma inicio ni finalización'
              : `Respuesta de CORE: ${(result as Queued).state}`,
        );
      },
    );
  }
  private write(
    request: Observable<BackupJob | Queued>,
    action: string,
    target: string,
    onSuccess: (result: BackupJob | Queued, currentView: boolean) => void,
  ): void {
    const generation = this.generation;
    const viewRevision = this.viewRevision;
    const current = () => this.active() && generation === this.generation;
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    this.resultLabel.set('');
    let succeeded = false;
    this.subscriptions.add(
      request
        .pipe(
          finalize(() => {
            if (!current()) return;
            this.busy.set(false);
            if (!succeeded && viewRevision === this.viewRevision) this.restoreFocus();
          }),
        )
        .subscribe({
          next: (result) => {
            if (!current()) return;
            succeeded = true;
            this.result.set(result);
            onSuccess(result, viewRevision === this.viewRevision);
            this.load(viewRevision === this.viewRevision);
          },
          error: (failure) => {
            if (!current()) return;
            const message = backupFailure(failure, true);
            if (classifyCoreFailure(failure, true).kind === 'uncertain')
              this.uncertainties.update((previous) => [
                ...previous,
                `${action}: ${target}. ${message}`,
              ]);
            else this.error.set(message);
          },
        }),
    );
  }
}
