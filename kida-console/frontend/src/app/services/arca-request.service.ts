import { Injectable, inject } from '@angular/core';
import { ArcaRxService, ArcaService } from 'arca';
import { Observable, filter, finalize, map, merge, take, takeUntil } from 'rxjs';
import { ThemeIdentity } from '../../theme/integration';

export class ChannelBusyError extends Error {
  constructor() {
    super('Hay una petición anterior pendiente. Espera a que termine y actualiza de nuevo.');
  }
}

/** One HTTP exchange per ARCA channel and session; retained results are never replayed. */
@Injectable({ providedIn: 'root' })
export class ArcaRequestService {
  private readonly arca = inject(ArcaService);
  private readonly rx = inject(ArcaRxService);
  private readonly identity = inject(ThemeIdentity);
  private readonly pending = new Set<string>();

  request<T>(action: string, body = {}): Observable<T> {
    return new Observable<T>((subscriber) => {
      const revision = this.identity.snapshot();
      const key = `${revision}:${action}`;
      if (this.pending.has(key)) {
        subscriber.error(new ChannelBusyError());
        return;
      }
      this.pending.add(key);
      const request = `${action}_REQUEST`;
      const response = `${action}_RESPONSE`;
      const error = `${action}_ERROR`;
      this.arca.actions.cleanActions([response, error]);
      let settling = false;
      // Keep draining an abandoned HTTP exchange: ARCA itself owns the HTTP subscription.
      // Releasing its channel early would let its late result satisfy a newer consumer.
      const drain = merge(
        // Unlike listenAction, this also receives successful null/204 responses.
        this.rx.listen<T>(response).pipe(map((value) => ({ value, failed: false }))),
        this.arca.actions.listenAction(error).pipe(map((value) => ({ value, failed: true }))),
      )
        .pipe(
          filter(({ value }) => this.identity.acceptsResult(value, revision)),
          take(1),
          takeUntil(this.identity.changes.pipe(filter(() => !settling))),
          finalize(() => {
            this.pending.delete(key);
            this.arca.actions.cleanActions([response, error]);
          }),
        )
        .subscribe({
          next: ({ value, failed }) => {
            settling = true;
            if (failed) subscriber.error(value);
            else {
              subscriber.next(value as T);
              subscriber.complete();
            }
          },
          complete: () => subscriber.complete(),
        });
      try {
        this.arca.actions.dispatchAction(request, body);
      } catch (failure) {
        drain.unsubscribe();
        subscriber.error(failure);
      } finally {
        // Credentials and other request bodies must not remain in ARCA's store.
        this.arca.actions.cleanActions([request]);
      }
      // Consumer teardown deliberately does not cancel an already sent operation.
    });
  }
}
