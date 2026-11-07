import { Component, inject, input, viewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { AdministratorsFacade } from '../../services/administrators.facade';

@Component({
  selector: 'app-administrator-profile',
  imports: [FormsModule],
  templateUrl: './administrator-profile.html',
  styleUrls: ['../../administrators-form.scss', './administrator-profile.scss'],
})
export class AdministratorProfile {
  readonly state = inject(AdministratorsFacade);
  readonly mode = input<'rename' | 'password' | null>(null);
  readonly form = viewChild(NgForm);

  canSubmit(): boolean {
    if (this.form()?.valid !== true || this.state.busy()) return false;
    switch (this.mode()) {
      case 'rename':
        return this.state.ownUsername !== this.state.auth.user()?.username;
      case 'password':
        return this.state.newPassword === this.state.confirmPassword;
      default:
        return false;
    }
  }

  submit(): void {
    if (!this.canSubmit()) return;
    switch (this.mode()) {
      case 'rename':
        this.state.rename();
        break;
      case 'password':
        this.state.changePassword();
        break;
    }
  }
}
