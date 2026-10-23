import { ChangeDetectionStrategy, Component } from '@angular/core';
import { IonApp } from '@ionic/angular/standalone';
import { CoreComponentsModule } from 'arca';

@Component({
  imports: [IonApp, CoreComponentsModule],
  selector: 'app-root',
  // ARCA updates its shell asynchronously through Zone.js.
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {}
