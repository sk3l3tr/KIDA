import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Masonry, MasonryItem } from './masonry';

@Component({
  imports: [Masonry, MasonryItem],
  template: `<app-masonry>
    @for (id of ids(); track id) {
      <section appMasonryItem [attr.data-id]="id">Card {{ id }}</section>
    }
  </app-masonry>`,
})
class Harness {
  readonly ids = signal([0, 1, 2, 3]);
}

describe('Masonry', () => {
  let fixture: ComponentFixture<Harness>;
  let host: HTMLElement;
  let width: number;
  let columns: number;
  let gap: number;
  let heights: number[];
  let resize: () => void;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let observer: {
    observe: ReturnType<typeof vi.fn>;
    unobserve: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    width = 600;
    columns = 2;
    gap = 20;
    heights = [300, 100, 80, 50];
    frames = new Map();
    nextFrame = 0;
    observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe = observer.observe;
        unobserve = observer.unobserve;
        disconnect = observer.disconnect;
      },
    );
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const originalStyle = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
      if (element !== host) return originalStyle(element);
      return {
        columnGap: `${gap}px`,
        getPropertyValue: () => `${columns}`,
      } as unknown as CSSStyleDeclaration;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return { height: heights[Number(this.dataset['id'])] || 0 } as DOMRect;
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount() {
    fixture = TestBed.createComponent(Harness);
    host = fixture.nativeElement.querySelector('app-masonry');
    Object.defineProperty(host, 'clientWidth', { get: () => width });
    fixture.detectChanges();
    await fixture.whenStable();
  }

  function flushFrame() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(0));
  }

  function cards(): HTMLElement[] {
    return [...host.querySelectorAll<HTMLElement>('[appMasonryItem]')];
  }

  it('places cards in the shortest column with left-first ties and preserves DOM order', async () => {
    await mount();
    flushFrame();
    expect(cards().map((card) => [card.style.left, card.style.top, card.style.width])).toEqual([
      ['0px', '0px', '290px'],
      ['310px', '0px', '290px'],
      ['310px', '120px', '290px'],
      ['310px', '220px', '290px'],
    ]);
    expect(cards().map((card) => card.dataset['id'])).toEqual(['0', '1', '2', '3']);
    expect(host.style.height).toBe('300px');
  });

  it('batches notifications and recalculates content heights, gap and columns', async () => {
    await mount();
    flushFrame();
    heights[0] = 40;
    resize();
    resize();
    expect(frames.size).toBe(1);
    flushFrame();
    expect(cards()[2].style.left).toBe('0px');
    expect(cards()[2].style.top).toBe('60px');
    gap = 10;
    columns = 1;
    resize();
    flushFrame();
    expect(cards().map((card) => card.style.top)).toEqual(['0px', '50px', '160px', '250px']);
    expect(cards().every((card) => card.style.width === '600px')).toBe(true);
    expect(host.style.height).toBe('300px');
    expect(observer.observe).toHaveBeenCalledWith(host.querySelector('.metrics'));
  });

  it('observes added cards, releases removed cards and handles an empty layout', async () => {
    await mount();
    flushFrame();
    const removed = cards()[0];
    fixture.componentInstance.ids.set([1, 2, 3, 4]);
    heights[4] = 60;
    fixture.detectChanges();
    await fixture.whenStable();
    flushFrame();
    expect(observer.unobserve).toHaveBeenCalledWith(removed);
    expect(removed.style.position).toBe('');
    expect(observer.observe).toHaveBeenCalledWith(cards()[3]);
    expect(cards()[0].style.left).toBe('0px');
    fixture.componentInstance.ids.set([]);
    fixture.detectChanges();
    await fixture.whenStable();
    flushFrame();
    expect(host.style.height).toBe('0px');
  });

  it('waits for a hidden container to become measurable and follows width changes', async () => {
    width = 0;
    await mount();
    flushFrame();
    expect(host.classList.contains('masonry-ready')).toBe(false);
    width = 400;
    resize();
    flushFrame();
    expect(cards()[0].style.width).toBe('190px');
    width = 500;
    resize();
    flushFrame();
    expect(cards()[0].style.width).toBe('240px');
  });

  it('keeps the CSS grid fallback if ResizeObserver is unavailable', async () => {
    vi.stubGlobal('ResizeObserver', undefined);
    await mount();
    expect(frames.size).toBe(0);
    expect(host.classList.contains('masonry-ready')).toBe(false);
    expect(cards().every((card) => card.style.position === '')).toBe(true);
  });

  it('disconnects observers, cancels pending work and removes owned item styles', async () => {
    await mount();
    flushFrame();
    const elements = cards();
    resize();
    const pending = [...frames.keys()];
    fixture.destroy();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    // Angular may schedule its own work during destruction; the layout's
    // already-pending frame must be cancelled.
    expect(pending.length).toBe(1);
    expect(pending.every((id) => !frames.has(id))).toBe(true);
    expect(elements.every((element) => element.style.position === '')).toBe(true);
  });
});
