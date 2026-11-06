import {
  Component,
  ChangeDetectorRef,
  OnDestroy,
  ElementRef,
  inject,
  viewChild,
  computed,
} from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { BackupConfigurationsState } from '../../services/configurations-state';
import { BackupCreateForm } from '../../components/backup-create-form/backup-create-form';
import { IonContent } from '@ionic/angular/standalone';
import { BackupsFacade } from '../../services/backups.facade';
import { limitedPrecision } from '../../utils/backups-presentation';
import { SidePanel } from '../../../../components/side-panel/side-panel';

@Component({
  selector: 'app-backup-configurations',
  imports: [IonContent, DatePipe, JsonPipe, BackupCreateForm, SidePanel],
  templateUrl: './backup-configurations.html',
  styleUrls: ['../../backups.scss', './backup-configurations.scss'],
})
export class BackupConfigurations implements OnDestroy {
  readonly backups = inject(BackupsFacade);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly uiClosed = this.backups.uiClosed.subscribe(() =>
    this.changeDetector.detectChanges(),
  );
  readonly state = inject(BackupConfigurationsState);
  readonly limitedPrecision = limitedPrecision;
  readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');
  private readonly createForm = viewChild<unknown, ElementRef<HTMLElement>>('createForm', {
    read: ElementRef,
  });
  readonly filteredEntries = computed(() => {
    const search = this.backups.search().toLowerCase();
    return (
      this.state
        .entries()
        ?.filter((job) =>
          [job.name, ...job.sources, ...job.targets.map((target) => target.path)].some((value) =>
            value.toLowerCase().includes(search),
          ),
        ) ?? []
    );
  });

  focusCreateForm(): void {
    const input = this.createForm()?.nativeElement.querySelector<HTMLInputElement>('#backup-name');
    input?.scrollIntoView?.({ block: 'center' });
    input?.focus({ preventScroll: true });
  }

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
