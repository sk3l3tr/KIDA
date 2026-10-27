import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SystemSection } from './system.facade';

@Component({
  selector: 'app-system-section',
  imports: [DatePipe],
  template: `
    <div class="section-header">
      <h2>{{ state().title }}</h2>
      <button class="secondary" (click)="refresh.emit()" [disabled]="state().loading()">
        Actualizar {{ state().title }}
      </button>
    </div>
    <div aria-live="polite" [attr.aria-busy]="state().loading()">
      @if (state().loading()) {
        <p>Cargando…</p>
      }
      @if (state().updated()) {
        <small
          >Última actualización: {{ state().updated() | date: 'medium' }}. Instantánea; puede estar
          desactualizada.</small
        >
      } @else {
        <small>Sin actualización disponible.</small>
      }
      @if (state().error()) {
        <p class="error" role="alert">{{ state().error() }}</p>
      }
      @if (state().data() !== null && (state().error() || state().loading())) {
        <p>Datos anteriores; pendientes de actualizar.</p>
      }
      @if (state().data() === null && !state().loading()) {
        <p>Sin datos disponibles.</p>
      }
    </div>
  `,
  styles: `
    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    h2 {
      margin: 0;
    }
  `,
})
export class SystemSectionView {
  readonly state = input.required<SystemSection>();
  readonly refresh = output<void>();
}
