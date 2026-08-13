import { isSixHourlyTick } from '@profitpilot/reporting'

export type ReportTickOutcome = 'idle' | 'ran'
export type ReportTickHandler = (at: number) => Promise<void>

export class SixHourlyReportTick {
  private readonly handler: ReportTickHandler
  public constructor(handler: ReportTickHandler) { this.handler = handler }
  public async tick(at = Date.now()): Promise<ReportTickOutcome> {
    if (!isSixHourlyTick(at)) return 'idle'
    await this.handler(at)
    return 'ran'
  }
}
