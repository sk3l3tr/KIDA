import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  catchError,
  finalize,
  map,
  merge,
  of,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';
import { ArcaRxService, ArcaService } from 'arca';

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
  private readonly arca = inject(ArcaService);
  private readonly arcaRx = inject(ArcaRxService);
  private readonly router = inject(Router);

  readonly user = signal<Account | null>(null);
  readonly csrfToken = signal('');

  restore(): Observable<boolean> {
    return this.request<Session>('SESSION').pipe(
      tap((session) => this.accept(session)),
      map(() => true),
      catchError((error) => {
        if (error.status !== 401) return throwError(() => error);
        this.clear();
        return of(false);
      }),
    );
  }

  login(username: string, password: string): Observable<Session> {
    return this.request<{ csrf_token: string }>('CSRF').pipe(
      tap((value) => this.csrfToken.set(value.csrf_token)),
      switchMap(() => this.request<Session>('LOGIN', { username, password })),
      tap((session) => this.accept(session)),
    );
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
    this.clear();
    // ARCA's second argument is navigation data, not Angular NavigationExtras.
    void this.router.navigate(['/login'], { queryParams: { reason } });
  }

  private request<T>(action: string, body = {}): Observable<T> {
    const request = `${action}_REQUEST`;
    const response = `${action}_RESPONSE`;
    const error = `${action}_ERROR`;
    return new Observable<T>((subscriber) => {
      // ARCA retains the last payload, so discard previous results before listening.
      this.arca.actions.cleanActions([response, error]);
      const subscription = merge(
        // listenAction filters out null, including successful HTTP 204 responses.
        this.arcaRx.listen<T>(response),
        this.arca.actions
          .listenAction(error)
          .pipe(switchMap((failure) => throwError(() => failure))),
      )
        .pipe(
          take(1),
          finalize(() => this.arca.actions.cleanActions([response, error])),
        )
        .subscribe(subscriber);
      try {
        this.arca.actions.dispatchAction(request, body);
      } finally {
        // Do not retain credentials in ARCA's action store.
        this.arca.actions.cleanActions([request]);
      }
      return subscription;
    });
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
