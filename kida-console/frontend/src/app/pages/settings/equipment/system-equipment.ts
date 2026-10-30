import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { IonicModule, IonModal } from '@ionic/angular';
import { enterThemeModal, leaveThemeModal } from '../../../../theme/modal-motion';
import { equipmentGroups, systemFields } from './equipment-data';
import { SystemData } from '../../system/components/system-data/system-data';

@Component({
  selector: 'app-system-equipment',
  imports: [SystemData, IonicModule],
  templateUrl: './system-equipment.html',
  styleUrl: './system-equipment.scss',
})
export class SystemEquipment implements OnDestroy {
  readonly value = input<unknown>(null);
  readonly loading = input(false);
  readonly detail = signal<'system' | 'hardware' | null>(null);
  readonly isOpen = signal(false);
  readonly fields = computed(() => systemFields(this.value()));
  readonly groups = computed(() => equipmentGroups(this.value(), this.detail() ?? 'system'));
  readonly title = computed(() =>
    this.detail() === 'hardware' ? 'Hardware' : 'Sistema operativo',
  );
  readonly enterAnimation = enterThemeModal;
  readonly leaveAnimation = leaveThemeModal;
  private readonly modal = viewChild(IonModal);
  private readonly closeButton = viewChild<unknown, ElementRef<HTMLElement>>('closeButton', {
    read: ElementRef,
  });

  constructor() {
    effect(() => {
      if (this.value() === null) this.clear();
    });
  }

  open(detail: 'system' | 'hardware'): void {
    if (this.value() === null || this.detail() !== null) return;
    this.detail.set(detail);
    this.isOpen.set(true);
  }

  close(): void {
    this.isOpen.set(false);
  }

  didDismiss(): void {
    this.isOpen.set(false);
    this.detail.set(null);
  }

  /** Called synchronously by the page before a session/navigation reset. */
  clear(): void {
    this.close();
    const modal = this.modal();
    if (modal) {
      // Dismiss also waits for a presentation already in progress. Keep its view
      // until Ionic has removed the overlay and restored the underlying page.
      void modal.dismiss(undefined, 'cancel').then((dismissed) => {
        if (!dismissed) this.detail.set(null);
      });
    } else {
      this.detail.set(null);
    }
  }

  ngOnDestroy(): void {
    this.clear();
  }

  labelDialog(event: Event): void {
    // Ionic 8 only inherits aria-label once. Update its public content part
    // before each presentation so the persistent dialog has its current name.
    (event.target as HTMLElement).shadowRoot
      ?.querySelector('[part="content"]')
      ?.setAttribute('aria-label', this.title());
  }

  focusClose(): void {
    this.closeButton()
      ?.nativeElement.shadowRoot?.querySelector<HTMLButtonElement>('button')
      ?.focus();
  }

  disks(value: unknown): unknown[] | null {
    return Array.isArray(value) ? value : null;
  }

  diskName(value: unknown, index: number): string {
    const name = systemFields(value)['name'];
    return typeof name === 'string' && name ? name : `Disco ${index + 1}`;
  }
}
