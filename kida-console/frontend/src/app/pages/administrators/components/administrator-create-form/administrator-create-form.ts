import { Component, inject, viewChild } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { AdministratorsFacade } from '../../services/administrators.facade';

@Component({
  selector: 'app-administrator-create-form',
  imports: [FormsModule],
  templateUrl: './administrator-create-form.html',
  styleUrl: '../../administrators-form.scss',
})
export class AdministratorCreateForm {
  readonly state = inject(AdministratorsFacade);
  readonly form = viewChild(NgForm);

  canSubmit(): boolean {
    return this.form()?.valid === true && !this.state.busy();
  }

  submit(): void {
    if (this.canSubmit()) this.state.create();
  }
}
