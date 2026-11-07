import { Injectable, Injector, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { ArcaService } from 'arca';
import { AppDialog } from '../../../components/app-dialog/app-dialog';
import {
  APP_DIALOG_CANCEL,
  APP_DIALOG_OPEN,
  AppDialogConfig,
  AppDialogResult,
  newDialogContext,
} from '../../../components/app-dialog/app-dialog.models';
import { Observable, Subscription, filter, finalize, take } from 'rxjs';
import { Account, AuthService } from '../../../auth/auth.service';
import { errorMessage } from '../../../utils/messages';
import { restoreDialogFocus } from '../../../services/dialog-focus';

export type AdministratorPanel = 'create' | 'rename' | 'password';

@Injectable()
export class AdministratorsFacade implements OnDestroy {
  readonly auth = inject(AuthService);
  private readonly arca = inject(ArcaService);
  private readonly injector = inject(Injector);
  focusFallback: () => HTMLElement | undefined = () => undefined;
  private generation = 0;
  private dialogContext?: string;
  private dialogSubscription?: Subscription;
  readonly accounts = signal<Account[]>([]);
  readonly pendingDelete = signal<Account | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly panel = signal<AdministratorPanel | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly listError = signal('');
  readonly formError = signal('');

  ownUsername = this.auth.user()?.username ?? '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
  createUsername = '';
  createPassword = '';
  adminUsername = '';
  adminPassword = '';

  private active = false;
  private userId = this.auth.user()?.id;
  private subscriptions = new Subscription();

  constructor() {
    effect(() => {
      const userId = this.auth.user()?.id;
      if (userId === this.userId) return;
      this.userId = userId;
      untracked(() => {
        this.reset();
        if (this.active && userId !== undefined) this.load();
      });
    });
  }

  ionViewWillEnter(): void {
    this.reset();
    this.active = true;
    this.userId = this.auth.user()?.id;
    if (this.auth.user()) this.load();
  }

  ionViewWillLeave(): void {
    this.active = false;
    this.reset();
  }

  ngOnDestroy(): void {
    this.ionViewWillLeave();
  }

  private reset(): void {
    this.dialogSubscription?.unsubscribe();
    if (this.dialogContext) this.arca.actions.dispatchAction(APP_DIALOG_CANCEL, this.dialogContext);
    this.dialogContext = undefined;
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.generation++;
    this.closePanel();
    this.accounts.set([]);
    this.pendingDelete.set(null);
    this.busy.set(false);
    this.loading.set(false);
    this.loaded.set(false);
    this.listError.set('');
    this.error.set('');
    this.message.set('');
  }

  openPanel(panel: AdministratorPanel): void {
    if (
      !this.active ||
      !this.auth.user() ||
      this.busy() ||
      this.loading() ||
      this.pendingDelete() ||
      this.arca.modals.modalOpen
    )
      return;
    this.closePanel();
    this.adminUsername = this.auth.user()?.username ?? '';
    this.panel.set(panel);
  }

  closePanel(): void {
    this.panel.set(null);
    this.ownUsername = this.auth.user()?.username ?? '';
    this.createUsername = '';
    this.adminUsername = '';
    this.clearPasswords();
    this.formError.set('');
  }

  private clearPasswords(): void {
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.createPassword = '';
    this.adminPassword = '';
  }

  retryLoad(): void {
    if (this.busy() || this.pendingDelete() || this.panel()) return;
    this.load();
  }

  private load(focusAfter = false): void {
    if (!this.active || !this.auth.user() || this.loading()) return;
    this.loading.set(true);
    this.listError.set('');
    const generation = this.generation;
    this.subscriptions.add(
      this.auth
        .accounts()
        .pipe(
          finalize(() => {
            this.loading.set(false);
            if (focusAfter)
              restoreDialogFocus(
                this.injector,
                null,
                this.focusFallback,
                () => this.active && generation === this.generation,
              );
          }),
        )
        .subscribe({
          next: (accounts) => {
            this.accounts.set(accounts);
            this.loaded.set(true);
          },
          error: (error) => this.listError.set(errorMessage(error)),
        }),
    );
  }

  private run<T>(operation: () => Observable<T>, success: () => void): void {
    if (!this.active || this.busy() || this.pendingDelete()) return;
    this.busy.set(true);
    this.error.set('');
    this.formError.set('');
    this.message.set('');
    this.subscriptions.add(
      operation()
        .pipe(
          finalize(() => {
            this.busy.set(false);
            this.clearPasswords();
          }),
        )
        .subscribe({
          next: success,
          error: (error) => {
            if (this.panel()) this.formError.set(errorMessage(error));
            else this.error.set(errorMessage(error));
          },
        }),
    );
  }

  rename(): void {
    this.run(
      () => this.auth.rename(this.ownUsername),
      () => {
        this.closePanel();
        this.message.set('Nombre de usuario actualizado.');
        this.load();
      },
    );
  }

  changePassword(): void {
    if (this.newPassword !== this.confirmPassword) return;
    this.run(
      () => this.auth.password(this.currentPassword, this.newPassword),
      () => {},
    );
  }

  create(): void {
    this.run(
      () =>
        this.auth.create({
          username: this.createUsername,
          password: this.createPassword,
          admin_username: this.adminUsername,
          admin_password: this.adminPassword,
        }),
      () => {
        this.closePanel();
        this.message.set('Administrador creado.');
        this.load();
      },
    );
  }
  prepareDelete(account: Account): void {
    if (
      !this.active ||
      this.busy() ||
      this.loading() ||
      this.panel() !== null ||
      this.pendingDelete() ||
      this.accounts().length <= 1 ||
      this.arca.modals.modalOpen
    )
      return;
    const current = this.accounts().find((entry) => entry.id === account.id);
    if (!current) return;
    const target = Object.freeze({ ...current });
    const context = newDialogContext();
    this.dialogContext = context;
    this.pendingDelete.set(target);
    const config: AppDialogConfig = {
      context,
      title: 'Confirmar eliminación de cuenta',
      type: 'danger',
      text: [
        `¿Eliminar la cuenta ${target.username}? Se cerrarán todas sus sesiones.`,
        ...(target.id === this.auth.user()?.id ? ['Tu sesión también se cerrará.'] : []),
      ],
      buttons: [
        { id: 'cancel', text: 'Cancelar', style: 'secondary' },
        { id: 'confirm', text: 'Confirmar eliminación', icon: 'trash', style: 'danger' },
      ],
    };
    const failed = () => {
      if (this.dialogContext !== context) return;
      this.dialogSubscription?.unsubscribe();
      this.pendingDelete.set(null);
      this.dialogContext = undefined;
      this.error.set('No se pudo abrir la confirmación.');
    };
    try {
      this.arca.actions.cleanActions(['ACCOUNT_DIALOG_CLOSE', APP_DIALOG_OPEN]);
      this.dialogSubscription = this.arca.actions
        .listenAction('ACCOUNT_DIALOG_CLOSE')
        .pipe(
          filter((result: AppDialogResult) => result?.data?.context === context),
          take(1),
        )
        .subscribe((result: AppDialogResult) => {
          if (!this.active || this.dialogContext !== context || this.pendingDelete() !== target)
            return;
          this.dialogContext = undefined;
          this.pendingDelete.set(null);
          if (
            result.option === 'confirm' &&
            this.accounts().length > 1 &&
            this.accounts().some((entry) => entry.id === target.id)
          )
            this.remove(target);
        });
      void this.arca.modals
        .openModal(AppDialog, config, APP_DIALOG_OPEN, 'ACCOUNT_DIALOG_CLOSE')
        .catch(failed);
    } catch {
      failed();
    }
  }
  remove(account: Account): void {
    this.run(
      () => this.auth.delete(account.id),
      () => {
        this.pendingDelete.set(null);
        if (this.auth.user()) {
          this.load(true);
          this.message.set('Cuenta eliminada.');
        }
      },
    );
  }
}
