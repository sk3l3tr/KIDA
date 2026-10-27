import { createAnimation } from '@ionic/angular';

/** Presentation-only motion; read current theme tokens again when the overlay closes. */
function modalMotion(base: HTMLElement, leaving: boolean) {
  const win = base.ownerDocument.defaultView;
  const tokens = win?.getComputedStyle(base);
  const reduced = win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const duration =
    Number.parseFloat(tokens?.getPropertyValue('--kida-modal-duration') ?? '') || 180;
  const offset = tokens?.getPropertyValue('--kida-modal-offset').trim() || '8px';
  const scale = tokens?.getPropertyValue('--kida-modal-scale').trim() || '0.98';
  const easing = tokens?.getPropertyValue('--kida-modal-easing').trim() || 'ease-out';
  const content = base.shadowRoot?.querySelector<HTMLElement>('[part="content"]');
  const backdrop = base.shadowRoot?.querySelector('ion-backdrop');
  const animation = createAnimation()
    .addElement(base)
    // Ionic normalizes zero to 1ms for Web Animations browser compatibility.
    .duration(reduced ? 1 : leaving ? duration * 0.8 : duration)
    .easing(easing)
    .direction(leaving ? 'reverse' : 'normal');
  if (content) {
    animation.addAnimation(
      createAnimation()
        .addElement(content)
        .fromTo('opacity', '0', '1')
        .fromTo('transform', reduced ? 'none' : `translateY(${offset}) scale(${scale})`, 'none'),
    );
  }
  if (backdrop) {
    animation.addAnimation(
      createAnimation().addElement(backdrop).fromTo('opacity', '0', 'var(--backdrop-opacity)'),
    );
  }
  return animation;
}

export const enterThemeModal = (base: HTMLElement) => modalMotion(base, false);
export const leaveThemeModal = (base: HTMLElement) => modalMotion(base, true);
