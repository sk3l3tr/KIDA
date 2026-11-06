import { Injectable, computed, effect, inject, signal } from '@angular/core';
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

  constructor() {
    effect(() => {
      if (this.panel() === 'configuration-detail' && !this.configurations.selected())
        this.closeConfigurationDetail();
      if (this.panel() === 'health-detail' && this.health.selectedId() === null)
        this.closeHealthDetail();
    });
  }

  openConfigurationDetail(id: string): void {
    if (!this.active() || this.configurations.operationsBlocked()) return;
    if (!this.configurations.entries()?.some((job) => job.id === id)) return;
    this.configurations.select(id);
    this.panel.set('configuration-detail');
  }

  closeConfigurationDetail(): void {
    if (this.panel() !== 'configuration-detail') return;
    this.closeConfigurationPanel();
  }

  openConfigurationCreate(): void {
    if (!this.active() || this.configurations.operationsBlocked()) return;
    this.configurations.leaveTab();
    this.panel.set('configuration-create');
  }

  closeConfigurationPanel(): void {
    if (this.panel() !== 'configuration-detail' && this.panel() !== 'configuration-create') return;
    this.panel.set(null);
    this.configurations.leaveTab();
  }

  openHealthDetail(id: string): void {
    if (!this.active() || this.health.disabled()) return;
    if (!this.health.entries()?.some((row) => row.run_id === id)) return;
    this.health.select(id);
    this.panel.set('health-detail');
  }

  openHealthForm(mode: 'health-create' | 'health-run'): void {
    if (!this.active() || this.health.disabled()) return;
    this.health.leaveTab();
    this.panel.set(mode);
    this.closed.next();
  }

  closeHealthDetail(): void {
    if (this.panel() !== 'health-detail') return;
    this.closeHealthPanel();
  }

  closeHealthPanel(): void {
    if (
      this.panel() !== 'health-detail' &&
      this.panel() !== 'health-create' &&
      this.panel() !== 'health-run'
    )
      return;
    this.panel.set(null);
    this.health.leaveTab();
    this.closed.next();
  }

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
