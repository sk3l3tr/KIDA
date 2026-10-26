import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { classifyCoreFailure, formatCoreFailure } from '../../services/core-failure';
import { BackupsService } from './backups.service';
import { validString } from './backups-form';
import { DeletedHealthReport, HealthReport, PendingReport } from './reports.models';

export function reportFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar la eliminación del informe. No se reenviará automáticamente. Actualizar los informes no resuelve esta incertidumbre.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}

/** Page-local state; the page owns session invalidation and cross-panel coordination. */
@Injectable()
export class BackupReportsState {
  private readonly service = inject(BackupsService);
  readonly entries = signal<string[] | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly detail = signal<HealthReport | null>(null);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly writing = signal(false);
  readonly pending = signal<PendingReport | null>(null);
  readonly occupied = computed(
    () => this.loading() || this.detailLoading() || this.writing() || this.pending() !== null,
  );
  readonly disabled = computed(() => !this.active() || this.occupied() || this.blocked());
  readonly listError = signal('');
  readonly detailError = signal('');
  readonly error = signal('');
  readonly uncertainties = signal<string[]>([]);
  readonly updated = signal<Date | null>(null);
  readonly detailUpdated = signal<Date | null>(null);
  readonly result = signal<DeletedHealthReport | null>(null);
  readonly resultLabel = signal('');
  private readonly active = signal(false);
  private blocked: () => boolean = () => false;
  private onDeleted: () => void = () => {};
  private generation = 0;
  private subscriptions = new Subscription();

  enter(blocked: () => boolean, onDeleted: () => void): void {
    this.blocked = blocked;
    this.onDeleted = onDeleted;
    this.active.set(true);
    this.loadList();
  }
  reset(): void {
    this.active.set(false);
    ++this.generation;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.entries.set(null);
    this.selectedId.set(null);
    this.clearDetail();
    this.loading.set(false);
    this.detailLoading.set(false);
    this.writing.set(false);
    this.pending.set(null);
    this.listError.set('');
    this.error.set('');
    this.uncertainties.set([]);
    this.updated.set(null);
    this.result.set(null);
    this.resultLabel.set('');
  }
  private clearDetail(): void {
    this.detail.set(null);
    this.detailUpdated.set(null);
    this.detailError.set('');
  }
  refresh(): void {
    if (!this.disabled()) this.loadList();
  }
  private loadList(): void {
    const generation = this.generation;
    const current = () => this.active() && generation === this.generation;
    this.loading.set(true);
    this.listError.set('');
    this.subscriptions.add(
      this.service
        .reportList()
        .pipe(
          finalize(() => {
            if (current()) this.loading.set(false);
          }),
        )
        .subscribe({
          next: (ids) => {
            if (!current()) return;
            this.entries.set(ids);
            this.updated.set(new Date());
            const id = this.selectedId();
            if (id !== null && ids.includes(id)) this.loadDetail(id);
            else {
              this.selectedId.set(null);
              this.clearDetail();
            }
          },
          error: (failure) => {
            if (current()) this.listError.set(reportFailure(failure));
          },
        }),
    );
  }
  select(id: string): void {
    if (this.disabled()) return;
    if (this.selectedId() !== id) this.clearDetail();
    this.selectedId.set(id);
    this.loadDetail(id);
  }
  private loadDetail(id: string): void {
    const generation = this.generation;
    const current = () =>
      this.active() && generation === this.generation && this.selectedId() === id;
    this.detailLoading.set(true);
    this.detailError.set('');
    this.subscriptions.add(
      this.service
        .reportGet(id)
        .pipe(
          finalize(() => {
            if (current()) this.detailLoading.set(false);
          }),
        )
        .subscribe({
          next: (report) => {
            if (!current()) return;
            this.detail.set(report);
            this.detailUpdated.set(new Date());
          },
          error: (failure) => {
            if (current()) this.detailError.set(reportFailure(failure));
          },
        }),
    );
  }
  prepare(id: string): boolean {
    if (this.disabled()) return false;
    this.error.set('');
    try {
      this.pending.set(Object.freeze({ run_id: validString(id) }));
      return true;
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Identificador no válido.');
      return false;
    }
  }
  cancel(): void {
    this.pending.set(null);
  }
  confirm(): void {
    const pending = this.pending();
    if (!this.active() || !pending) return;
    this.pending.set(null);
    const generation = this.generation;
    const current = () => this.active() && generation === this.generation;
    this.writing.set(true);
    this.error.set('');
    this.result.set(null);
    this.resultLabel.set('');
    this.subscriptions.add(
      this.service
        .reportDelete(pending.run_id)
        .pipe(
          finalize(() => {
            if (current()) this.writing.set(false);
          }),
        )
        .subscribe({
          next: (result) => {
            if (!current()) return;
            this.result.set(result);
            this.resultLabel.set(
              result.deleted ? 'Informe eliminado' : 'CORE no confirmó la eliminación del informe',
            );
            this.onDeleted();
            this.loadList();
          },
          error: (failure) => {
            if (!current()) return;
            const message = reportFailure(failure, true);
            if (classifyCoreFailure(failure, true).kind === 'uncertain')
              this.uncertainties.update((previous) => [
                ...previous,
                `Eliminar informe: ${pending.run_id}. ${message}`,
              ]);
            else this.error.set(message);
          },
        }),
    );
  }
}
