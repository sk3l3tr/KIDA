import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  Injector,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { Observable, Subscription, finalize } from 'rxjs';
import { ThemeIdentity } from '../../../theme/integration';
import { classifyCoreFailure, formatCoreFailure } from '../../services/core-failure';
import { restoreDialogFocus, trapDialogFocus } from '../../services/dialog-focus';
import { BackupsService } from './backups.service';
import { BackupJob, PendingBackup, Queued } from './backups.models';
import { createBody, emptyForm, newCommand, newTarget } from './backups-form';
import { BackupHealthState } from './health-state';
import { BackupHealth } from './health';
import { BackupReportsState } from './reports-state';
import { BackupReports } from './reports';
import { limitedPrecision } from './backups-presentation';
export { limitedPrecision } from './backups-presentation';
import { BackupOptionalField } from './optional-field';

export function backupFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar el resultado. No se reenviará automáticamente. Actualizar configuraciones no confirma si el backup fue admitido.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}

@Component({
  selector: 'app-backups',
  imports: [
    IonContent,
    FormsModule,
    DatePipe,
    JsonPipe,
    BackupOptionalField,
    BackupHealth,
    BackupReports,
  ],
  providers: [BackupHealthState, BackupReportsState],
  templateUrl: './backups.html',
  styleUrl: './backups.scss',
})
export class Backups implements OnDestroy {
  private readonly service = inject(BackupsService);
  private readonly identity = inject(ThemeIdentity);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('confirmation');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  readonly health = inject(BackupHealthState);
  readonly reports = inject(BackupReportsState);
  readonly operationsBlocked = computed(
    () => this.loading() || this.busy() || this.health.occupied() || this.reports.occupied(),
  );
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
  readonly limitedPrecision = limitedPrecision;
  readonly newTarget = newTarget;
  readonly newCommand = newCommand;
  readonly phases = ['pre_backup', 'post_backup'] as const;
  form = emptyForm();
  readonly active = signal(false);
  private generation = 0;
  private subscriptions = new Subscription();
  private trigger: Element | null = null;
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.reset());

  ionViewWillEnter(): void {
    this.reset();
    this.active.set(true);
    this.refresh();
    this.health.enter(() => this.loading() || this.busy() || this.reports.occupied());
    this.reports.enter(
      () => this.loading() || this.busy() || this.health.occupied(),
      () => this.health.refreshAfterReportDelete(),
    );
  }
  ionViewWillLeave(): void {
    this.reset();
  }
  ngOnDestroy(): void {
    this.reset(false);
    this.sessionChanges.unsubscribe();
  }
  private reset(render = true): void {
    this.active.set(false);
    this.health.reset();
    this.reports.reset();
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
    // Ionic can detach cached pages before Angular renders a session reset.
    // Clear their DOM as well as signals; destroyed views need no rendering.
    if (render) this.changeDetector.detectChanges();
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
            if (restoreFocus) this.restoreFocus();
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
      this.write(this.service.create(body), 'Crear configuración', body.name, (result) => {
        this.form = emptyForm();
        this.selectedId.set((result as BackupJob).id);
        this.resultLabel.set('Configuración creada');
      });
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Formulario no válido.');
    }
  }
  prepare(action: PendingBackup['action'], job: BackupJob): void {
    if (!this.available()) return;
    this.trigger = this.document.activeElement;
    try {
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) throw new Error();
      this.pending.set(Object.freeze({ action, id: job.id, name: job.name }));
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
    trapDialogFocus(event, this.dialog()?.nativeElement, this.document);
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
    if (!this.active()) return;
    const generation = this.generation;
    restoreDialogFocus(
      this.injector,
      this.trigger,
      () => this.listHeading()?.nativeElement,
      () => this.active() && generation === this.generation,
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
    onSuccess: (result: BackupJob | Queued) => void,
  ): void {
    const generation = this.generation;
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
            if (!succeeded) this.restoreFocus();
          }),
        )
        .subscribe({
          next: (result) => {
            if (!current()) return;
            succeeded = true;
            this.result.set(result);
            onSuccess(result);
            this.load(true);
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
