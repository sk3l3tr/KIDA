import {
  Component,
  ChangeDetectorRef,
  OnDestroy,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { BackupConfigurationsState } from '../../services/configurations-state';
import { BackupCreateForm } from '../../components/backup-create-form/backup-create-form';
import { IonContent } from '@ionic/angular/standalone';
import { BackupsFacade } from '../../services/backups.facade';
import { limitedPrecision } from '../../utils/backups-presentation';

@Component({
  selector: 'app-backup-configurations',
  imports: [IonContent, DatePipe, JsonPipe, BackupCreateForm],
  templateUrl: './backup-configurations.html',
  styleUrl: '../../backups.scss',
})
export class BackupConfigurations implements OnDestroy {
  readonly backups = inject(BackupsFacade);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly uiClosed = this.backups.uiClosed.subscribe(() =>
    this.changeDetector.detectChanges(),
  );
  readonly state = inject(BackupConfigurationsState);
  readonly limitedPrecision = limitedPrecision;
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');

  ionViewWillEnter(): void {
    this.backups.ionViewWillEnter();
    this.changeDetector.detectChanges();
  }
  ionViewWillLeave(): void {
    this.backups.leaveTab();
  }
  ngOnDestroy(): void {
    this.uiClosed.unsubscribe();
  }
  constructor() {
    this.state.focusFallback = () => this.listHeading()?.nativeElement;
  }
}
