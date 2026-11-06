import { Injectable, computed, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { BackupConfigurationsState } from './configurations-state';
import { BackupHealthState } from './health-state';
import { BackupReportsState } from './reports-state';

export type BackupPanel =
  | 'configuration-create'
  | 'configuration-detail'
  | 'health-create'
  | 'health-run'
  | 'health-detail'
  | 'report-detail';

@Injectable()
export class BackupsFacade {
  readonly configurations = inject(BackupConfigurationsState);
  readonly health = inject(BackupHealthState);
  readonly reports = inject(BackupReportsState);
  readonly active = signal(false);
  readonly search = signal('');
  readonly panel = signal<BackupPanel | null>(null);
  private readonly closed = new Subject<void>();
  readonly uiClosed = this.closed.asObservable();
  readonly operationsBlocked = computed(
    () => this.configurations.occupied() || this.health.occupied() || this.reports.occupied(),
  );

  ionViewWillEnter(): void {
    if (this.active()) return;
    this.active.set(true);
    this.configurations.enter(() => this.health.occupied() || this.reports.occupied());
    this.health.enter(() => this.configurations.occupied() || this.reports.occupied());
    this.reports.enter(
      () => this.configurations.occupied() || this.health.occupied(),
      () => this.health.refreshAfterReportDelete(),
    );
  }
  leaveTab(): void {
    this.panel.set(null);
    this.configurations.leaveTab();
    this.health.leaveTab();
    this.reports.leaveTab();
    this.closed.next();
  }
  ionViewWillLeave(): void {
    this.active.set(false);
    this.health.reset();
    this.reports.reset();
    this.configurations.reset();
    this.search.set('');
    this.panel.set(null);
    this.closed.next();
  }
}
