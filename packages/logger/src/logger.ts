import { mergeFields } from './record.js'
import type { JsonObject, LogLevel, LogRecord, LogSink } from './record.js'

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 }

export class Logger {
  private readonly context: JsonObject
  private readonly sink: LogSink
  private readonly minimum: LogLevel

  public constructor(sink: LogSink = consoleSink, minimum: LogLevel = 'info', context: JsonObject = {}) {
    this.context = context
    this.sink = sink
    this.minimum = minimum
  }

  public child(context: JsonObject): Logger {
    return new Logger(this.sink, this.minimum, mergeFields(this.context, context))
  }

  public debug(message: string, fields: JsonObject = {}): void {
    this.write('debug', message, fields)
  }

  public info(message: string, fields: JsonObject = {}): void {
    this.write('info', message, fields)
  }

  public warn(message: string, fields: JsonObject = {}): void {
    this.write('warn', message, fields)
  }

  public error(message: string, fields: JsonObject = {}): void {
    this.write('error', message, fields)
  }

  private write(level: LogLevel, message: string, fields: JsonObject): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.minimum]) {
      return
    }
    const record: LogRecord = {
      level,
      message,
      timestamp: new Date().toISOString(),
      context: mergeFields(this.context, fields),
    }
    this.sink(record)
  }
}

export const consoleSink: LogSink = (record) => {
  const line = JSON.stringify(record)
  if (record.level === 'error') {
    console.error(line)
  } else if (record.level === 'warn') {
    console.warn(line)
  } else {
    console.log(line)
  }
}

export function createMemorySink(): { readonly records: LogRecord[]; readonly sink: LogSink } {
  const records: LogRecord[] = []
  return { records, sink: (record) => records.push(record) }
}

export function loggerFromEnv(env: Readonly<Record<string, string | undefined>>): Logger {
  const value = env.LOG_LEVEL?.trim()
  const minimum: LogLevel = value === 'debug' || value === 'info' || value === 'warn' || value === 'error' ? value : 'info'
  return new Logger(consoleSink, minimum)
}
