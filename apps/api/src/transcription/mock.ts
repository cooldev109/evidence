import { sha256Hex } from '@evidence/core';
import type { Transcriber, TranscriptionInput, TranscriptionResult } from './types.js';

/**
 * Deterministic stand-in for dev/test. Produces a stable placeholder derived
 * from the audio bytes so tests can assert on it without a network call or cost.
 */
export class MockTranscriber implements Transcriber {
  readonly id = 'mock';
  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const fingerprint = sha256Hex(input.audio).slice(0, 8);
    return {
      text: `[transcrição simulada · ${input.audio.length} bytes · ${fingerprint}]`,
      provider: 'mock',
      model: 'mock',
      language: input.language ?? 'pt',
    };
  }
}
