export type ErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'forbidden'
  | 'validation'
  | 'server'
  | 'network'
  | 'unknown';

export interface MappedError {
  kind: ErrorKind;
  message: string;
  /** The stored key is no longer valid and the user must reconnect. */
  reconnect: boolean;
}

const withDetail = (message: string, detail?: string) =>
  detail ? `${message} (${detail})` : message;

/**
 * Turns anything thrown by the API client into a message that tells the user
 * what to do next. Works on `PostDelegateError` (has a numeric `status`) and
 * on fetch network failures (`TypeError`).
 */
export function mapApiError(error: unknown): MappedError {
  const status =
    error && typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;
  const detail =
    error instanceof Error && error.message ? error.message : undefined;

  if (status === 401) {
    return {
      kind: 'auth',
      reconnect: true,
      message:
        'PostDelegate rejected your API key. It may have been revoked or changed, so please reconnect with a new key.',
    };
  }

  if (status === 429) {
    return {
      kind: 'rate_limit',
      reconnect: false,
      message:
        'You are sending requests too quickly (rate limit). Wait a minute and try again.',
    };
  }

  if (status === 403) {
    return {
      kind: 'forbidden',
      reconnect: false,
      message: withDetail(
        'Your PostDelegate plan or permissions do not allow this, for example the monthly post limit was reached.',
        detail
      ),
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      kind: 'server',
      reconnect: false,
      message:
        'PostDelegate had a problem handling this request. Try again in a moment.',
    };
  }

  if (status !== undefined && status >= 400) {
    return {
      kind: 'validation',
      reconnect: false,
      message: detail || 'PostDelegate could not accept this post.',
    };
  }

  if (error instanceof TypeError) {
    return {
      kind: 'network',
      reconnect: false,
      message:
        'Could not reach PostDelegate. Check your internet connection and try again.',
    };
  }

  return {
    kind: 'unknown',
    reconnect: false,
    message: detail || 'Something went wrong. Please try again.',
  };
}
