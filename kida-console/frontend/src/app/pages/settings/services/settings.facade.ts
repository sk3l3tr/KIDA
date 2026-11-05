import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subscription, finalize } from 'rxjs';
import { ThemeIdentity } from '../../../../theme/integration';
import { SystemService } from '../../system/services/system.service';

@Injectable()
export class SettingsFacade implements OnDestroy {
  private readonly service = inject(SystemService);
  private readonly identity = inject(ThemeIdentity);
  readonly info = signal<unknown>(null);
  readonly loading = signal(false);
  clearEquipment: () => void = () => {};
  private subscriptions = new Subscription();
  private readonly sessionChanges = this.identity.changes.subscribe(() => this.reset());

  ionViewWillEnter(): void {
    this.reset();
    this.loadEquipment();
  }
  ionViewWillLeave(): void {
    this.reset();
  }
  ngOnDestroy(): void {
    this.ionViewWillLeave();
    this.sessionChanges.unsubscribe();
  }
  private reset(): void {
    this.clearEquipment();
    this.subscriptions.unsubscribe();
    this.subscriptions = new Subscription();
    this.info.set(null);
    this.loading.set(false);
  }
  private loadEquipment(): void {
    this.loading.set(true);
    this.subscriptions.add(
      this.service
        .info()
        .pipe(finalize(() => this.loading.set(false)))
        .subscribe({
          next: (data) => this.info.set(data),
          error: () => {},
        }),
    );
  }
}
