import { HttpErrorResponse } from '@angular/common/http';

export function errorMessage(error: HttpErrorResponse): string {
  if (error.status === 429)
    return 'Demasiados intentos. Espera quince minutos antes de volver a intentarlo.';
  if (typeof error.error?.detail === 'string') return error.error.detail;
  if (error.status === 422)
    return 'Revisa los datos: username de 3–64 caracteres y contraseña de 12–128 caracteres.';
  return 'No se ha podido completar la operación. Comprueba la conexión e inténtalo de nuevo.';
}
