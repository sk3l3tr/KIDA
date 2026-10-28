import { Component, TemplateRef, contentChild, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';
import { IonButton, IonButtons, IonContent, IonHeader, IonToolbar, provideIonicAngular } from '@ionic/angular/standalone';
import { SidePanel } from './side-panel';

@Component({ selector: 'ion-modal', imports: [NgTemplateOutlet], template: '<ng-container [ngTemplateOutlet]="content() ?? null" />' })
class TestModal {
  readonly isOpen = input(false);
  readonly focusTrap = input(true);
  readonly enterAnimation = input<unknown>();
  readonly leaveAnimation = input<unknown>();
  readonly content = contentChild(TemplateRef);
  dismiss() {}
}

@Component({ imports: [SidePanel], template: `<button #origin>Abrir</button><h1 #fallback tabindex="-1">Vista</h1>
  <app-side-panel [open]="open()" title="Detalles" subtitle="Lectura" [focusTrap]="trap" [fallbackFocus]="fallback" (closed)="closed = closed + 1; open.set(false)">
    <p>Contenido de otro módulo</p><button panel-actions>Acción</button>
  </app-side-panel>` })
class TestHost { open = signal(false); trap = false; closed = 0; }

describe('SidePanel', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TestHost], providers: [provideIonicAngular()] });
    TestBed.overrideComponent(SidePanel, { remove: { imports: [IonicModule] }, add: { imports: [TestModal, IonButton, IonButtons, IonContent, IonHeader, IonToolbar] } });
  });
  it('projects independent content and actions, forwards inputs and emits on dismissal', () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const modal = root.querySelector('ion-modal')!;
    expect(root.textContent).toContain('Contenido de otro módulo');
    expect(root.querySelector('.panel-actions')?.textContent).toContain('Acción');
    expect(root.textContent).toContain('Lectura');
    const instance = fixture.debugElement.children.find((e) => e.componentInstance instanceof SidePanel)!.componentInstance as SidePanel;
    expect(instance.focusTrap()).toBe(false);
    modal.dispatchEvent(new CustomEvent('didDismiss'));
    expect(fixture.componentInstance.closed).toBe(1);
  });
  it('returns focus to a connected origin or the provided fallback', async () => {
    const fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    document.body.appendChild(fixture.nativeElement);
    const root = fixture.nativeElement as HTMLElement;
    const origin = root.querySelector('button')!;
    const fallback = root.querySelector('h1')!;
    const modal = root.querySelector('ion-modal')!;
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    origin.focus();
    expect(document.activeElement).toBe(origin);
    fixture.componentInstance.open.set(true);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    const panel = fixture.debugElement.children.find((e) => e.componentInstance instanceof SidePanel)!.componentInstance as SidePanel;
    expect(panel.open()).toBe(true);
    expect(fixture.componentInstance.closed).toBe(0);
    modal.dispatchEvent(new CustomEvent('willPresent'));
    fallback.focus();
    expect(document.activeElement).toBe(fallback);
    modal.dispatchEvent(new CustomEvent('didDismiss'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(origin);
    origin.focus();
    fixture.componentInstance.open.set(true);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    modal.dispatchEvent(new CustomEvent('willPresent'));
    origin.remove();
    modal.dispatchEvent(new CustomEvent('didDismiss'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(fallback);
    fallback.blur();
    fixture.componentInstance.open.set(true);
    fixture.changeDetectorRef.markForCheck();
    fixture.detectChanges();
    modal.dispatchEvent(new CustomEvent('willPresent'));
    modal.dispatchEvent(new CustomEvent('didDismiss'));
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve));
    expect(document.activeElement).toBe(fallback);
    fixture.destroy();
  });
  it('updates the accessible dialog name when its title changes', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.componentRef.setInput('title', 'Primero');
    fixture.detectChanges();
    const modal = fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
    const content = document.createElement('div');
    content.setAttribute('part', 'content');
    (modal.shadowRoot ?? modal.attachShadow({ mode: 'open' })).appendChild(content);
    modal.dispatchEvent(new CustomEvent('willPresent'));
    expect(content.getAttribute('aria-label')).toBe('Primero');
    fixture.componentRef.setInput('title', 'Segundo');
    fixture.detectChanges();
    expect(content.getAttribute('aria-label')).toBe('Segundo');
  });
  it('makes the panel visible on entry and reverses the animation on exit', () => {
    const fixture = TestBed.createComponent(SidePanel);
    fixture.componentRef.setInput('title', 'Detalles');
    fixture.detectChanges();
    const base = document.createElement('div');
    base.attachShadow({ mode: 'open' }).innerHTML = '<div part="content"></div><ion-backdrop></ion-backdrop>';
    const enter = fixture.componentInstance.enterAnimation(base);
    const leave = fixture.componentInstance.leaveAnimation(base);
    const frames = enter.childAnimations[0].getKeyframes();
    expect(frames[0]['opacity']).toBe('0');
    expect(frames[frames.length - 1]['opacity']).toBe('1');
    expect(leave.getDirection()).toBe('reverse');
    expect(leave.childAnimations[0].getKeyframes()[1]['opacity']).toBe('1');
    enter.destroy();
    leave.destroy();
  });
});
