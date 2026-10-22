import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let http: HttpTestingController;
  const healthUrl = `${environment.apiBaseUrl}/health`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(HealthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('gets the health response from the API', () => {
    const next = vi.fn();
    service.getHealth().subscribe(next);

    const request = http.expectOne(healthUrl);
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'OK' });

    expect(next).toHaveBeenCalledExactlyOnceWith({ status: 'OK' });
  });

  it('propagates HTTP errors to the consumer', () => {
    const next = vi.fn();
    const error = vi.fn();
    service.getHealth().subscribe({ next, error });

    http.expectOne(healthUrl).flush('Unavailable', {
      status: 503,
      statusText: 'Service Unavailable',
    });

    expect(next).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.any(HttpErrorResponse));
    expect(error.mock.calls[0][0].status).toBe(503);
  });
});
