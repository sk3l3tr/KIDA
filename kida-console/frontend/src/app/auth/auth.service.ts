import { ThemeIdentity } from '../../theme/integration';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, EMPTY, defer, catchError, map, of, switchMap, tap, throwError } from 'rxjs';
import { ArcaRequestService } from '../services/arca-request.service';

export interface Account {
  id: number;
  username: string;
}
interface Session {
  user: Account;
  csrf_token: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly requests = inject(ArcaRequestService);
  private readonly router = inject(Router);

  private readonly themeIdentity = inject(ThemeIdentity);

  readonly user = signal<Account | null>(null);
  readonly csrfToken = signal('');

  restore(): Observable<boolean> {
    return defer(() => {
      const revision = this.themeIdentity.begin();
      return this.request<Session>('SESSION').pipe(
        tap((session) => this.themeIdentity.confirm(revision, session.user.id)),
        tap((session) => this.accept(session)),
        map(() => true),
        catchError((error) => {
          if (!this.themeIdentity.isCurrent(revision)) return EMPTY;
          if (error.status !== 401) return throwError(() => error);
          this.themeIdentity.confirm(revision, null);
          this.clear();
          return of(false);
        }),
      );
    });
  }

  login(username: string, password: string): Observable<Session> {
    return defer(() => {
      const revision = this.themeIdentity.begin();
      return this.request<{ csrf_token: string }>('CSRF').pipe(
        tap((value) => this.csrfToken.set(value.csrf_token)),
        switchMap(() => this.request<Session>('LOGIN', { username, password })),
        tap((session) => this.themeIdentity.confirm(revision, session.user.id)),
        tap((session) => this.accept(session)),
        catchError((error) =>
          this.themeIdentity.isCurrent(revision) ? throwError(() => error) : EMPTY,
        ),
      );
    });
  }

  logout(): Observable<void> {
    return this.request<void>('LOGOUT').pipe(tap(() => this.expired()));
  }

  accounts(): Observable<Account[]> {
    return this.request<Account[]>('ACCOUNTS');
  }

  create(body: {
    username: string;
    password: string;
    admin_username: string;
    admin_password: string;
  }): Observable<Account> {
    return this.request<Account>('CREATE_ACCOUNT', body);
  }

  rename(username: string): Observable<Account> {
    return this.request<Account>('RENAME_ACCOUNT', { username }).pipe(
      tap((user) => this.user.set(user)),
    );
  }

  password(current_password: string, password: string): Observable<void> {
    return this.request<void>('CHANGE_PASSWORD', { current_password, password }).pipe(
      tap(() => this.expired('password')),
    );
  }

  delete(id: number): Observable<void> {
    return this.request<void>('DELETE_ACCOUNT', { id }).pipe(
      tap(() => {
        if (this.user()?.id === id) this.expired('deleted');
      }),
    );
  }

  expired(reason = 'expired'): void {
    this.themeIdentity.clear();
    this.clear();
    // ARCA's second argument is navigation data, not Angular NavigationExtras.
    void this.router.navigate(['/login'], { queryParams: { reason } });
  }

  private request<T>(action: string, body = {}): Observable<T> {
    return this.requests.request<T>(action, body);
  }

  private clear(): void {
    this.user.set(null);
    this.csrfToken.set('');
  }
  private accept(session: Session): void {
    this.user.set(session.user);
    this.csrfToken.set(session.csrf_token);
  }
}
