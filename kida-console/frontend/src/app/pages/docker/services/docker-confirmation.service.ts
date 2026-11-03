import { DOCUMENT } from '@angular/common';
import {
  AfterRenderRef,
  ApplicationRef,
  ComponentRef,
  ElementRef,
  EnvironmentInjector,
  Injectable,
  Injector,
  OnDestroy,
  afterNextRender,
  createComponent,
  inject,
} from '@angular/core';
import { NativeDialogService } from '../../../services/native-dialog.service';
import { DockerConfirmation } from '../components/docker-confirmation/docker-confirmation';
import { PendingContainer } from '../utils/docker.models';

export interface DockerConfirmationSession {
  present(): Promise<boolean>;
  cancel(): void;
  restoreFocus(): void;
}

@Injectable()
export class DockerConfirmationService implements OnDestroy {
  private readonly dialogs = inject(NativeDialogService);
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly environment = inject(EnvironmentInjector);
  private readonly application = inject(ApplicationRef);
  private component?: ComponentRef<DockerConfirmation>;
  private session?: ConfirmationSession;

  prepare(
    pending: PendingContainer,
    isCurrent: () => boolean,
    deferred = false,
  ): DockerConfirmationSession {
    this.session?.cancel();
    const component = this.presentation();
    const trigger = this.dialogs.captureFocus();
    const fallback = Array.from(
      this.document.querySelectorAll<HTMLElement>('[data-docker-heading]'),
    ).find((heading) => !heading.closest('.ion-page-hidden'));
    const session = new ConfirmationSession(
      this.dialogs,
      this.injector,
      component,
      trigger,
      fallback,
      pending,
      isCurrent,
      deferred,
    );
    this.session = session;
    return session;
  }

  private presentation(): ComponentRef<DockerConfirmation> {
    if (!this.component) {
      const hostElement = this.document.createElement('app-docker-confirmation');
      this.component = createComponent(DockerConfirmation, {
        hostElement,
        environmentInjector: this.environment,
      });
      this.application.attachView(this.component.hostView);
      this.host.append(hostElement);
      this.component.changeDetectorRef.detectChanges();
    }
    return this.component;
  }

  ngOnDestroy(): void {
    this.session?.cancel();
    if (this.component) {
      this.application.detachView(this.component.hostView);
      this.component.destroy();
      this.component.location.nativeElement.remove();
      this.component = undefined;
    }
  }
}

class ConfirmationSession implements DockerConfirmationSession {
  private cancelled = false;
  private settled = false;
  private opening?: AfterRenderRef;
  private result?: Promise<boolean>;
  private resolve?: (confirmed: boolean) => void;
  private reject?: (failure: unknown) => void;
  private focusRevision = 0;
  private readonly listeners: { unsubscribe(): void }[] = [];

  constructor(
    private readonly dialogs: NativeDialogService,
    private readonly injector: Injector,
    private readonly component: ComponentRef<DockerConfirmation>,
    private readonly trigger: Element | null,
    private readonly fallback: HTMLElement | undefined,
    private readonly pending: PendingContainer,
    private readonly isCurrent: () => boolean,
    private readonly deferred: boolean,
  ) {}

  present(): Promise<boolean> {
    if (this.result) return this.result;
    if (!this.valid()) return (this.result = Promise.resolve(false));
    this.result = new Promise<boolean>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.component.setInput('pending', this.pending);
    this.component.changeDetectorRef.detectChanges();
    this.listeners.push(
      this.component.instance.resolved.subscribe((accepted) => this.finish(accepted)),
      this.component.instance.keydown.subscribe((event) => {
        if (event.key === 'Escape' && this.dialog.open) {
          event.preventDefault();
          event.stopPropagation();
          this.finish(false);
        } else this.dialogs.trapFocus(event, this.dialog);
      }),
    );
    const open = () => {
      this.opening = undefined;
      if (!this.valid()) {
        this.finish(false);
        return;
      }
      try {
        this.dialogs.open(this.dialog);
      } catch (failure) {
        this.finish(false, failure);
      }
    };
    // Ionic must apply the lower panel's focusTrap binding before opening the dialog.
    if (this.deferred) this.opening = afterNextRender(open, { injector: this.injector });
    else open();
    return this.result;
  }

  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.result ??= Promise.resolve(false);
    this.finish(false);
  }

  restoreFocus(): void {
    if (!this.valid()) return;
    const revision = ++this.focusRevision;
    this.dialogs.restoreFocus(
      this.injector,
      this.trigger,
      () => this.fallback,
      () => this.valid() && revision === this.focusRevision,
    );
  }

  private get dialog(): HTMLDialogElement {
    return this.component.instance.dialog().nativeElement;
  }
  private valid(): boolean {
    return !this.cancelled && this.isCurrent();
  }
  private finish(accepted: boolean, failure?: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.opening?.destroy();
    this.opening = undefined;
    const confirmed = this.dialog.open && accepted && this.valid();
    this.dialogs.close(this.dialog);
    this.component.setInput('pending', null);
    this.component.changeDetectorRef.detectChanges();
    for (const listener of this.listeners) listener.unsubscribe();
    this.listeners.length = 0;
    if (failure !== undefined) this.reject?.(failure);
    else this.resolve?.(confirmed);
    this.resolve = undefined;
    this.reject = undefined;
  }
}
