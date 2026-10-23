import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const base = environment.apiBaseUrl;
  if (!request.url.startsWith(`${base}/`) && request.url !== base) return next(request);
  const auth = inject(AuthService);
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const headers =
    write && auth.csrfToken()
      ? request.headers.set('X-CSRF-Token', auth.csrfToken())
      : request.headers;
  return next(request.clone({ withCredentials: true, headers })).pipe(
    catchError((error) => {
      if (
        error.status === 401 &&
        auth.user() &&
        !request.url.endsWith('/auth/login') &&
        (error.headers?.get('X-Kida-Session-Expired') === 'true' ||
          (!(request.url.endsWith('/admins') && request.method === 'POST') &&
            !request.url.endsWith('/admins/me/password')))
      )
        auth.expired();
      return throwError(() => error);
    }),
  );
};
