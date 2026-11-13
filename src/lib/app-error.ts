import type { Locale } from './i18n';

export type ErrorCode =
  | 'no_project'
  | 'invalid_path'
  | 'not_found'
  | 'locked'
  | 'revision_conflict'
  | 'already_exists'
  | 'invalid_input'
  | 'unsupported'
  | 'trash_unavailable'
  | 'state'
  | 'io'
  | 'unknown';

const codes = new Set<ErrorCode>([
  'no_project',
  'invalid_path',
  'not_found',
  'locked',
  'revision_conflict',
  'already_exists',
  'invalid_input',
  'unsupported',
  'trash_unavailable',
  'state',
  'io',
]);

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Normalizes native `{ code, message }` payloads, `Error`s and strings. */
export function parseAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (isRecord(error) && typeof error.message === 'string') {
    const code =
      typeof error.code === 'string' && codes.has(error.code as ErrorCode)
        ? (error.code as ErrorCode)
        : 'unknown';
    return new AppError(code, error.message);
  }
  if (error instanceof Error) return new AppError('unknown', error.message);
  return new AppError('unknown', String(error));
}

export function isRevisionConflict(error: unknown): boolean {
  return parseAppError(error).code === 'revision_conflict';
}

const english: Partial<Record<ErrorCode, string>> = {
  no_project: 'No project is open.',
  invalid_path: 'The path is outside the current project or is not allowed.',
  not_found: 'The file or item no longer exists.',
  locked: 'This item is locked and cannot be changed.',
  revision_conflict: 'The document changed elsewhere. The latest version has been loaded.',
  already_exists: 'An item with this name already exists.',
  invalid_input: 'The input is not valid.',
  unsupported: 'This operation is not supported.',
  trash_unavailable: 'The item could not be moved to the Trash.',
  state: 'The app is busy. Try again.',
  io: 'The file could not be read or written.',
};

/** Native messages are Chinese; English falls back to a generic sentence per code. */
export function errorMessage(error: unknown, language: Locale = 'zh'): string {
  const parsed = parseAppError(error);
  if (language === 'zh' || parsed.code === 'unknown') return parsed.message;
  return english[parsed.code] ?? parsed.message;
}
