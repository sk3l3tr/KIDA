import {
  Component,
  ChangeDetectorRef,
  ElementRef,
  Injector,
  OnDestroy,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT, DatePipe, JsonPipe } from '@angular/common';
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
import { BackupReportsState } from '../../services/reports-state';
import { IonContent } from '@ionic/angular/standalone';
import { BackupsFacade } from '../../services/backups.facade';
import { limitedPrecision } from '../../utils/backups-presentation';

@Component({
  selector: 'app-backup-reports',
  imports: [IonContent, DatePipe, JsonPipe],
  templateUrl: './reports.html',
  styleUrl: '../../backups.scss',
})
export class BackupReports implements OnDestroy {
  readonly state = inject(BackupReportsState);
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
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly arca = inject(ArcaService);
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
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
        () => this.listHeading()?.nativeElement,
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
  prepare(id: string): void {
    const state = this.state;
    if (state.disabled() || this.arca.modals.modalOpen) return;
    this.trigger = this.document.activeElement;
    if (!state.prepare(id)) return;
    const pending = state.pending()!;
    const context = newDialogContext();
    this.dialogContext = context;
    const config: AppDialogConfig = {
      context,
      title: 'Confirmar eliminación de informe',
      type: 'danger',
      text: [
        'Acción: Eliminar informe',
        `run_id: ${pending.run_id}`,
        'Esta operación solicita a CORE eliminar el informe de Health.',
      ],
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        { id: 'confirm', text: 'Confirmar', style: 'danger' },
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
      this.arca.actions.cleanActions(['REPORT_DIALOG_CLOSE', APP_DIALOG_OPEN]);
      this.dialogSubscription = this.arca.actions
        .listenAction('REPORT_DIALOG_CLOSE')
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
        .openModal(AppDialog, config, APP_DIALOG_OPEN, 'REPORT_DIALOG_CLOSE')
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
    this.state.confirm();
  }
  private closeConfirmation(): void {
    this.dialogSubscription?.unsubscribe();
    if (this.dialogContext) this.arca.actions.dispatchAction(APP_DIALOG_CANCEL, this.dialogContext);
    this.dialogContext = undefined;
  }
}
