import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, finalize } from 'rxjs';
import { classifyCoreFailure, formatCoreFailure } from '../../services/core-failure';
import { BackupsService } from './backups.service';
import { validString } from './backups-form';
import {
  CreateHealth,
  HealthExecution,
  HealthHistoryRecord,
  HealthMode,
  HealthAction,
  HealthQueued,
  PendingHealth,
} from './health.models';

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
  readonly pending = signal<PendingHealth | null>(null);
  readonly result = signal<HealthExecution | HealthQueued | null>(null);
  readonly resultLabel = signal('');
  readonly cleanupResult = signal<HealthExecution | null>(null);
  readonly queuedResult = signal<HealthQueued | null>(null);
  automaticPath = '';
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
    this.cleanupResult.set(null);
    this.queuedResult.set(null);
    this.resultLabel.set('');
    this.pending.set(null);
    this.automaticPath = '';
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
    this.write(
      this.service.healthCreate(body),
      'Crear Health',
      `${body.definition_path} (${body.mode})`,
      (result) => {
        this.cleanupResult.set(result as HealthExecution);
        this.definitionPath = '';
        this.mode = 'MANUAL';
        this.resultLabel.set(
          'Health creado. Crear no inicia la ejecución, tampoco en modo AUTOMATIC.',
        );
        this.selectedId.set(result.run_id);
        this.detail.set(result as HealthExecution);
        this.detailUpdated.set(new Date());
        this.detailError.set('');
      },
    );
  }
  prepare(action: HealthAction): boolean {
    if (this.disabled()) return false;
    this.error.set('');
    const labels = {
      start: 'Iniciar Health',
      run: 'Ejecutar Health automático',
      stop: 'Detener Health',
      delete: 'Eliminar Health',
    };
    try {
      const run = this.detail();
      if (action !== 'run' && (!run || run.run_id !== this.selectedId())) return false;
      const value = validString(action === 'run' ? this.automaticPath : run!.run_id);
      this.pending.set(
        Object.freeze({
          action,
          label: labels[action],
          value,
          target: action === 'run' ? value : `${run!.definition.name} (${value})`,
        }),
      );
      return true;
    } catch (failure) {
      this.error.set(failure instanceof Error ? failure.message : 'Formulario no válido.');
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
    const { action, label, value, target } = pending;
    const request =
      action === 'run'
        ? this.service.healthRun(value)
        : action === 'start'
          ? this.service.healthStart(value)
          : action === 'stop'
            ? this.service.healthStop(value)
            : this.service.healthDelete(value);
    this.write(request, label, target, (result) => {
      if (action === 'start' || action === 'run') {
        this.queuedResult.set(result as HealthQueued);
        this.resultLabel.set(`${label}: solicitud admitida; no confirma inicio ni finalización.`);
        if (action === 'run') this.automaticPath = '';
        this.selectedId.set(result.run_id);
        this.clearDetail();
      } else {
        this.cleanupResult.set(result as HealthExecution);
        this.resultLabel.set(
          `${label}: respuesta de CORE. Revisa cleanup, errores y recursos registrados.`,
        );
        this.selectedId.set(value);
      }
    });
  }
  private write(
    request: Observable<HealthExecution | HealthQueued>,
    action: string,
    target: string,
    onSuccess: (result: HealthExecution | HealthQueued) => void,
  ): void {
    const generation = this.generation;
    const current = () => this.active() && this.generation === generation;
    this.writing.set(true);
    this.error.set('');
    this.result.set(null);
    this.cleanupResult.set(null);
    this.queuedResult.set(null);
    this.resultLabel.set('');
    this.subscriptions.add(
      request
        .pipe(
          finalize(() => {
            if (current()) this.writing.set(false);
          }),
        )
        .subscribe({
          next: (result) => {
            if (!current()) return;
            this.result.set(result);
            onSuccess(result);
            this.loadHistory();
          },
          error: (failure) => {
            if (!current()) return;
            const uncertain = classifyCoreFailure(failure, true).kind === 'uncertain';
            const message =
              action === 'Crear Health' || !uncertain
                ? healthFailure(failure, true)
                : 'No se pudo confirmar el resultado de Health. No se reenviará automáticamente. Actualizar el historial no resuelve esta incertidumbre.';
            if (uncertain)
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
