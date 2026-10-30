import { HttpErrorResponse } from '@angular/common/http';
import { classifyCoreFailure } from './core-failure';
import { systemFailure } from '../pages/system/utils/system.models';
import { schedulerFailure } from '../pages/scheduler/scheduler-presentation';
import { dockerFailure } from '../pages/docker/utils/docker-presentation';

const failure = (status: number, code?: string, message?: string) =>
  new HttpErrorResponse({ status, error: { detail: { code, message } } });

describe('Shared CORE failure classification', () => {
  it.each(['core_timeout', 'core_transport_error', 'core_http_error', 'core_invalid_response'])(
    'treats %s as uncertain only for writes',
    (code) => {
      const error = failure(502, code, 'details');
      expect(classifyCoreFailure(error, true).kind).toBe('uncertain');
      expect(classifyCoreFailure(error).kind).toBe('other');
    },
  );
  it.each([0, 500, 504])('treats ambiguous HTTP %s writes as uncertain', (status) => {
    expect(classifyCoreFailure(failure(status), true).kind).toBe('uncertain');
  });
  it('keeps domain rejection and unavailable CORE distinct from uncertainty', () => {
    expect(classifyCoreFailure(failure(502, 'core_error', 'Rejected'), true)).toEqual({
      kind: 'rejected',
      message: 'Rejected',
    });
    expect(classifyCoreFailure(failure(503, 'core_unavailable'), true).kind).toBe('unavailable');
    expect(classifyCoreFailure(failure(401), true).kind).toBe('expired');
    expect(classifyCoreFailure(failure(422), true).kind).toBe('validation');
  });
  it.each([undefined, null, 'unexpected', {}, { error: { detail: { message: 42 } } }])(
    'handles an unexpected error without assuming an HTTP envelope: %j',
    (error) => {
      expect(classifyCoreFailure(error)).toEqual({ kind: 'other', message: undefined });
      expect(systemFailure(error)).toBe('No se pudo completar la operación.');
      expect(schedulerFailure(error)).toBe('No se pudo completar la operación.');
    },
  );
  it('preserves each page wording and displays server detail only as a string', () => {
    const error = failure(502, 'core_error', '<b>reason</b>');
    expect(systemFailure(error, true)).toBe('Error: <b>reason</b>');
    expect(schedulerFailure(error, true)).toBe('CORE rechazó la operación: <b>reason</b>');
    expect(systemFailure(failure(502, 'core_error'), true)).toBe(
      'No se pudo completar la operación.',
    );
    expect(schedulerFailure(failure(502, 'core_error'), true)).toBe(
      'CORE rechazó la operación: sin detalles',
    );
    const plain = new HttpErrorResponse({ status: 403, error: { detail: 'CSRF rejected' } });
    expect(systemFailure(plain)).toBe('Error: CSRF rejected');
    expect(schedulerFailure(plain)).toBe('Error: CSRF rejected');
  });
});

describe('Exact page failure messages', () => {
  const pages = [
    [
      systemFailure,
      'Ejecución incierta: no se pudo confirmar el resultado. Comprueba el estado del equipo antes de enviar otra acción.',
      'Datos rechazados por el servidor. Revisa los parámetros y la hora local de CORE.',
      'error',
    ],
    [
      dockerFailure,
      'No se pudo confirmar el resultado. No se reenviará automáticamente. Actualiza contenedores antes de realizar otra acción.',
      'Validación HTTP: datos rechazados por el servidor.',
      'core',
    ],
    [
      schedulerFailure,
      'No se pudo confirmar el resultado. Actualiza el listado antes de repetir',
      'Validación HTTP: datos rechazados por el servidor. Revisa el formulario.',
      'core',
    ],
  ] as const;

  it.each(pages)('preserves all messages for %s', (format, uncertain, validation, rejection) => {
    expect(format(failure(504), true)).toBe(uncertain);
    expect(format(failure(0))).toBe('Sin conexión con el servidor o CORE.');
    expect(format(failure(503, 'core_unavailable'), true)).toBe(
      'Sin conexión con el servidor o CORE.',
    );
    expect(format(failure(401))).toBe('La sesión ha caducado.');
    expect(format(failure(422))).toBe(validation);
    expect(format({})).toBe('No se pudo completar la operación.');
    for (const message of [undefined, '', '<b>reason</b>']) {
      expect(format(failure(502, 'core_error', message), true)).toBe(
        rejection === 'core'
          ? `CORE rechazó la operación: ${message ?? 'sin detalles'}`
          : message === undefined
            ? 'No se pudo completar la operación.'
            : `Error: ${message}`,
      );
      expect(format(failure(403, undefined, message))).toBe(
        message === undefined ? 'No se pudo completar la operación.' : `Error: ${message}`,
      );
    }
    expect(format(new HttpErrorResponse({ status: 403, error: { detail: 'CSRF rejected' } }))).toBe(
      'Error: CSRF rejected',
    );
  });
});
