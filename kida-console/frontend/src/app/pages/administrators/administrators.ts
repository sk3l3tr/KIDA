import { Component, OnDestroy, inject } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';
import { Masonry, MasonryItem } from '../../components/masonry/masonry';
import { AdministratorsFacade } from './services/administrators.facade';
import { AdministratorProfile } from './components/administrator-profile/administrator-profile';
import { AdministratorList } from './components/administrator-list/administrator-list';
import { AdministratorCreateForm } from './components/administrator-create-form/administrator-create-form';

@Component({
  selector: 'app-administrators',
  imports: [
    IonContent,
    Masonry,
    MasonryItem,
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
