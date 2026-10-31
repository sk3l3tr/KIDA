import {
  AfterRenderRef,
  Injectable,
  Injector,
  OnDestroy,
  afterNextRender,
  inject,
} from '@angular/core';
import { NativeDialogService } from '../../../services/native-dialog.service';

@Injectable()
export class DockerConfirmationService implements OnDestroy {
  private readonly dialogs = inject(NativeDialogService);
  private readonly injector = inject(Injector);
  private opening?: AfterRenderRef;
  private focus?: { trigger: Element | null; isCurrent: () => boolean };

  dialog: () => HTMLDialogElement | undefined = () => undefined;
  heading: () => HTMLElement | undefined = () => undefined;

  captureFocus(isCurrent: () => boolean): void {
    this.invalidate();
    this.focus = { trigger: this.dialogs.captureFocus(), isCurrent };
  }

  open(deferred: boolean, isCurrent: () => boolean, onFailure: () => void): void {
    this.opening?.destroy();
    const show = () => {
      this.opening = undefined;
      if (!isCurrent()) return;
      try {
        this.dialogs.open(this.dialog());
      } catch {
        onFailure();
      }
    };
    // Apply the lower modal's focusTrap binding before opening the native dialog.
    if (deferred) this.opening = afterNextRender(show, { injector: this.injector });
    else show();
  }

  isOpen(): boolean {
    return this.dialog()?.open === true;
  }

  close(): void {
    this.opening?.destroy();
    this.opening = undefined;
    this.dialogs.close(this.dialog());
  }

  invalidate(): void {
    this.focus = undefined;
    this.close();
  }

  trapFocus(event: KeyboardEvent, cancel: () => void): void {
    if (event.key === 'Escape' && this.isOpen()) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    this.dialogs.trapFocus(event, this.dialog());
  }

  restoreFocus(): void {
    const focus = this.focus;
    if (!focus?.trigger) return;
    this.dialogs.restoreFocus(
      this.injector,
      focus.trigger,
      () => this.heading(),
      () => this.focus === focus && focus.isCurrent(),
    );
  }

  ngOnDestroy(): void {
    this.invalidate();
  }
}
