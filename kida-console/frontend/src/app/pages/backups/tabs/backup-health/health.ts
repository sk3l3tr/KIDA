import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  Injector,
  OnDestroy,
  effect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { restoreDialogFocus } from '../../../../services/dialog-focus';
import { ArcaService } from 'arca';
import { Subscription, filter, take } from 'rxjs';
import { AppDialog } from '../../../../components/app-dialog/app-dialog';
import {
  APP_DIALOG_CANCEL,
  APP_DIALOG_OPEN,
  AppDialogConfig,
  AppDialogResult,
  newDialogContext,
} from '../../../../components/app-dialog/app-dialog.models';
import { BackupHealthDetail } from '../../components/backup-health-detail/backup-health-detail';
import { BackupHealthState } from '../../services/health-state';
import { HealthAction } from '../../utils/health.models';
import { IonContent } from '@ionic/angular/standalone';
import { BackupsFacade } from '../../services/backups.facade';
import { SidePanel } from '../../../../components/side-panel/side-panel';
import { healthDate, limitedPrecision } from '../../utils/backups-presentation';

@Component({
  selector: 'app-backup-health',
  imports: [
    IonContent,
    DatePipe,
    JsonPipe,
    NgTemplateOutlet,
    FormsModule,
    BackupHealthDetail,
    SidePanel,
  ],
  templateUrl: './health.html',
  styleUrls: ['../../backups.scss', './health.scss'],
})
export class BackupHealth implements OnDestroy {
  readonly state = inject(BackupHealthState);
  readonly backups = inject(BackupsFacade);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private viewRevision = 0;
  private readonly uiClosed = this.backups.uiClosed.subscribe(() => {
    ++this.viewRevision;
    this.restoreRequested.set(false);
    this.closeConfirmation();
    this.changeDetector.detectChanges();
  });
  readonly limitedPrecision = limitedPrecision;
  readonly healthDate = healthDate;
  readonly zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly arca = inject(ArcaService);
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  readonly panelHeading = viewChild<ElementRef<HTMLElement>>('panelHeading');
  readonly panelTitle = computed(() => {
    switch (this.backups.panel()) {
      case 'health-create':
        return 'Crear Health';
      case 'health-run':
        return 'Ejecutar Health automático';
      default:
        return 'Detalle de Backup Health';
    }
  });
  readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  private readonly restoreRequested = signal(false);
  private trigger: Element | null = null;

  constructor() {
    effect(() => {
      const state = this.state;
      if (!state.pending()) this.closeConfirmation();
      if (!this.restoreRequested() || state.disabled()) return;
      this.restoreRequested.set(false);
      const viewRevision = this.viewRevision;
      restoreDialogFocus(
        this.injector,
        this.trigger,
        () => this.panelHeading()?.nativeElement ?? this.listHeading()?.nativeElement,
        () =>
          viewRevision === this.viewRevision &&
          !state.disabled() &&
          !!this.listHeading()?.nativeElement.isConnected,
      );
    });
  }
  ionViewWillEnter(): void {
    this.backups.ionViewWillEnter();
    this.changeDetector.detectChanges();
  }
  ionViewWillLeave(): void {
    this.backups.leaveTab();
  }
  ngOnDestroy(): void {
    ++this.viewRevision;
    this.uiClosed.unsubscribe();
    this.restoreRequested.set(false);
    this.closeConfirmation();
  }
  prepare(action: HealthAction): void {
    const state = this.state;
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
    if (!this.state.pending()) return;
    this.closeConfirmation();
    this.state.cancel();
    this.restoreRequested.set(true);
  }
  confirm(): void {
    if (!this.state.pending()) return;
    this.closeConfirmation();
    this.restoreRequested.set(true);
    const automaticForm =
      this.state.pending()?.action === 'run' && this.backups.panel() === 'health-run';
    this.state.confirm(() => {
      if (automaticForm && this.backups.panel() === 'health-run') this.backups.closeHealthPanel();
    });
  }
  private closeConfirmation(): void {
    this.dialogSubscription?.unsubscribe();
    if (this.dialogContext) this.arca.actions.dispatchAction(APP_DIALOG_CANCEL, this.dialogContext);
    this.dialogContext = undefined;
  }
  create(): void {
    const state = this.state;
    if (state.disabled()) return;
    this.trigger = this.document.activeElement;
    this.restoreRequested.set(true);
    state.create(() => {
      if (this.backups.panel() === 'health-create') this.backups.closeHealthPanel();
    });
  }
}
