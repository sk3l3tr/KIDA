import { Component, ChangeDetectorRef, OnDestroy, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { ThemeIdentity } from '../../../theme/integration';
import { BackupsFacade } from './services/backups.facade';
import { BackupConfigurationsState } from './services/configurations-state';
import { BackupHealthState } from './services/health-state';
import { BackupReportsState } from './services/reports-state';
import { BackupConfigurations } from './components/backup-configurations/backup-configurations';
import { BackupHealth } from './components/backup-health/health';
import { BackupReports } from './components/backup-reports/reports';

@Component({
  selector: 'app-backups',
  imports: [IonContent, BackupConfigurations, BackupHealth, BackupReports],
  providers: [BackupsFacade, BackupConfigurationsState, BackupHealthState, BackupReportsState],
  templateUrl: './backups.html',
  styleUrl: './backups.scss',
})
export class Backups implements OnDestroy {
  readonly state = inject(BackupsFacade);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly sessionChanges = inject(ThemeIdentity).changes.subscribe(() =>
    this.ionViewWillLeave(),
  );

  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
    this.changeDetector.detectChanges();
  }
  ionViewWillLeave(): void {
    this.state.ionViewWillLeave();
    // Ionic may detach a cached page; clear its DOM as well as its state.
    this.changeDetector.detectChanges();
  }
  ngOnDestroy(): void {
    this.state.ionViewWillLeave();
    this.sessionChanges.unsubscribe();
  }
}
