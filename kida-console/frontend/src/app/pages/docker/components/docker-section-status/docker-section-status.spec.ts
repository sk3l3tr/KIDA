import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DockerSectionStatus } from './docker-section-status';

describe('DockerSectionStatus', () => {
  it('keeps loading, read errors and stale snapshots independent', () => {
    const fixture = TestBed.createComponent(DockerSectionStatus);
    const state = {
      data: signal<unknown>(null),
      loading: signal(true),
      error: signal(''),
      stale: signal(false),
    };
    fixture.componentRef.setInput('state', state);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Actualizando lectura');
    expect(fixture.nativeElement.querySelector('[aria-busy]').getAttribute('aria-busy')).toBe(
      'true',
    );
    expect(fixture.nativeElement.querySelector('[role=alert]')).toBeNull();
    state.loading.set(false);
    state.error.set('sin conexión');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain(
      'sin conexión',
    );
    expect(fixture.nativeElement.textContent).not.toContain('desactualizados');
    state.data.set({ preserved: true });
    state.stale.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('desactualizados');
    expect(state.data()).toEqual({ preserved: true });
  });
});
