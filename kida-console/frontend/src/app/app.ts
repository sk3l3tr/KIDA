import { DOCUMENT } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, NavigationError, Router } from '@angular/router';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { IonicModule } from '@ionic/angular';
import { CoreComponentsModule } from 'arca';

@Component({
  imports: [IonicModule, CoreComponentsModule],
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly startupError = signal(false);
  constructor() {
    const root = inject(DOCUMENT).documentElement;
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event instanceof NavigationError && root.hasAttribute('data-identity-pending')) {
          this.startupError.set(true);
        }
        if (event instanceof NavigationEnd) {
          this.startupError.set(false);
          root.removeAttribute('data-identity-pending');
        }
      });
  }
}
