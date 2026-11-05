import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdministratorsFacade } from '../../services/administrators.facade';

@Component({
  selector: 'app-administrator-create-form',
  imports: [FormsModule],
  templateUrl: './administrator-create-form.html',
})
export class AdministratorCreateForm {
  readonly state = inject(AdministratorsFacade);
}
