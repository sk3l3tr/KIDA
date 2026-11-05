import { Component, inject } from '@angular/core';
import { AdministratorsFacade } from '../../services/administrators.facade';

@Component({
  selector: 'app-administrator-list',
  templateUrl: './administrator-list.html',
})
export class AdministratorList {
  readonly state = inject(AdministratorsFacade);
}
