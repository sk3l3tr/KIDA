import { Injectable, computed, inject, signal } from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { classifyCoreFailure, formatCoreFailure } from '../../services/core-failure';
import { BackupsService } from './backups.service';
import { validString } from './backups-form';
import { CreateHealth, HealthExecution, HealthHistoryRecord, HealthMode } from './health.models';

export function healthFailure(failure: unknown, writing = false): string {
  return formatCoreFailure(failure, writing, {
    uncertain:
      'No se pudo confirmar la creación de Health. No se reenviará automáticamente. Actualizar el historial no resuelve esta incertidumbre.',
    validation: 'Validación HTTP: datos rechazados por el servidor.',
    rejected: 'core',
  });
}
export function healthBody(path: string, mode: HealthMode): CreateHealth {
  if (mode !== 'AUTOMATIC' && mode !== 'MANUAL') throw new Error('Selecciona un modo válido.');
  return { definition_path: validString(path), mode };
}

/** Page-local Health state. The page owns entry, session invalidation and the write lock. */
@Injectable()
export class BackupHealthState {
  private readonly service = inject(BackupsService);
  readonly entries = signal<HealthHistoryRecord[] | null>(null);
  readonly selectedId = signal<string | null>(null);
  readonly selectedHistory = computed(
    () => this.entries()?.find((row) => row.run_id === this.selectedId()) ?? null,
  );
  readonly detail = signal<HealthExecution | null>(null);
  readonly loading = signal(false);
  readonly detailLoading = signal(false);
  readonly writing = signal(false);
  readonly occupied = computed(() => this.loading() || this.detailLoading() || this.writing());
  readonly disabled = computed(() => !this.active() || this.occupied() || this.blocked());
  readonly listError = signal('');
  readonly detailError = signal('');
  readonly error = signal('');
  readonly uncertainties = signal<string[]>([]);
  readonly updated = signal<Date | null>(null);
  readonly detailUpdated = signal<Date | null>(null);
  readonly result = signal<HealthExecution | null>(null);
  definitionPath = '';
  mode: HealthMode = 'MANUAL';
  private readonly active = signal(false);
  private blocked: () => boolean = () => false;
  private generation = 0;
  private subscriptions = new Subscription();

  enter(blocked: () => boolean): void {
    this.blocked = blocked;
    this.active.set(true);
    this.loadHistory();
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
    this.listError.set('');
    this.error.set('');
    this.uncertainties.set([]);
    this.updated.set(null);
    this.result.set(null);
    this.definitionPath = '';
    this.mode = 'MANUAL';
  }
  private clearDetail(): void {
    this.detail.set(null);
    this.detailUpdated.set(null);
    this.detailError.set('');
  }
  refresh(): void {
    if (!this.disabled()) this.loadHistory();
  }
  private loadHistory(): void {
    const generation = this.generation;
    const current = () => this.active() && this.generation === generation;
    this.loading.set(true);
    this.listError.set('');
    this.subscriptions.add(
      this.service
        .healthList()
        .pipe(
          finalize(() => {
            if (current()) this.loading.set(false);
          }),
        )
        .subscribe({
          next: (rows) => {
            if (!current()) return;
            this.entries.set(rows);
            this.updated.set(new Date());
            const id = this.selectedId();
            if (id !== null && rows.some((row) => row.run_id === id)) this.loadDetail(id);
            else {
              this.selectedId.set(null);
              this.clearDetail();
            }
          },
          error: (failure) => {
            if (current()) this.listError.set(healthFailure(failure));
          },
        }),
    );
  }
  select(id: string): void {
    if (this.disabled()) return;
    // A new selection must never display the preceding run's detail.
    if (this.selectedId() !== id) this.clearDetail();
    this.selectedId.set(id);
    this.loadDetail(id);
  }
  private loadDetail(id: string): void {
    const generation = this.generation;
    const current = () =>
      this.active() && this.generation === generation && this.selectedId() === id;
    this.detailLoading.set(true);
    this.detailError.set('');
    this.subscriptions.add(
      this.service
        .healthGet(id)
        .pipe(
          finalize(() => {
            if (current()) this.detailLoading.set(false);
          }),
        )
        .subscribe({
          next: (detail) => {
            if (!current()) return;
            this.detail.set(detail);
            this.detailUpdated.set(new Date());
          },
          error: (failure) => {
            if (current()) this.detailError.set(healthFailure(failure));
          },
        }),
    );
  }
  create(): void {
    if (this.disabled()) return;
    this.error.set('');
    let body: CreateHealth;
    try {
      body = healthBody(this.definitionPath, this.mode);
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Formulario no válido.');
      return;
    }
    const generation = this.generation;
    const current = () => this.active() && this.generation === generation;
    this.writing.set(true);
    this.result.set(null);
    this.subscriptions.add(
      this.service
        .healthCreate(body)
        .pipe(
          finalize(() => {
            if (current()) this.writing.set(false);
          }),
        )
        .subscribe({
          next: (detail) => {
            if (!current()) return;
            this.result.set(detail);
            this.definitionPath = '';
            this.mode = 'MANUAL';
            this.selectedId.set(detail.run_id);
            this.detail.set(detail);
            this.detailUpdated.set(new Date());
            this.detailError.set('');
            this.loadHistory();
          },
          error: (failure) => {
            if (!current()) return;
            const message = healthFailure(failure, true);
            if (classifyCoreFailure(failure, true).kind === 'uncertain')
              this.uncertainties.update((previous) => [
                ...previous,
                `Crear Health: ${body.definition_path} (${body.mode}). ${message}`,
              ]);
            else this.error.set(message);
          },
        }),
    );
  }
}
