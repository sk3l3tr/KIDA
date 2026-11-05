import { Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackupConfigurationsState } from '../../services/configurations-state';
import { BackupOptionalField } from '../backup-optional-field/optional-field';
import { newCommand, newTarget } from '../../utils/backups-form';

@Component({
  selector: 'app-backup-create-form',
  imports: [FormsModule, BackupOptionalField],
  templateUrl: './backup-create-form.html',
  styleUrl: '../../backups.scss',
  styles: ':host { display: contents; }',
})
export class BackupCreateForm {
  readonly state = input.required<BackupConfigurationsState>();
  readonly newTarget = newTarget;
  readonly newCommand = newCommand;
  readonly phases = ['pre_backup', 'post_backup'] as const;
}
