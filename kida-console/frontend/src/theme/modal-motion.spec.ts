import { enterThemeModal, leaveThemeModal } from './modal-motion';

describe('Theme modal motion', () => {
  let element: HTMLElement;
  let reduced: boolean;
  const descriptor = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  beforeEach(() => {
    reduced = false;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: reduced }),
    });
    element = document.createElement('div');
    element.attachShadow({ mode: 'open' }).innerHTML =
      '<div part="content"></div><ion-backdrop></ion-backdrop>';
    document.body.append(element);
  });
  afterEach(() => {
    element.remove();
    if (descriptor) Object.defineProperty(window, 'matchMedia', descriptor);
    else Reflect.deleteProperty(window, 'matchMedia');
  });

  it('reads the current theme again on exit rather than retaining opening tokens', () => {
    element.style.setProperty('--kida-modal-duration', '280');
    element.style.setProperty('--kida-modal-offset', '16px');
    element.style.setProperty('--kida-modal-scale', '0.99');
    const enter = enterThemeModal(element);
    expect(enter.getDuration()).toBe(280);
    expect(enter.childAnimations[0].getKeyframes()[0]['transform']).toBe(
      'translateY(16px) scale(0.99)',
    );
    element.style.setProperty('--kida-modal-duration', '120');
    const leave = leaveThemeModal(element);
    expect(leave.getDuration()).toBe(96);
    expect(leave.getDirection()).toBe('reverse');
    enter.destroy();
    leave.destroy();
  });

  it('uses Ionic’s minimum duration without movement for reduced motion in both directions', () => {
    reduced = true;
    for (const animation of [enterThemeModal(element), leaveThemeModal(element)]) {
      expect(animation.getDuration()).toBe(1);
      expect(animation.childAnimations[0].getKeyframes()[0]['transform']).toBe('none');
      animation.destroy();
    }
  });
});
