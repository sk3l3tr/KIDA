export const APP_DIALOG_OPEN = 'APP_DIALOG_OPEN';
export const APP_DIALOG_CANCEL = 'APP_DIALOG_CANCEL';

let nextContext = 0;
export function newDialogContext(): string {
  return String(++nextContext);
}

export interface AppDialogButton {
  readonly id: string;
  readonly text: string;
  readonly icon?: string;
  readonly style?: 'secondary' | 'danger';
}

export interface AppDialogConfig {
  readonly context: string;
  readonly title: string;
  readonly text: string | readonly string[];
  readonly type: 'info' | 'warning' | 'danger' | 'confirmation' | 'custom';
  readonly buttons: readonly AppDialogButton[];
}

export interface AppDialogResult {
  readonly option: string;
  readonly data: { readonly context: string };
}
