import { describe, expect, it } from 'vitest'
import { TwilioSmsSender } from './sms.js'

describe('F6 Twilio SMS boundary', () => {
  it('gates SMS for trial and Start plans', async () => await expect(new TwilioSmsSender({ enabled: true }).send('+1', 'Hi', 'start')).rejects.toThrow('Growth'))
  it('keeps SMS disabled without a Twilio flag', async () => await expect(new TwilioSmsSender({ enabled: false }).send('+1', 'Hi', 'growth')).rejects.toThrow('disabled'))
  it('sends a Growth SMS through Twilio when configured', async () => { const response = await new TwilioSmsSender({ enabled: true, accountSid: 'sid', authToken: 'token', fromNumber: '+100' }, async (_url, init) => { expect(init?.headers).toHaveProperty('authorization'); return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }) }).send('+101', 'Hi', 'growth'); expect(response.messageId).toBe('SM1') })
  it('surfaces Twilio failure', async () => await expect(new TwilioSmsSender({ enabled: true, accountSid: 'sid', authToken: 'token', fromNumber: '+100' }, async () => new Response('', { status: 500 })).send('+101', 'Hi', 'commander')).rejects.toThrow('Twilio'))
})
