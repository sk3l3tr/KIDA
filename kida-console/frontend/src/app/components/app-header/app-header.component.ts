import { Component, computed, inject, signal } from '@angular/core';
import { IonMenuButton } from '@ionic/angular/standalone';
import { finalize } from 'rxjs';
import { AuthService } from '../../auth/auth.service';
import { errorMessage } from '../../utils/messages';

@Component({
  selector: 'app-header',
  templateUrl: './app-header.component.html',
  styleUrls: ['./app-header.component.scss'],
  imports: [IonMenuButton],
})
export class AppHeaderComponent {
  private readonly authService = inject(AuthService);
  readonly ownUsername = computed(() => this.authService.user()?.username ?? '');
  readonly busy = signal(false);
  readonly error = signal('');

  public logout(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    this.authService
      .logout()
      .pipe(finalize(() => this.busy.set(false)))
      .subscribe({ error: (error) => this.error.set(errorMessage(error)) });
  }
}
