import { Injectable, Injector, OnDestroy, computed, inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ArcaService } from 'arca';
import { Observable, Subscription, filter, finalize, take } from 'rxjs';
import { ThemeIdentity } from '../../../../theme/integration';
import { SystemService } from './system.service';
import { AppDialog } from '../../../components/app-dialog/app-dialog';
import {
  APP_DIALOG_CANCEL,
  APP_DIALOG_OPEN,
  AppDialogConfig,
  AppDialogResult,
  newDialogContext,
} from '../../../components/app-dialog/app-dialog.models';
import { restoreDialogFocus } from '../../../services/dialog-focus';
import {
  fields,
  sensorGroups,
  sensorReadings,
} from '../components/system-sensor-card/system-sensors';
import {
  PendingAction,
  PowerAction,
  SystemHealth,
  WakeCapabilities,
  cycleRequest,
  systemFailure,
  validWhen,
  actionLabels,
} from '../utils/system.models';

function section<T>(title: string) {
  return {
    title,
    data: signal<T | null>(null),
    loading: signal(false),
    error: signal(''),
    updated: signal<Date | null>(null),
  };
}
export type SystemSection<T> = ReturnType<typeof section<T>>;

@Injectable()
export class SystemFacade implements OnDestroy {
  private readonly service = inject(SystemService);
  private readonly arca = inject(ArcaService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly identity = inject(ThemeIdentity);

  readonly health = section<SystemHealth>('Salud y sensores');
  readonly wake = section<WakeCapabilities>('Capacidades RTC');
  readonly sections = [this.health, this.wake];
  readonly sensorsAvailable = computed(() => Array.isArray(fields(this.health.data())['sensors']));
  readonly sensors = computed(() => sensorReadings(this.health.data()));
  readonly groups = computed(() => sensorGroups(this.sensors()));
  readonly busy = signal(false);
  readonly validWhen = validWhen;

  when = '+1';
  wakeMode = 'time';
  wakeTime = '';
  wakeSeconds = '120';
  shutdownTime = '';

  private active = false;
  private energyActive = false;
  private confirming = false;
  private confirmationRevision = 0;
  private subscriptions = new Subscription();
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.ionViewWillLeave());

  ionViewWillEnter(): void {
    if (this.active) return;
    this.reset();
    this.active = true;
    this.refreshHealth();
    this.refreshWake();
  }
  ionViewWillLeave(): void {
    this.active = false;
    this.reset();
  }
  ngOnDestroy(): void {
    this.ionViewWillLeave();
    this.sessionChanges.unsubscribe();
  }
  enterEnergy(): void {
    this.energyActive = true;
  }
  leaveEnergy(): void {
    this.energyActive = false;
    ++this.confirmationRevision;
    this.dialogSubscription?.unsubscribe();
    if (this.dialogContext) this.arca.actions.dispatchAction(APP_DIALOG_CANCEL, this.dialogContext);
    this.dialogContext = undefined;
    // Invalidation owns the pending confirmation's lock; stale continuations must not
    // clear it later, as a new confirmation may already be using it.
    if (this.confirming) this.busy.set(false);
    this.confirming = false;
  }
  private reset(): void {
    this.leaveEnergy();
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.busy.set(false);
    this.when = '+1';
    this.wakeMode = 'time';
    this.wakeTime = '';
    this.wakeSeconds = '120';
    this.shutdownTime = '';
    for (const state of this.sections) {
      state.data.set(null);
      state.loading.set(false);
      state.error.set('');
      state.updated.set(null);
    }
  }
  refreshHealth(): void {
    this.load(this.health, this.service.health());
  }

  refreshWake(): void {
    this.load(this.wake, this.service.wakeCapabilities());
  }

  private load<T>(state: SystemSection<T>, request: Observable<T>): void {
    if (!this.active || state.loading()) return;
    state.loading.set(true);
    state.error.set('');
    this.subscriptions.add(
      request.pipe(finalize(() => state.loading.set(false))).subscribe({
        next: (data) => {
          state.data.set(data ?? null);
          state.updated.set(new Date());
        },
        error: (failure) => state.error.set(systemFailure(failure)),
      }),
    );
  }
  cycleBody() {
    return cycleRequest(this.wakeMode, this.wakeTime, this.wakeSeconds, this.shutdownTime);
  }

  confirm(action: PowerAction): void {
    if (!this.active || !this.energyActive || this.busy() || this.arca.modals.modalOpen) return;
    const pending = this.buildAction(action);
    if (!pending) return;
    const context = newDialogContext();
    const revision = this.confirmationRevision;
    const trigger = this.document.activeElement;
    const current = () =>
      this.active && this.energyActive && revision === this.confirmationRevision;
    const restoreFocus = () => restoreDialogFocus(this.injector, trigger, () => undefined, current);
    const text =
      pending.action === 'powerCycle'
        ? [
            'wake_time' in pending.body
              ? `Encendido a las ${pending.body.wake_time}`
              : `Encendido en ${pending.body.wake_after_seconds} segundos`,
            `Apagado: ${pending.body.shutdown_time ?? '+1'}.`,
          ]
        : [`Cuándo: ${pending.body.when}.`];
    const config: AppDialogConfig = {
      context,
      title: `Confirmar: ${actionLabels[action]}`,
      text: [...text, 'Horas locales del servidor. La operación puede desconectar el equipo.'],
      type: 'danger',
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        { id: 'confirm', text: 'Confirmar', style: 'danger' },
      ],
    };
    this.confirming = true;
    this.busy.set(true);
    this.dialogContext = context;
    const failed = () => {
      if (!current() || this.dialogContext !== context) return;
      this.dialogSubscription?.unsubscribe();
      this.dialogContext = undefined;
      this.confirming = false;
      this.busy.set(false);
      restoreFocus();
    };
    try {
      this.arca.actions.cleanActions(['SYSTEM_DIALOG_CLOSE', APP_DIALOG_OPEN]);
      this.dialogSubscription = this.arca.actions
        .listenAction('SYSTEM_DIALOG_CLOSE')
        .pipe(
          filter((result: AppDialogResult) => result?.data?.context === context),
          take(1),
        )
        .subscribe((result: AppDialogResult) => {
          if (!current() || this.dialogContext !== context) return;
          this.dialogContext = undefined;
          this.confirming = false;
          if (result.option !== 'confirm') {
            this.busy.set(false);
            restoreFocus();
            return;
          }
          try {
            this.subscriptions.add(
              this.service
                .execute(pending)
                .pipe(
                  finalize(() => {
                    this.busy.set(false);
                    restoreFocus();
                  }),
                )
                .subscribe({ error: () => {} }),
            );
          } catch {
            this.busy.set(false);
            restoreFocus();
          }
        });
      void this.arca.modals
        .openModal(AppDialog, config, APP_DIALOG_OPEN, 'SYSTEM_DIALOG_CLOSE')
        .catch(failed);
    } catch {
      failed();
    }
  }

  private buildAction(action: PowerAction): PendingAction | null {
    let pending: PendingAction;
    if (action === 'powerCycle') {
      const body = this.cycleBody();
      if (!body) return null;
      pending = { action, body: Object.freeze(body) };
    } else {
      if (!validWhen(this.when)) return null;
      pending = { action, body: Object.freeze({ when: this.when }) };
    }
    return Object.freeze(pending);
  }
}
