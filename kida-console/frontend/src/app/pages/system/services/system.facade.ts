import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Observable, Subscription, finalize } from 'rxjs';
import { ThemeIdentity } from '../../../../theme/integration';
import { SystemService } from './system.service';
import { SystemConfirmation, SystemConfirmationService } from './system-confirmation.service';
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
  actionLabels,
  cycleRequest,
  systemFailure,
  validWhen,
} from '../utils/system.models';

interface ConfirmationContext {
  readonly confirmationRevision: number;
}

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
  private readonly confirmations = inject(SystemConfirmationService);
  private readonly identity = inject(ThemeIdentity);

  readonly health = section<SystemHealth>('Salud y sensores');
  readonly wake = section<WakeCapabilities>('Capacidades RTC');
  readonly sections = [this.health, this.wake];
  readonly sensorsAvailable = computed(() => Array.isArray(fields(this.health.data())['sensors']));
  readonly sensors = computed(() => sensorReadings(this.health.data()));
  readonly groups = computed(() => sensorGroups(this.sensors()));
  readonly busy = signal(false);
  readonly error = signal('');
  readonly result = signal<unknown>(null);
  readonly resultLabel = signal('');
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
  private confirmation?: SystemConfirmation;
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
    this.confirmation?.cancel();
    this.confirmation = undefined;
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
    this.error.set('');
    this.result.set(null);
    this.resultLabel.set('');
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

  async confirm(action: PowerAction): Promise<void> {
    if (!this.canConfirm()) return;
    const pending = this.buildAction(action);
    if (!pending) return;

    const context: ConfirmationContext = {
      confirmationRevision: this.confirmationRevision,
    };
    let confirmation: SystemConfirmation;
    try {
      confirmation = this.confirmations.prepare(pending, () => this.canExecute(context));
    } catch {
      this.confirmationFailed(context);
      return;
    }
    const confirmed = await this.askConfirmation(confirmation, context);
    if (!confirmed || !this.canExecute(context)) return;

    this.execute(pending, context, confirmation);
  }

  private canConfirm(): boolean {
    return this.active && this.energyActive && !this.busy();
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

  private isCurrentConfirmation(context: ConfirmationContext): boolean {
    return context.confirmationRevision === this.confirmationRevision;
  }

  private canExecute(context: ConfirmationContext): boolean {
    return this.active && this.energyActive && this.isCurrentConfirmation(context);
  }

  private async askConfirmation(
    confirmation: SystemConfirmation,
    context: ConfirmationContext,
  ): Promise<boolean> {
    // leaveEnergy() (also called by reset()) releases this lock on invalidation.
    // Stale continuations must not change state owned by a newer confirmation.
    this.confirmation?.cancel();
    this.confirmation = confirmation;
    this.confirming = true;
    this.busy.set(true);
    this.error.set('');
    try {
      const confirmed = await confirmation.present();
      if (!this.canExecute(context)) return false;
      // Retain the session so leaving Energy can cancel deferred focus too.
      if (!confirmed) {
        this.confirming = false;
        this.busy.set(false);
        confirmation.restoreFocus();
        return false;
      }
      // Keep the lock until execute() takes over, including the intervening microtask.
      return true;
    } catch {
      this.confirmationFailed(context);
      return false;
    }
  }

  private execute(
    pending: PendingAction,
    context: ConfirmationContext,
    confirmation: SystemConfirmation,
  ): void {
    this.confirming = false;
    try {
      this.result.set(null);
      this.resultLabel.set(actionLabels[pending.action]);
      this.subscriptions.add(
        this.service
          .execute(pending)
          .pipe(
            finalize(() => {
              this.busy.set(false);
              confirmation.restoreFocus();
            }),
          )
          .subscribe({
            next: (result) => this.result.set(result),
            error: (failure) => this.error.set(systemFailure(failure, true)),
          }),
      );
    } catch (failure) {
      if (!this.isCurrentConfirmation(context)) return;
      this.busy.set(false);
      this.error.set(systemFailure(failure, true));
      confirmation.restoreFocus();
    }
  }

  private confirmationFailed(context: ConfirmationContext): void {
    if (!this.isCurrentConfirmation(context)) return;
    this.confirming = false;
    this.busy.set(false);
    this.confirmation?.cancel();
    this.confirmation = undefined;
    this.error.set('No se pudo abrir la confirmación.');
  }
}
