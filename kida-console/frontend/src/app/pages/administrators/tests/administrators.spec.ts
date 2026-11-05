import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { By } from '@angular/platform-browser';
import { HttpErrorResponse } from '@angular/common/http';
import { Subject, of } from 'rxjs';
import { ArcaActionsService, ArcaModalService, ArcaPanelsService, ArcaService } from 'arca';
import { appConfig } from '../../../app.config';
import { AuthService } from '../../../auth/auth.service';
import { mockArcaDialogs } from '../../../components/app-dialog/app-dialog.testing';
import { Administrators } from '../administrators';
import { Masonry, MasonryItem } from '../../../components/masonry/masonry';

const session = { user: { id: 1, username: 'admin' }, csrf_token: 'csrf-token' };

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
    setInput('own-username', 'renamed');
    const forms = fixture.nativeElement.querySelectorAll('app-administrator-profile form');
    forms[0].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(rename).toHaveBeenCalledWith('renamed');
    setInput('current-password', 'current-password');
    setInput('new-password', 'replacement-password');
    setInput('confirm-password', 'replacement-password');
    fixture.detectChanges();
    await fixture.whenStable();
    forms[1].dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
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

  it('keeps all three panel sections directly available to Masonry', () => {
    const fixture = TestBed.createComponent(Administrators);
    fixture.detectChanges();
    const masonry = fixture.debugElement.query(By.directive(Masonry));
    const panels = masonry.queryAll(By.directive(MasonryItem));
    expect(panels).toHaveLength(3);
    for (const panel of panels) {
      expect(panel.nativeElement.tagName).toBe('SECTION');
      expect(panel.nativeElement.parentElement).toBe(masonry.nativeElement);
    }
    expect(fixture.nativeElement.querySelector('app-administrator-profile')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-administrator-list')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-administrator-create-form')).toBeTruthy();
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
