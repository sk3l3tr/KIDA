import { Component, ElementRef, OnDestroy, inject, viewChild } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { SidePanel } from '../../components/side-panel/side-panel';
import { AdministratorsFacade } from './services/administrators.facade';
import { AdministratorProfile } from './components/administrator-profile/administrator-profile';
import { AdministratorList } from './components/administrator-list/administrator-list';
import { AdministratorCreateForm } from './components/administrator-create-form/administrator-create-form';

@Component({
  selector: 'app-administrators',
  imports: [
    IonContent,
    SidePanel,
    AdministratorProfile,
    AdministratorList,
    AdministratorCreateForm,
  ],
  providers: [AdministratorsFacade],
  templateUrl: './administrators.html',
  styleUrl: './administrators.scss',
})
export class Administrators implements OnDestroy {
  readonly state = inject(AdministratorsFacade);
  readonly createForm = viewChild(AdministratorCreateForm);
  readonly profileEditor = viewChild<AdministratorProfile>('profileEditor');
  private readonly listHeading = viewChild<ElementRef<HTMLElement>>('listHeading');

  constructor() {
    this.state.focusFallback = () => this.listHeading()?.nativeElement;
  }

  panelTitle(): string {
    switch (this.state.panel()) {
      case 'create':
        return 'Crear administrador';
      case 'rename':
        return 'Cambiar nombre de usuario';
      case 'password':
        return 'Cambiar contraseña';
      default:
        return 'Administradores';
    }
  }

  ionViewWillEnter(): void {
    this.state.ionViewWillEnter();
  }
  ionViewWillLeave(): void {
    this.state.ionViewWillLeave();
  }
  ngOnDestroy(): void {
    this.state.ionViewWillLeave();
  }
}
