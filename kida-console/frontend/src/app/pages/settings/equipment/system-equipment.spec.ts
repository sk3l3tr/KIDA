import { TestBed } from '@angular/core/testing';
import { Component, TemplateRef, contentChild, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import {
  IonAccordion,
  IonAccordionGroup,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonTitle,
  IonToolbar,
  provideIonicAngular,
} from '@ionic/angular/standalone';
import { equipmentGroup, equipmentGroups, extraEquipmentFields } from './equipment-data';
import { displaySystemValue } from '../../system/system-format';
import { SystemEquipment } from './system-equipment';

const info = {
  hostname: 'core-server',
  os: { name: 'Linux', version: null, future_os: false },
  kernel: { version: '6.12', long_version: null },
  architecture: 'x86_64',
  hardware: { model: 'Server', vendor: null },
  cpu: { brand: 'CPU', logical_cores: 0, physical_cores: null },
  memory: { total_bytes: 1024 ** 3, available_bytes: 0 },
  graphics: ['GPU única'],
  disks: [{ name: 'disk / <test>', total_bytes: 1024 ** 3, removable: false, future: 'kept' }],
  future: { extra: 'visible' },
};

// Presentation/focus/animations are exercised in Chromium. Mount content here without
// starting Ionic's asynchronous native overlay lifecycle in jsdom.
@Component({
  selector: 'ion-modal',
  imports: [NgTemplateOutlet],
  template: '<ng-container [ngTemplateOutlet]="content() ?? null" />',
})
class TestModal {
  readonly isOpen = input(false);
  readonly enterAnimation = input<unknown>();
  readonly leaveAnimation = input<unknown>();
  readonly content = contentChild(TemplateRef);
}

describe('Equipment presentation', () => {
  // jsdom has no media queries; Ionic checks these even when animation APIs are absent.
  const mediaDescriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (media: string) => ({
        matches: true,
        media,
        addEventListener() {},
        removeEventListener() {},
      }),
    });
  });
  afterAll(() => {
    if (mediaDescriptor) Object.defineProperty(window, 'matchMedia', mediaDescriptor);
    else Reflect.deleteProperty(window, 'matchMedia');
  });
  it('groups all known fields without losing nested extensions', () => {
    expect(equipmentGroups(info, 'system').map((g) => g.key)).toEqual([
      'architecture',
      'os',
      'kernel',
    ]);
    const hardware = equipmentGroups(info, 'hardware');
    expect(hardware.map((g) => g.key)).toEqual(['graphics', 'hardware', 'cpu', 'memory', 'disks']);
    expect(
      equipmentGroups({ ...info, hardware: null, cpu: 'CPU' }, 'hardware').map((g) => g.key),
    ).toEqual(['hardware', 'cpu', 'graphics', 'memory', 'disks']);
    expect(hardware.find((g) => g.key === 'cpu')?.value).toBe(info.cpu);
    expect(hardware.find((g) => g.key === 'disks')?.expandable).toBe(true);
    expect(extraEquipmentFields(info)).toEqual({ future: { extra: 'visible' } });
  });

  it('uses direct values for scalars and one GPU, retaining structured groups with one field', () => {
    expect(equipmentGroup('graphics', ['GPU']).value).toBe('GPU');
    expect(equipmentGroup('graphics', ['GPU']).expandable).toBe(false);
    expect(equipmentGroup('graphics', ['GPU', 'GPU 2']).expandable).toBe(true);
    expect(equipmentGroup('cpu', { brand: 'CPU' }).expandable).toBe(true);
    for (const value of [null, undefined, '', false, 0, []]) {
      expect(equipmentGroup('field', value).expandable).toBe(false);
    }
    expect(equipmentGroup('graphics', [null]).value).toBeNull();
    expect(equipmentGroup('disks', [{ name: 'disk' }]).expandable).toBe(true);
  });

  it('preserves unknowns, empty lists, booleans, zero and exact bytes', () => {
    expect(equipmentGroups({}, 'system')).toHaveLength(3);
    expect(displaySystemValue(null)).toBe('Desconocido');
    expect(displaySystemValue('unknown')).toBe('Desconocido (unknown)');
    expect(displaySystemValue(false)).toBe('No');
    expect(displaySystemValue(0)).toBe('0');
    expect(displaySystemValue(1024 ** 3, 'total_bytes')).toBe('1 GiB (1073741824 bytes)');
  });

  function setup() {
    TestBed.configureTestingModule({
      imports: [SystemEquipment],
      providers: [provideIonicAngular()],
    });
    TestBed.overrideComponent(SystemEquipment, {
      remove: { imports: [IonicModule] },
      add: {
        imports: [
          TestModal,
          IonAccordion,
          IonAccordionGroup,
          IonButton,
          IonButtons,
          IonContent,
          IonHeader,
          IonItem,
          IonLabel,
          IonList,
          IonTitle,
          IonToolbar,
        ],
      },
    });
    const fixture = TestBed.createComponent(SystemEquipment);
    fixture.componentRef.setInput('value', structuredClone(info));
    fixture.detectChanges();
    return fixture;
  }

  function mountDetails(fixture: ReturnType<typeof setup>, detail: 'system' | 'hardware') {
    fixture.componentInstance.open(detail);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('ion-modal').dispatchEvent(new CustomEvent('ionMount'));
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('ion-modal') as HTMLElement;
  }

  it('renders a noninteractive hostname and emits refresh independently of opening details', () => {
    const fixture = setup(),
      root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.hostname-row')?.textContent).toContain('core-server');
    expect(root.querySelector('.hostname-row')?.hasAttribute('button')).toBe(false);
    expect(root.querySelectorAll('.equipment-list ion-item[button]')).toHaveLength(2);
    const refresh = vi.fn();
    fixture.componentInstance.refresh.subscribe(refresh);
    root.querySelector<HTMLButtonElement>('.equipment-header button')!.click();
    expect(refresh).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.isOpen()).toBe(false);
  });

  it('renders grouped hardware, direct GPU, named disks and safe text', () => {
    const fixture = setup(),
      modal = mountDetails(fixture, 'hardware');
    expect(modal.textContent).toContain('GPU única');
    expect(modal.querySelector('ion-accordion[value="graphics"]')).toBeNull();
    expect(modal.textContent).toContain('1 GiB (1073741824 bytes)');
    expect(modal.textContent).toContain('disk / <test>');
    expect(modal.querySelector('test')).toBeNull();
    expect(modal.textContent).toContain('kept');
    expect(modal.textContent).toContain('No');
    expect(modal.querySelector('ion-accordion-group')?.multiple).toBe(true);
  });

  it('keeps an open detail current through refresh errors and subsequent successful updates', () => {
    const fixture = setup(),
      modal = mountDetails(fixture, 'system');
    fixture.componentRef.setInput('loading', true);
    fixture.componentRef.setInput('error', 'Sin conexión');
    fixture.detectChanges();
    expect(modal.textContent).toContain('Datos anteriores');
    expect(modal.textContent).toContain('Sin conexión');
    fixture.componentRef.setInput('value', { ...info, os: { name: 'Nuevo sistema' } });
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('error', '');
    fixture.detectChanges();
    expect(modal.textContent).toContain('Nuevo sistema');
    expect(fixture.componentInstance.isOpen()).toBe(true);
  });

  it('resets dismissal state and clears the selection when page data is discarded', () => {
    const fixture = setup(),
      view = fixture.componentInstance;
    mountDetails(fixture, 'hardware');
    view.close();
    view.didDismiss();
    expect(view.isOpen()).toBe(false);
    expect(view.detail()).toBeNull();
    view.open('system');
    fixture.componentRef.setInput('value', null);
    fixture.detectChanges();
    expect(view.isOpen()).toBe(false);
    expect(view.detail()).toBeNull();
    view.open('hardware');
    expect(view.isOpen()).toBe(false);
  });
});
