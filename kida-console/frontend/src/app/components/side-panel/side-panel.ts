import { Component, ElementRef, effect, inject, input, output, viewChild } from '@angular/core';
import { createAnimation, IonicModule } from '@ionic/angular';

function panelMotion(base: HTMLElement, leaving: boolean) {
  const win = base.ownerDocument.defaultView;
  const tokens = win?.getComputedStyle(base);
  const reduced = win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const duration = Number.parseFloat(tokens?.getPropertyValue('--kida-modal-duration') ?? '') || 180;
  const easing = tokens?.getPropertyValue('--kida-modal-easing').trim() || 'ease-out';
  const content = base.shadowRoot?.querySelector<HTMLElement>('[part="content"]');
  const backdrop = base.shadowRoot?.querySelector('ion-backdrop');
  const animation = createAnimation().addElement(base)
    .duration(reduced ? 1 : leaving ? duration * 0.8 : duration)
    .easing(easing).direction(leaving ? 'reverse' : 'normal');
  if (content) animation.addAnimation(createAnimation().addElement(content)
    .fromTo('opacity', '0', '1')
    .fromTo('transform', reduced ? 'none' : 'translateX(100%)', 'none'));
  if (backdrop) animation.addAnimation(createAnimation().addElement(backdrop)
    .fromTo('opacity', '0', 'var(--backdrop-opacity)'));
  return animation;
}

@Component({
  selector: 'app-side-panel',
  imports: [IonicModule],
  templateUrl: './side-panel.html',
  styleUrl: './side-panel.scss',
})
export class SidePanel {
  readonly open = input(false, { transform: (value: boolean) => {
    if (value) this.origin = this.host.nativeElement.ownerDocument.activeElement as HTMLElement | null;
    return value;
  } });
  readonly title = input.required<string>();
  readonly subtitle = input<string>();
  readonly focusTrap = input(true);
  readonly fallbackFocus = input<HTMLElement | null>(null);
  readonly closed = output<void>();
  readonly enterAnimation = (base: HTMLElement) => panelMotion(base, false);
  readonly leaveAnimation = (base: HTMLElement) => panelMotion(base, true);
  private readonly closeButton = viewChild<unknown, ElementRef<HTMLElement>>('closeButton', { read: ElementRef });
  private readonly modal = viewChild<unknown, ElementRef<HTMLElement>>('modal', { read: ElementRef });
  private readonly host = inject(ElementRef<HTMLElement>);
  private origin: HTMLElement | null = null;
  private presentation = 0;

  constructor() {
    effect(() => this.labelDialog(this.modal()?.nativeElement, this.title()));
  }

  willPresent(event: Event): void {
    this.presentation++;
    const modal = event.target as HTMLElement;
    this.labelDialog(modal, this.title());
  }

  private labelDialog(modal: HTMLElement | undefined, title: string): void {
    modal?.shadowRoot?.querySelector('[part="content"]')?.setAttribute('aria-label', title);
  }

  focusClose(): void {
    this.closeButton()?.nativeElement.shadowRoot?.querySelector<HTMLButtonElement>('button')?.focus();
  }

  didDismiss(): void {
    const origin = this.origin;
    const presentation = this.presentation;
    this.origin = null;
    this.closed.emit();
    // Ionic restores focus and unhides the underlying view after didDismiss.
    // Wait until that cleanup finishes before selecting a connected destination.
    setTimeout(() => {
      if (presentation !== this.presentation || this.open() || !this.usable(this.host.nativeElement)) return;
      const target = this.usable(origin) ? origin : this.fallbackFocus();
      if (this.usable(target)) target?.focus();
    });
  }

  private usable(target: HTMLElement | null): boolean {
    return !!target?.isConnected && target !== target.ownerDocument.body &&
      target !== target.ownerDocument.documentElement &&
      !target.closest('.ion-page-hidden, [inert], [aria-hidden="true"]');
  }
}
