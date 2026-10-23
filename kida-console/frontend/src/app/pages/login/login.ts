import { Component, HostListener, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { IonContent } from '@ionic/angular/standalone';
import { finalize } from 'rxjs';
import { ArcaService } from 'arca';
import { AuthService } from '../../auth/auth.service';
import { errorMessage } from '../../utils/messages';

@Component({
  selector: 'app-login',
  imports: [FormsModule, IonContent],
  templateUrl: './login.html',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly arca = inject(ArcaService);
  private active = false;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  username = '';
  password = '';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly notice =
    (
      {
        password: 'Contraseña actualizada. Inicia sesión de nuevo.',
        deleted: 'Tu cuenta se ha eliminado.',
        expired: 'La sesión ha terminado. Inicia sesión de nuevo.',
      } as Record<string, string>
    )[this.route.snapshot.queryParamMap.get('reason') ?? ''] ?? '';

  ionViewWillEnter(): void {
    this.active = true;
    this.hidePanels();
  }

  ionViewWillLeave(): void {
    this.active = false;
    this.arca.panels.showHeader();
    this.arca.panels.showFooter();
  }

  // ARCA recalculates panel visibility on resize, even while login is active.
  @HostListener('window:resize')
  hidePanels(): void {
    if (!this.active) return;
    this.arca.panels.hideHeader();
    this.arca.panels.hideFooter();
  }

  submit(): void {
    if (this.busy() || !this.username || !this.password) return;
    this.busy.set(true);
    this.error.set('');
    this.auth
      .login(this.username, this.password)
      .pipe(
        finalize(() => {
          this.busy.set(false);
          this.password = '';
        }),
      )
      .subscribe({
        next: () => void this.router.navigate(['/']),
        error: (error) => this.error.set(errorMessage(error)),
      });
  }
}
