export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_ERROR'
  | 'INTERNAL_ERROR'
  | 'PHASE_NOT_IMPLEMENTED'

export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>

export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly status: number
  public readonly details: ErrorDetails
  public readonly expose: boolean

  public constructor(code: ErrorCode, message: string, status: number, details: ErrorDetails = {}, expose = true) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = status
    this.details = details
    this.expose = expose
  }

  public toJSON(): { code: ErrorCode; message: string; details: ErrorDetails } {
    return { code: this.code, message: this.expose ? this.message : 'Internal server error', details: this.expose ? this.details : {} }
  }
}

export class PhaseNotImplementedError extends AppError {
  public readonly phase: string

  public constructor(phase: string, capability: string) {
    super('PHASE_NOT_IMPLEMENTED', `${capability} is scheduled for ${phase}`, 501, { phase, capability })
    this.name = 'PhaseNotImplementedError'
    this.phase = phase
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }
  if (error instanceof Error) {
    return new AppError('INTERNAL_ERROR', error.message, 500, {}, false)
  }
  return new AppError('INTERNAL_ERROR', 'Unknown error', 500, {}, false)
}
