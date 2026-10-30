import { Injectable, inject } from '@angular/core';
import { ArcaRxService, ArcaService } from 'arca';
import { Observable, filter, map, merge, take } from 'rxjs';

/**
 * Minimal, intentionally permissive adapter between ARCA actions and RxJS.
 *
 * Design decisions (intentional, not missing safeguards):
 *
 * - ARCA is a shared, untyped reactive store where the last published
 *   value for an action wins.
 * - This service dispatches ACTION_REQUEST and returns an Observable
 *   that completes on the first subsequent ACTION_RESPONSE or ACTION_ERROR.
 * - No request IDs, concurrency locks, deduplication, or response
 *   correlation are implemented by design.
 * - Concurrent requests sharing an action may receive the same response.
 *   Managing action identifiers and collisions is the developer's responsibility.
 * - Response values remain in ARCA's store. Consumer unsubscription
 *   stops listening but does not cancel an HTTP operation owned by ARCA.
 *
 * IMPORTANT FOR MAINTAINERS AND CODING AGENTS:
 * Do not introduce defensive state management, concurrency restrictions,
 * or request correlation without an explicit architectural requirement.
 * This simplicity and flexibility are deliberate ARCA design principles.
 */
@Injectable({ providedIn: 'root' })
export class ArcaRequestService {
  private readonly arca = inject(ArcaService);
  private readonly rx = inject(ArcaRxService);

  request<T>(action: string, body: unknown = {}): Observable<T> {
    return new Observable<T>((observer) => {
      let dispatched = false;

      const subscription = merge(
        this.rx.listen<T>(`${action}_RESPONSE`).pipe(map((value) => ({ value, failed: false }))),
        this.arca.actions
          .listenAction(`${action}_ERROR`)
          .pipe(map((value) => ({ value, failed: true }))),
      )
        .pipe(
          filter(() => dispatched),
          take(1),
        )
        .subscribe(({ value, failed }) => {
          if (failed) {
            observer.error(value);
          } else {
            observer.next(value as T);
            observer.complete();
          }
        });

      try {
        dispatched = true;
        this.arca.actions.dispatchAction(`${action}_REQUEST`, body);
      } catch (error) {
        observer.error(error);
      } finally {
        // Evita retener credenciales u otros datos de la petición.
        this.arca.actions.cleanActions([`${action}_REQUEST`]);
      }

      return () => subscription.unsubscribe();
    });
  }
}
