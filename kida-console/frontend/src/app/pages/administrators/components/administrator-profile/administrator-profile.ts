import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdministratorsFacade } from '../../services/administrators.facade';

@Component({
  selector: 'app-administrator-profile',
  imports: [FormsModule],
  templateUrl: './administrator-profile.html',
})
export class AdministratorProfile {
  readonly state = inject(AdministratorsFacade);
}
