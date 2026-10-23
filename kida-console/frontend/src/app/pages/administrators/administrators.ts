import { Component, OnDestroy, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Observable, Subscription, finalize } from 'rxjs';
import { Account, AuthService } from '../../auth/auth.service';
import { errorMessage } from '../../utils/messages';
import { IonContent } from '@ionic/angular/standalone';

@Component({
  selector: 'app-administrators',
  imports: [FormsModule, IonContent],
  templateUrl: './administrators.html',
})
export class Administrators implements OnDestroy {
  readonly auth = inject(AuthService);
  readonly accounts = signal<Account[]>([]);
  readonly pendingDelete = signal<Account | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly message = signal('');

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
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.ownUsername = this.auth.user()?.username ?? '';
    this.currentPassword = '';
    this.newPassword = '';
    this.confirmPassword = '';
    this.createUsername = '';
    this.createPassword = '';
    this.adminUsername = '';
    this.adminPassword = '';
    this.accounts.set([]);
    this.pendingDelete.set(null);
    this.busy.set(false);
    this.error.set('');
    this.message.set('');
  }
  private load(): void {
    this.subscriptions.add(
      this.auth.accounts().subscribe({
        next: (accounts) => this.accounts.set(accounts),
        error: (error) => this.error.set(errorMessage(error)),
      }),
    );
  }
  private run<T>(operation: Observable<T>, success: () => void, cleanup = () => {}): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    this.subscriptions.add(
      operation
        .pipe(
          finalize(() => {
            this.busy.set(false);
            cleanup();
          }),
        )
        .subscribe({ next: success, error: (error) => this.error.set(errorMessage(error)) }),
    );
  }
  rename(): void {
    this.run(this.auth.rename(this.ownUsername), () => {
      this.message.set('Username actualizado.');
      this.load();
    });
  }
  changePassword(): void {
    if (this.newPassword !== this.confirmPassword) return;
    this.run(
      this.auth.password(this.currentPassword, this.newPassword),
      () => {},
      () => {
        this.currentPassword = '';
        this.newPassword = '';
        this.confirmPassword = '';
      },
    );
  }
  create(): void {
    this.run(
      this.auth.create({
        username: this.createUsername,
        password: this.createPassword,
        admin_username: this.adminUsername,
        admin_password: this.adminPassword,
      }),
      () => {
        this.createUsername = '';
        this.message.set('Administrador creado.');
        this.load();
      },
      () => {
        this.createPassword = '';
        this.adminPassword = '';
      },
    );
  }
  remove(account: Account): void {
    this.run(this.auth.delete(account.id), () => {
      this.pendingDelete.set(null);
      if (this.auth.user()) {
        this.load();
        this.message.set('Cuenta eliminada.');
      }
    });
  }
}
