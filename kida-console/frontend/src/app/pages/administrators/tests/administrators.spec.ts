import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, ElementRef, TemplateRef, contentChild, inject, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonToolbar,
} from '@ionic/angular/standalone';
import { Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { AuthService } from '../../../auth/auth.service';
import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { Administrators } from '../administrators';
import { SidePanel } from '../../../components/side-panel/side-panel';

const session = { user: { id: 1, username: 'admin' }, csrf_token: 'csrf-token' };

// Simulate Ionic presentation; keep the real SidePanel and projected forms.
@Component({
  selector: 'ion-modal',
  imports: [NgTemplateOutlet],
  template: '@if (isOpen()) { <ng-container [ngTemplateOutlet]="content() ?? null" /> }',
})
class TestAdministratorModal {
  readonly isOpen = input(false);
  readonly focusTrap = input(true);
  readonly enterAnimation = input<unknown>();
  readonly leaveAnimation = input<unknown>();
  readonly content = contentChild(TemplateRef);
  private readonly host = inject(ElementRef<HTMLElement>);
  dismiss(): void {
    this.host.nativeElement.dispatchEvent(new CustomEvent('didDismiss'));
  }
}

describe('Administrators page', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Administrators],
      providers: [
        ...appConfig.providers,
        provideHttpClientTesting(),
        {
          provide: ArcaService,
          useFactory: () => ({
            actions: inject(ArcaActionsService),
            panels: inject(ArcaPanelsService),
            modals: inject(ArcaModalService),
          }),
        },
        { provide: ArcaPanelsService, useValue: { showLoader: vi.fn(), hideLoader: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(SidePanel, {
      remove: { imports: [IonicModule] },
      add: {
        imports: [TestAdministratorModal, IonButton, IonButtons, IonContent, IonHeader, IonToolbar],
      },
    });
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('refreshes a cached view and last-account controls on each Ionic entry', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const second = { id: 2, username: 'second' };
    const accounts = vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user, second]));
    const fixture = TestBed.createComponent(Administrators);
    const view = fixture.componentInstance.state;
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.accounts-list .danger').disabled).toBe(false);
    view.currentPassword = 'unfinished';
    view.newPassword = 'new-password';
    view.confirmPassword = 'new-password';
    view.createPassword = 'create-password';
    view.adminPassword = 'admin-password';
    view.pendingDelete.set(second);
    fixture.componentInstance.ionViewWillLeave();
    expect([
      view.currentPassword,
      view.newPassword,
      view.confirmPassword,
      view.createPassword,
      view.adminPassword,
    ]).toEqual(['', '', '', '', '']);
    expect(view.pendingDelete()).toBeNull();
    auth.user.set({ id: 1, username: 'renamed' });
    accounts.mockReturnValue(of([auth.user()!]));
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(view.ownUsername).toBe('renamed');
    expect(accounts).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('.accounts-list .danger').disabled).toBe(true);
  });

  it('clears state on session changes and discards responses from the previous account', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const oldAccounts = new Subject<{ id: number; username: string }[]>();
    const second = { id: 2, username: 'second' };
    vi.spyOn(auth, 'accounts')
      .mockReturnValueOnce(oldAccounts)
      .mockReturnValue(of([second]));
    const fixture = TestBed.createComponent(Administrators);
    const view = fixture.componentInstance.state;
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    view.currentPassword = 'old-secret';
    view.createUsername = 'unfinished';
    view.pendingDelete.set(session.user);
    auth.user.set(second);
    fixture.detectChanges();
    expect(view.ownUsername).toBe('second');
    expect(view.currentPassword).toBe('');
    expect(view.createUsername).toBe('');
    expect(view.pendingDelete()).toBeNull();
    oldAccounts.next([session.user]);
    expect(view.accounts()).toEqual([second]);
    auth.user.set(null);
    fixture.detectChanges();
    expect(view.ownUsername).toBe('');
    expect(view.accounts()).toEqual([]);
  });

  it('discards pending operation results when the administrators view leaves', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const creation = new Subject<{ id: number; username: string }>();
    vi.spyOn(auth, 'create').mockReturnValue(creation);
    const fixture = TestBed.createComponent(Administrators);
    const view = fixture.componentInstance.state;
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    view.create();
    expect(view.busy()).toBe(true);
    fixture.componentInstance.ionViewWillLeave();
    creation.next({ id: 2, username: 'second' });
    expect(view.busy()).toBe(false);
    expect(view.message()).toBe('');
    expect(view.accounts()).toEqual([]);
    expect(auth.accounts).toHaveBeenCalledOnce();
  });

  it('lists administrators, disables last-account deletion and submits reauthentication', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const create = vi.spyOn(auth, 'create').mockReturnValue(of({ id: 2, username: 'second' }));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.accounts-list .danger').disabled).toBe(true);
    const view = fixture.componentInstance.state;
    view.createUsername = 'second';
    view.createPassword = 'password-two';
    view.adminUsername = 'admin';
    view.adminPassword = 'current-password';
    view.create();
    expect(create).toHaveBeenCalledWith({
      username: 'second',
      password: 'password-two',
      admin_username: 'admin',
      admin_password: 'current-password',
    });
    expect(view.adminPassword).toBe('');
    expect(view.createPassword).toBe('');
  });

  it('requires explicit confirmation before deleting an account', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const second = { id: 2, username: 'second' };
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user, second]));
    const remove = vi.spyOn(auth, 'delete').mockReturnValue(of(undefined));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    const dialogs = mockArcaDialogs();
    const buttons = fixture.nativeElement.querySelectorAll('.accounts-list .danger');
    buttons[1].click();
    fixture.detectChanges();
    expect(remove).not.toHaveBeenCalled();
    expect(dialogs.element!.textContent).toContain('second');
    dialogs.choose();
    expect(remove).toHaveBeenCalledWith(2);
  });

  it('submits the extracted profile forms and clears passwords after failure', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const rename = vi.spyOn(auth, 'rename').mockReturnValue(of({ id: 1, username: 'renamed' }));
    const passwordResult = new Subject<void>();
    const password = vi.spyOn(auth, 'password').mockReturnValue(passwordResult);
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    const setInput = (id: string, value: string) => {
      const input = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    fixture.componentInstance.state.openPanel('rename');
    fixture.detectChanges();
    await fixture.whenStable();
    setInput('own-username', 'renamed');
    fixture.detectChanges();
    await fixture.whenStable();
    const forms = fixture.nativeElement.querySelectorAll('app-administrator-profile form');
    forms[0].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(rename).toHaveBeenCalledWith('renamed');
    fixture.componentInstance.state.openPanel('password');
    fixture.detectChanges();
    await fixture.whenStable();
    setInput('current-password', 'current-password');
    setInput('new-password', 'replacement-password');
    setInput('confirm-password', 'replacement-password');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement
      .querySelector('#password-account-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(password).toHaveBeenCalledWith('current-password', 'replacement-password');
    passwordResult.error(new HttpErrorResponse({ status: 422 }));
    fixture.detectChanges();
    await fixture.whenStable();
    for (const id of ['current-password', 'new-password', 'confirm-password'])
      expect(fixture.nativeElement.querySelector(`#${id}`).value).toBe('');
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
      'Revisa los datos',
    );
  });

  it('submits reauthentication from the extracted create form and clears its passwords', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const creation = new Subject<{ id: number; username: string }>();
    const create = vi.spyOn(auth, 'create').mockReturnValue(creation);
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.state.openPanel('create');
    fixture.detectChanges();
    await fixture.whenStable();
    for (const [id, value] of [
      ['create-username', 'second'],
      ['create-password', 'new-account-password'],
      ['admin-username', 'admin'],
      ['admin-password', 'current-password'],
    ]) {
      const input = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement
      .querySelector('app-administrator-create-form form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(create).toHaveBeenCalledWith({
      username: 'second',
      password: 'new-account-password',
      admin_username: 'admin',
      admin_password: 'current-password',
    });
    creation.error(new HttpErrorResponse({ status: 429 }));
    fixture.detectChanges();
    await fixture.whenStable();
    for (const id of ['create-password', 'admin-password'])
      expect(fixture.nativeElement.querySelector(`#${id}`).value).toBe('');
    expect(fixture.componentInstance.state.createUsername).toBe('second');
  });

  it('shows the list and account summary, and only mounts the selected editor', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.administrators-grid')?.children).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('app-administrator-list')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-administrator-profile')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    fixture.nativeElement.querySelector('.create-administrator').click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('form')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('#create-account-form')).toBeTruthy();
    expect(fixture.debugElement.query(By.directive(SidePanel)).componentInstance.open()).toBe(true);
    fixture.nativeElement.querySelector('ion-modal').dispatchEvent(new CustomEvent('didDismiss'));
    fixture.detectChanges();
    expect(fixture.componentInstance.state.panel()).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).toBeNull();
  });

  it('keeps initial read failures distinct from an empty list and retries once', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const initial = new Subject<(typeof session.user)[]>();
    const accounts = vi
      .spyOn(auth, 'accounts')
      .mockReturnValueOnce(initial)
      .mockReturnValue(of([session.user]));
    const fixture = TestBed.createComponent(Administrators);
    const state = fixture.componentInstance.state;
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    expect(state.loading()).toBe(true);
    expect(fixture.nativeElement.querySelector('.account-count').textContent).toBe('—');
    state.retryLoad();
    expect(accounts).toHaveBeenCalledOnce();
    initial.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();
    expect(state.loading()).toBe(false);
    expect(state.loaded()).toBe(false);
    expect(fixture.nativeElement.querySelector('app-administrator-list')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('lectura anterior');
    fixture.nativeElement.querySelector('.list-status button').click();
    fixture.detectChanges();
    expect(state.loaded()).toBe(true);
    expect(state.listError()).toBe('');
    expect(accounts).toHaveBeenCalledTimes(2);
  });

  it('keeps a confirmed write separate from a failed refresh and retains previous accounts', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const refresh = new Subject<(typeof session.user)[]>();
    const accounts = vi
      .spyOn(auth, 'accounts')
      .mockReturnValueOnce(of([session.user]))
      .mockReturnValue(refresh);
    vi.spyOn(auth, 'create').mockReturnValue(of({ id: 2, username: 'second' }));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    state.openPanel('create');
    state.create();
    expect(state.panel()).toBeNull();
    expect(state.message()).toBe('Administrador creado.');
    expect(state.loading()).toBe(true);
    refresh.error(new HttpErrorResponse({ status: 500 }));
    fixture.detectChanges();
    expect(state.message()).toBe('Administrador creado.');
    expect(state.error()).toBe('');
    expect(state.listError()).not.toBe('');
    expect(state.accounts()).toEqual([session.user]);
    expect(fixture.nativeElement.textContent).toContain('lectura anterior');
    expect(accounts).toHaveBeenCalledTimes(2);
  });

  it('clears cancelled credentials without clearing the list or cancelling a sent write', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const read = vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const creation = new Subject<typeof session.user>();
    const create = vi.spyOn(auth, 'create').mockReturnValue(creation);
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    state.openPanel('create');
    state.createUsername = 'second';
    state.createPassword = 'new-account-password';
    state.adminPassword = 'current-password';
    state.create();
    state.closePanel();
    expect([state.createPassword, state.adminPassword, state.createUsername]).toEqual(['', '', '']);
    expect(state.accounts()).toEqual([session.user]);
    expect(state.busy()).toBe(true);
    state.openPanel('password');
    state.create();
    state.retryLoad();
    expect(state.panel()).toBeNull();
    expect(create).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledOnce();
    creation.next({ id: 2, username: 'second' });
    creation.complete();
    expect(state.busy()).toBe(false);
    expect(state.message()).toBe('Administrador creado.');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reports a failure on the page when its editor was closed during submission', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const creation = new Subject<typeof session.user>();
    vi.spyOn(auth, 'create').mockReturnValue(creation);
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    state.openPanel('create');
    state.create();
    state.closePanel();
    creation.error(new HttpErrorResponse({ status: 409 }));
    expect(state.error()).not.toBe('');
    expect(state.formError()).toBe('');
    expect(state.busy()).toBe(false);
    expect(state.accounts()).toEqual([session.user]);
  });

  it('validates the create form and submits through the projected footer button', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const create = vi
      .spyOn(auth, 'create')
      .mockReturnValue(of({ id: 2, username: 'valid-name_1.2' }));
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    fixture.componentInstance.state.openPanel('create');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const save = fixture.nativeElement.querySelector(
      'button[form="create-account-form"]',
    ) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const fill = async (id: string, value: string) => {
      const input = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await fill('create-username', 'invalid name');
    await fill('create-password', 'new-account-password');
    await fill('admin-password', 'current-password');
    expect(save.disabled).toBe(true);
    await fill('create-username', 'valid-name_1.2');
    expect(save.disabled).toBe(false);
    save.click();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith({
      username: 'valid-name_1.2',
      password: 'new-account-password',
      admin_username: 'admin',
      admin_password: 'current-password',
    });
    expect(fixture.componentInstance.state.panel()).toBeNull();
  });

  it('prevents unchanged renames and explains mismatched passwords without sending', async () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const password = vi.spyOn(auth, 'password');
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    state.openPanel('rename');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[form="rename-account-form"]').disabled).toBe(
      true,
    );
    state.closePanel();
    fixture.detectChanges();
    state.openPanel('password');
    fixture.detectChanges();
    await fixture.whenStable();
    for (const [id, value] of [
      ['current-password', 'current-password'],
      ['new-password', 'replacement-password'],
      ['confirm-password', 'different-password'],
    ]) {
      const input = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#password-mismatch').textContent).toContain(
      'no coinciden',
    );
    expect(
      fixture.nativeElement.querySelector('button[form="password-account-form"]').disabled,
    ).toBe(true);
    fixture.nativeElement
      .querySelector('#password-account-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(password).not.toHaveBeenCalled();
    state.closePanel();
    expect([state.currentPassword, state.newPassword, state.confirmPassword]).toEqual(['', '', '']);
  });

  it('closes an open editor on identity changes and ignores its pending result', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user]));
    const creation = new Subject<typeof session.user>();
    vi.spyOn(auth, 'create').mockReturnValue(creation);
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    state.openPanel('create');
    state.createPassword = 'old-password';
    state.create();
    auth.user.set({ id: 2, username: 'another' });
    fixture.detectChanges();
    expect(state.panel()).toBeNull();
    expect(state.createPassword).toBe('');
    creation.next({ id: 3, username: 'late' });
    creation.complete();
    expect(state.message()).toBe('');
    expect(state.busy()).toBe(false);
  });

  it('cleans up credentials, pending confirmation and reads when the page is destroyed', () => {
    const auth = TestBed.inject(AuthService);
    auth.user.set(session.user);
    const second = { id: 2, username: 'second' };
    const accounts = vi.spyOn(auth, 'accounts').mockReturnValue(of([session.user, second]));
    const remove = vi.spyOn(auth, 'delete').mockReturnValue(of(undefined));
    const dialogs = mockArcaDialogs();
    const fixture = TestBed.createComponent(Administrators);
    fixture.componentInstance.ionViewWillEnter();
    fixture.detectChanges();
    const state = fixture.componentInstance.state;
    state.currentPassword = 'current-password';
    state.newPassword = 'replacement-password';
    state.confirmPassword = 'replacement-password';
    state.createPassword = 'new-account-password';
    state.adminPassword = 'current-password';
    state.prepareDelete(second);
    expect(state.pendingDelete()?.id).toBe(second.id);
    fixture.destroy();
    expect(state.pendingDelete()).toBeNull();
    expect(state.accounts()).toEqual([]);
    expect([
      state.currentPassword,
      state.newPassword,
      state.confirmPassword,
      state.createPassword,
      state.adminPassword,
    ]).toEqual(['', '', '', '', '']);
    expect(dialogs.element).toBeNull();
    auth.user.set(second);
    TestBed.tick();
    expect(accounts).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });
});
