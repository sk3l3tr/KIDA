import {
  Component,
  DestroyRef,
  Directive,
  ElementRef,
  NgZone,
  afterNextRender,
  contentChildren,
  effect,
  inject,
  viewChild,
} from '@angular/core';

@Directive({
  selector: '[appMasonryItem]',
  host: { style: 'display: block; min-width: 0; margin: 0;' },
})
export class MasonryItem {
  readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
}

@Component({
  selector: 'app-masonry',
  template: '<span #metrics class="metrics" aria-hidden="true"></span><ng-content />',
  styles: `
    :host {
      display: grid;
      position: relative;
      min-width: 0;
      grid-template-columns: repeat(var(--masonry-columns, 1), minmax(0, 1fr));
      gap: var(--masonry-gap, 1rem);
      align-items: start;
    }
    :host(.masonry-ready) {
      display: block;
    }
    .metrics {
      position: absolute;
      visibility: hidden;
      pointer-events: none;
      width: var(--masonry-gap, 1rem);
      height: calc(var(--masonry-columns, 1) * 1px);
    }
  `,
})
export class Masonry {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly items = contentChildren(MasonryItem);
  private readonly metrics = viewChild.required<ElementRef<HTMLElement>>('metrics');
  private observer?: ResizeObserver;
  private observed = new Set<HTMLElement>();
  private frame: number | null = null;

  constructor() {
    effect(() => {
      const elements = this.items().map((item) => item.element);
      if (this.observer) this.observeItems(elements);
    });
    afterNextRender(() => {
      // The CSS grid remains usable when measurement is unavailable.
      if (typeof ResizeObserver === 'undefined') return;
      this.zone.runOutsideAngular(() => {
        this.observer = new ResizeObserver(() => this.schedule());
        this.observer.observe(this.host);
        // Observe CSS configuration too, even if a theme changes only the gap.
        this.observer.observe(this.metrics().nativeElement);
        this.observeItems(this.items().map((item) => item.element));
      });
    });
    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      if (this.frame !== null) cancelAnimationFrame(this.frame);
      for (const element of this.observed) this.resetItem(element);
      this.observed.clear();
    });
  }

  private observeItems(elements: HTMLElement[]): void {
    const next = new Set(elements);
    for (const element of this.observed) {
      if (!next.has(element)) {
        this.observer!.unobserve(element);
        this.resetItem(element);
      }
    }
    for (const element of next) {
      if (!this.observed.has(element)) this.observer!.observe(element);
    }
    this.observed = next;
    this.schedule();
  }

  private schedule(): void {
    if (this.frame !== null) return;
    this.zone.runOutsideAngular(() => {
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.layout();
      });
    });
  }

  private layout(): void {
    const width = this.host.clientWidth;
    // Ionic can retain routed views while their containers are hidden.
    if (!width) return;
    const style = getComputedStyle(this.host);
    const columns = Math.max(
      1,
      Math.floor(Number(style.getPropertyValue('--masonry-columns')) || 1),
    );
    const gap = Math.max(0, parseFloat(style.columnGap) || 0);
    const itemWidth = Math.max(0, (width - gap * (columns - 1)) / columns);
    const elements = [...this.observed];

    this.host.classList.add('masonry-ready');
    for (const element of elements) {
      element.style.position = 'absolute';
      element.style.width = `${itemWidth}px`;
    }
    // Read all natural heights together after assigning the final widths.
    const heights = elements.map((element) => element.getBoundingClientRect().height);
    const bottoms = Array<number>(columns).fill(0);
    for (let index = 0; index < elements.length; index++) {
      const column = bottoms.indexOf(Math.min(...bottoms));
      elements[index].style.left = `${column * (itemWidth + gap)}px`;
      elements[index].style.top = `${bottoms[column]}px`;
      bottoms[column] += heights[index] + gap;
    }
    this.host.style.height = `${Math.max(0, Math.max(...bottoms) - gap)}px`;
  }

  private resetItem(element: HTMLElement): void {
    for (const property of ['position', 'width', 'left', 'top'])
      element.style.removeProperty(property);
  }
}
