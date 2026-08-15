import { describe, expect, it, vi } from 'vitest'
import { createSpeechRecognition, speakNative, speechRecognitionAvailable, speechRecognitionFailure, stopNativeSpeech, transcriptFromEvent } from './voice.js'
import type { NativeSpeechRecognition } from './voice.js'

class FakeRecognition implements NativeSpeechRecognition {
  public lang = ''
  public continuous = false
  public interimResults = false
  public onstart: (() => void) | null = null
  public onend: (() => void) | null = null
  public onerror: ((event: Readonly<{ error?: string }>) => void) | null = null
  public onresult: ((event: Readonly<{ results: readonly Readonly<{ 0?: Readonly<{ transcript: string }>; length: number }>[] }>) => void) | null = null
  public start = vi.fn()
  public stop = vi.fn()
  public abort = vi.fn()
}

class FakeUtterance {
  public lang = ''
  public onend: (() => void) | null = null
  public constructor(public readonly text: string) {}
}

describe('F8 browser-native voice contracts', () => {
  it('detects and creates the native recognizer without a microphone icon dependency', () => {
    const scope = { SpeechRecognition: FakeRecognition } as unknown as Window
    expect(speechRecognitionAvailable(scope)).toBe(true)
    expect(createSpeechRecognition(scope)).toBeInstanceOf(FakeRecognition)
    expect(speechRecognitionAvailable(undefined)).toBe(false)
    expect(createSpeechRecognition(undefined)).toBeNull()
  })

  it('preserves recognition error codes and gives failure-specific recovery guidance', () => {
    expect(speechRecognitionFailure('not-allowed')).toMatchObject({ code: 'not-allowed' })
    expect(speechRecognitionFailure('not-allowed').message).toContain('Shopify Admin')
    expect(speechRecognitionFailure('audio-capture').message).toContain('microphone')
    expect(speechRecognitionFailure('no-speech').message).toContain('No speech')
    expect(speechRecognitionFailure('network').message).toContain('connectivity')
    expect(speechRecognitionFailure('vendor-code')).toEqual({ code: 'vendor-code', message: 'Speech recognition failed (vendor-code). You can retry or type your message.' })
    expect(speechRecognitionFailure(undefined).code).toBe('unknown')
  })

  it('extracts transcripts and speaks/cancels through native TTS', () => {
    Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: FakeUtterance })
    const speak = vi.fn()
    const cancel = vi.fn()
    const scope = { speechSynthesis: { speak, cancel } } as unknown as Window
    const ended = vi.fn()
    expect(speakNative(scope, 'Namaste Sir', 'hi', ended)).toBe(true)
    expect(speak).toHaveBeenCalledOnce()
    const utterance = speak.mock.calls[0]?.[0] as FakeUtterance
    expect(utterance.lang).toBe('hi-IN')
    utterance.onend?.()
    expect(ended).toHaveBeenCalledOnce()
    stopNativeSpeech(scope)
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(transcriptFromEvent({ results: [{ 0: { transcript: 'Mujhe' }, length: 1 }, { 0: { transcript: 'dikhao' }, length: 1 }] })).toBe('Mujhe dikhao')
    expect(speakNative(undefined, 'hello', 'en')).toBe(false)
  })
})
