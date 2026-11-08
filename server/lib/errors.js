export class AppError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST', details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function safeError(error) {
  if (error instanceof AppError) {
    return { status: error.status, body: { error: error.message, code: error.code, details: error.details } };
  }
  return { status: 500, body: { error: 'Something went wrong on the server.', code: 'INTERNAL_ERROR' } };
}
