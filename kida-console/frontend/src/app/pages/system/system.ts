import { Component, Injector, OnDestroy, afterNextRender, inject, signal } from '@angular/core';
import { DOCUMENT, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonContent } from '@ionic/angular/standalone';
import { AlertController } from '@ionic/angular';
import { Observable, Subscription, finalize } from 'rxjs';
import { ThemeIdentity } from '../../../theme/integration';
import { SystemService } from './system.service';
import { SystemData } from './system-data';
import {
  PendingAction,
  PowerAction,
  actionLabels,
  cycleRequest,
  systemFailure,
  validWhen,
} from './system.models';

function section(title: string) {
  return {
    title,
    data: signal<unknown>(null),
    loading: signal(false),
    error: signal(''),
    updated: signal<Date | null>(null),
  };
}
type Section = ReturnType<typeof section>;

@Component({
  selector: 'app-system',
  imports: [IonContent, FormsModule, DatePipe, SystemData],
  templateUrl: './system.html',
  styleUrl: './system.scss',
})
export class System implements OnDestroy {
  private readonly service = inject(SystemService);
  private readonly alerts = inject(AlertController);
  private readonly identity = inject(ThemeIdentity);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  readonly info = section('Equipo');
  readonly health = section('Salud y sensores');
  readonly wake = section('Capacidades RTC');
  readonly sections = [this.info, this.health, this.wake];
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
  private generation = 0;
  private subscriptions = new Subscription();
  private alert?: HTMLIonAlertElement;
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.reset());

  ionViewWillEnter(): void {
    this.reset();
    this.active = true;
    this.refresh(this.info);
    this.refresh(this.health);
    this.refresh(this.wake);
  }
  ionViewWillLeave(): void {
    this.active = false;
    this.reset();
  }
  ngOnDestroy(): void {
    this.ionViewWillLeave();
    this.sessionChanges.unsubscribe();
  }
  private reset(): void {
    ++this.generation;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    void this.alert?.dismiss(undefined, 'cancel');
    this.alert = undefined;
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
  refresh(state: Section): void {
    if (!this.active || state.loading()) return;
    state.loading.set(true);
    state.error.set('');
    const request: Observable<unknown> =
      state === this.info
        ? this.service.info()
        : state === this.health
          ? this.service.health()
          : this.service.wakeCapabilities();
    this.subscriptions.add(
      request.pipe(finalize(() => state.loading.set(false))).subscribe({
        next: (data) => {
          state.data.set(data);
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
    if (!this.active || this.busy()) return;
    let pending: PendingAction;
    if (action === 'powerCycle') {
      const body = this.cycleBody();
      if (!body) return;
      pending = { action, body: Object.freeze(body) };
    } else {
      if (!validWhen(this.when)) return;
      pending = { action, body: Object.freeze({ when: this.when }) };
    }
    Object.freeze(pending);
    const trigger = this.document.activeElement;
    const generation = this.generation;
    const restoreFocus = () =>
      afterNextRender(
        () => {
          if (
            this.active &&
            generation === this.generation &&
            trigger instanceof HTMLElement &&
            trigger.isConnected
          ) {
            trigger.focus({ preventScroll: true });
          }
        },
        { injector: this.injector },
      );
    this.busy.set(true);
    this.error.set('');
    // Only frozen, validated parameters enter the summary, never the live form.
    const summary =
      pending.action === 'powerCycle'
        ? `${'wake_time' in pending.body ? 'Encendido a las ' + pending.body.wake_time : 'Encendido en ' + pending.body.wake_after_seconds + ' segundos'}; apagado: ${pending.body.shutdown_time ?? '+1'}.`
        : `Cuándo: ${pending.body.when}.`;
    try {
      const alert = await this.alerts.create({
        header: `Confirmar: ${actionLabels[action]}`,
        message: `${summary} Horas locales del servidor CORE. La operación puede desconectar el equipo.`,
        cssClass: 'system-confirmation',
        backdropDismiss: false,
        buttons: [
          { text: 'Cancelar', role: 'cancel' },
          { text: 'Confirmar', role: 'confirm' },
        ],
      });
      if (!this.active || generation !== this.generation) {
        alert.remove();
        return;
      }
      this.alert = alert;
      await alert.present();
      alert.querySelector<HTMLButtonElement>('.alert-button-role-cancel')?.focus();
      const { role } = await alert.onDidDismiss();
      if (!this.active || generation !== this.generation) return;
      this.alert = undefined;
      if (role !== 'confirm') {
        this.busy.set(false);
        restoreFocus();
        return;
      }
      this.result.set(null);
      this.resultLabel.set(actionLabels[action]);
      this.subscriptions.add(
        this.service
          .execute(pending)
          .pipe(
            finalize(() => {
              this.busy.set(false);
              restoreFocus();
            }),
          )
          .subscribe({
            next: (result) => this.result.set(result),
            error: (failure) => this.error.set(systemFailure(failure, true)),
          }),
      );
    } catch {
      if (generation === this.generation) {
        this.busy.set(false);
        this.error.set('No se pudo abrir la confirmación.');
      }
    }
  }
}
