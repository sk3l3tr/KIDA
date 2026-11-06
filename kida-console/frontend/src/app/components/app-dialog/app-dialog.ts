import {
  AfterViewChecked,
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ArcaService } from 'arca';
import { Subscription, take } from 'rxjs';
import { APP_DIALOG_CANCEL, APP_DIALOG_OPEN, AppDialogConfig } from './app-dialog.models';

@Component({
  selector: 'app-dialog',
  templateUrl: './app-dialog.html',
  styleUrl: './app-dialog.scss',
})
export class AppDialog implements OnInit, AfterViewInit, AfterViewChecked, OnDestroy {
  private readonly arca = inject(ArcaService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private focused = false;
  private readonly subscriptions = new Subscription();
  private modalElement: HTMLElement | null = null;
  private focusTimer?: ReturnType<typeof setTimeout>;
  private readonly presented = () => {
    clearTimeout(this.focusTimer);
    // ARCA delivers configuration after present(); let Ionic and the template finish first.
    this.focusTimer = setTimeout(() => {
      this.focused = false;
      this.focusCancel();
    });
  };
  private readonly dismissing = () => {
    const config = this.config();
    if (!config || this.closing()) return;
    this.closing.set(true);
    // ARCA publishes this public result when Ionic finishes a backdrop/Escape dismissal.
    this.arca.modals.actionSentData = { option: 'cancel', data: { context: config.context } };
  };
  readonly config = signal<AppDialogConfig | null>(null);
  readonly closing = signal(false);
  readonly paragraphs = computed(() => {
    const text = this.config()?.text;
    return typeof text === 'string' ? [text] : (text ?? []);
  });

  ngOnInit(): void {
    this.subscriptions.add(
      this.arca.actions
        .listenAction(APP_DIALOG_OPEN)
        .pipe(take(1))
        .subscribe((config: AppDialogConfig) => {
          this.config.set(config);
          this.labelDialog();
          this.presented();
          this.arca.actions.cleanActions([APP_DIALOG_OPEN]);
          this.subscriptions.add(
            this.arca.actions.listenAction(APP_DIALOG_CANCEL).subscribe((context: string) => {
              if (context === config.context) this.choose('cancel');
            }),
          );
        }),
    );
  }

  ngAfterViewInit(): void {
    this.modalElement = this.host.closest('ion-modal');
    this.modalElement?.classList.add('app-dialog-modal');
    this.modalElement?.setAttribute('aria-labelledby', 'app-dialog-title');
    this.labelDialog();
    this.modalElement?.addEventListener('ionModalWillDismiss', this.dismissing);
    this.modalElement?.addEventListener('ionModalDidPresent', this.presented);
  }

  private labelDialog(): void {
    const title = this.config()?.title;
    if (title)
      this.modalElement?.shadowRoot
        ?.querySelector('[part="content"]')
        ?.setAttribute('aria-label', title);
  }

  ngAfterViewChecked(): void {
    this.focusCancel();
  }

  private focusCancel(): void {
    if (this.focused || this.closing() || !this.config() || !this.host.isConnected) return;
    const button =
      this.host.querySelector<HTMLButtonElement>('[data-dialog-option="cancel"]') ??
      this.host.querySelector<HTMLButtonElement>('button');
    if (!button) return;
    this.focused = true;
    button.focus({ preventScroll: true });
  }

  choose(option: string): void {
    const config = this.config();
    if (!config || this.closing()) return;
    this.closing.set(true);
    this.arca.modals.closeModal(option, { context: config.context });
  }

  ngOnDestroy(): void {
    clearTimeout(this.focusTimer);
    this.modalElement?.removeEventListener('ionModalWillDismiss', this.dismissing);
    this.modalElement?.removeEventListener('ionModalDidPresent', this.presented);
    this.subscriptions.unsubscribe();
    this.config.set(null);
    this.host.replaceChildren();
  }
}
