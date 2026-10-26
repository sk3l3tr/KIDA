import { ChannelBusyError } from './arca-request.service';

export type CoreFailure =
  | { kind: 'busy'; message: string }
  | {
      kind: 'uncertain' | 'unavailable' | 'expired' | 'validation' | 'rejected' | 'other';
      message?: string;
    };

function fields(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Interpret the shared HTTP/CORE envelope; each page owns its user-facing wording. */
export function classifyCoreFailure(failure: unknown, writing = false): CoreFailure {
  if (failure instanceof ChannelBusyError) return { kind: 'busy', message: failure.message };
  const error = fields(failure);
  const status = typeof error['status'] === 'number' ? error['status'] : undefined;
  const detail = fields(error['error'])['detail'];
  const data = fields(detail);
  const code = data['code'];
  const message =
    typeof data['message'] === 'string'
      ? data['message']
      : typeof detail === 'string'
        ? detail
        : undefined;
  if (
    writing &&
    (status === 0 ||
      status === 504 ||
      (typeof code === 'string' &&
        [
          'core_timeout',
          'core_transport_error',
          'core_http_error',
          'core_invalid_response',
        ].includes(code)) ||
      (status !== undefined &&
        status >= 500 &&
        code !== 'core_unavailable' &&
        code !== 'core_error'))
  ) {
    return { kind: 'uncertain' };
  }
  if (status === 0 || code === 'core_unavailable') return { kind: 'unavailable' };
  if (status === 401) return { kind: 'expired' };
  if (status === 422) return { kind: 'validation' };
  return { kind: code === 'core_error' ? 'rejected' : 'other', message };
}
