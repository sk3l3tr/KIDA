import {
  Component,
  ElementRef,
  Injector,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { restoreDialogFocus } from '../../services/dialog-focus';
import { ArcaService } from 'arca';
import { Subscription, filter, take } from 'rxjs';
import { AppDialog } from '../../components/app-dialog/app-dialog';
import {
  APP_DIALOG_CANCEL,
  APP_DIALOG_OPEN,
  AppDialogConfig,
  AppDialogResult,
  newDialogContext,
} from '../../components/app-dialog/app-dialog.models';
import { BackupHealthState } from './health-state';
import { HealthAction } from './health.models';
import { limitedPrecision } from './backups-presentation';

@Component({
  selector: 'app-backup-health',
  imports: [DatePipe, JsonPipe, FormsModule],
  templateUrl: './health.html',
  styleUrl: './backups.scss',
})
export class BackupHealth implements OnDestroy {
  readonly state = input.required<BackupHealthState>();
  readonly limitedPrecision = limitedPrecision;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly arca = inject(ArcaService);
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  private readonly createButton = viewChild<ElementRef<HTMLButtonElement>>('createButton');
  private readonly restoreRequested = signal(false);
  private trigger: Element | null = null;

  constructor() {
    effect(() => {
      const state = this.state();
      if (!state.pending()) this.closeConfirmation();
      if (!this.restoreRequested() || state.disabled()) return;
      this.restoreRequested.set(false);
      restoreDialogFocus(
        this.injector,
        this.trigger,
        () => this.createButton()?.nativeElement,
        () => !state.disabled() && !!this.createButton()?.nativeElement.isConnected,
      );
    });
  }
  ngOnDestroy(): void {
    this.restoreRequested.set(false);
    this.closeConfirmation();
  }
  prepare(action: HealthAction): void {
    const state = this.state();
    if (state.disabled() || this.arca.modals.modalOpen) return;
    this.trigger = this.document.activeElement;
    if (!state.prepare(action)) return;
    const pending = state.pending()!;
    const context = newDialogContext();
    this.dialogContext = context;
    const config: AppDialogConfig = {
      context,
      title: 'Confirmar operación de Health',
      type: action === 'delete' ? 'danger' : 'confirmation',
      text: [
        `Acción: ${pending.label}`,
        `${action === 'run' ? 'Ruta exacta en CORE' : 'Nombre y run_id'}: ${pending.target}`,
        action === 'start' || action === 'run'
          ? 'La admisión no confirma inicio ni finalización. run_id y execution_id son distintos.'
          : 'CORE decide la limpieza. Revisa cleanup, errores y recursos en la respuesta.',
      ],
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        { id: 'confirm', text: 'Confirmar', style: action === 'delete' ? 'danger' : undefined },
      ],
    };
    const failed = () => {
      if (this.dialogContext !== context) return;
      this.closeConfirmation();
      state.cancel();
      state.error.set('No se pudo abrir la confirmación.');
      this.restoreRequested.set(true);
    };
    try {
      this.arca.actions.cleanActions(['HEALTH_DIALOG_CLOSE', APP_DIALOG_OPEN]);
      this.dialogSubscription = this.arca.actions
        .listenAction('HEALTH_DIALOG_CLOSE')
        .pipe(
          filter((result: AppDialogResult) => result?.data?.context === context),
          take(1),
        )
        .subscribe((result: AppDialogResult) => {
          if (this.dialogContext !== context || state.pending() !== pending) return;
          this.dialogContext = undefined;
          if (result.option === 'confirm') this.confirm();
          else this.cancel();
        });
      void this.arca.modals
        .openModal(AppDialog, config, APP_DIALOG_OPEN, 'HEALTH_DIALOG_CLOSE')
        .catch(failed);
    } catch {
      failed();
    }
  }
  cancel(): void {
    if (!this.state().pending()) return;
    this.closeConfirmation();
    this.state().cancel();
    this.restoreRequested.set(true);
  }
  confirm(): void {
    if (!this.state().pending()) return;
    this.closeConfirmation();
    this.restoreRequested.set(true);
    this.state().confirm();
  }
  private closeConfirmation(): void {
    this.dialogSubscription?.unsubscribe();
    if (this.dialogContext) this.arca.actions.dispatchAction(APP_DIALOG_CANCEL, this.dialogContext);
    this.dialogContext = undefined;
  }
  create(): void {
    const state = this.state();
    if (state.disabled()) return;
    this.trigger = this.document.activeElement;
    this.restoreRequested.set(true);
    state.create();
  }
}
