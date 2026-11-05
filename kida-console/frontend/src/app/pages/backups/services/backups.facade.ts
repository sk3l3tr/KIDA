import { Injectable, computed, inject, signal } from '@angular/core';
import { BackupConfigurationsState } from './configurations-state';
import { BackupHealthState } from './health-state';
import { BackupReportsState } from './reports-state';

@Injectable()
export class BackupsFacade {
  readonly configurations = inject(BackupConfigurationsState);
  readonly health = inject(BackupHealthState);
  readonly reports = inject(BackupReportsState);
  readonly active = signal(false);
  readonly operationsBlocked = computed(
    () => this.configurations.occupied() || this.health.occupied() || this.reports.occupied(),
  );

  ionViewWillEnter(): void {
    this.ionViewWillLeave();
    this.active.set(true);
    this.configurations.enter(() => this.health.occupied() || this.reports.occupied());
    this.health.enter(() => this.configurations.occupied() || this.reports.occupied());
    this.reports.enter(
      () => this.configurations.occupied() || this.health.occupied(),
      () => this.health.refreshAfterReportDelete(),
    );
  }
  ionViewWillLeave(): void {
    this.active.set(false);
    this.health.reset();
    this.reports.reset();
    this.configurations.reset();
  }
}
