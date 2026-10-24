import { ThemeIdentity } from '../../theme/integration';
import { HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, finalize, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const base = environment.apiBaseUrl;
  if (!request.url.startsWith(`${base}/`) && request.url !== base) return next(request);
  const auth = inject(AuthService);
  const identity = inject(ThemeIdentity);
  const revision = identity.snapshot();
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const headers =
    write && auth.csrfToken()
      ? request.headers.set('X-CSRF-Token', auth.csrfToken())
      : request.headers;
  return next(request.clone({ withCredentials: true, headers })).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) identity.recordResult(event.body, revision);
    }),
    catchError((error) => {
      identity.recordResult(error, revision);
      if (
        identity.isCurrent(revision) &&
        error.status === 401 &&
        auth.user() &&
        !request.url.endsWith('/auth/login') &&
        (error.headers?.get('X-Kida-Session-Expired') === 'true' ||
          (!(request.url.endsWith('/admins') && request.method === 'POST') &&
            !request.url.endsWith('/admins/me/password')))
      )
        return throwError(() => error).pipe(
          finalize(() => {
            if (identity.isCurrent(revision)) auth.expired();
          }),
        );
      return throwError(() => error);
    }),
  );
};
