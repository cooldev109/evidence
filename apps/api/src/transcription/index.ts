import type { AppConfig } from '../config.js';
import { MockTranscriber } from './mock.js';
import { OpenAITranscriber } from './openai.js';
import type { Transcriber } from './types.js';

export type { Transcriber, TranscriptionInput, TranscriptionResult } from './types.js';
export { MockTranscriber } from './mock.js';
export { OpenAITranscriber } from './openai.js';

/**
 * Select the transcription provider from config. Falls back to the mock if
 * 'openai' is requested without an API key, so the app still boots (ATA will
 * return placeholder text rather than crashing).
 */
export function buildTranscriber(cfg: AppConfig): Transcriber {
  if (cfg.TRANSCRIPTION_PROVIDER === 'openai') {
    if (!cfg.OPENAI_API_KEY) {
      // eslint-disable-next-line no-console
      console.warn(
        '[transcription] TRANSCRIPTION_PROVIDER=openai but OPENAI_API_KEY is unset; using mock',
      );
      return new MockTranscriber();
    }
    return new OpenAITranscriber(cfg.OPENAI_API_KEY, cfg.TRANSCRIPTION_MODEL);
  }
  return new MockTranscriber();
}
