# Masonry

Import `Masonry` and `MasonryItem` into a standalone component:

```html
<app-masonry class="cards">
  <section appMasonryItem class="panel">First card</section>
  <app-existing-card appMasonryItem />
</app-masonry>
```

```scss
.cards {
  --masonry-columns: 2;
  --masonry-gap: var(--kida-space);
}
@media (max-width: 1100px) {
  .cards {
    --masonry-columns: 1;
  }
}
```

Defaults are one column and a `1rem` gap. Columns must be a positive integer;
use a nonnegative length for the gap. Keep the container free of padding and borders
(put these on an outer wrapper). The layout owns item position, width, left and top;
use padding inside cards rather than margins, and use border-box sizing.

Items must be direct projected children, marked with `appMasonryItem`.
Each goes into the shortest column, with ties resolved from left to right.
DOM and keyboard order remain unchanged; tabbing can therefore move between columns.
The component never moves or recreates cards.

ResizeObserver follows the container, natural card heights and an invisible CSS
measurement element for column/gap changes. Updates are grouped into animation
frames outside Angular. A regular CSS grid is used before measurement and when
ResizeObserver is unavailable. Hidden containers wait for a measurable width.
