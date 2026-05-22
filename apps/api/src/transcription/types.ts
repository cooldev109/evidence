/**
 * Speech-to-text abstraction for the ATA flow.
 *
 * Provider-agnostic, mirroring the TSA registry design: the app depends on the
 * interface, and the concrete provider (mock for dev/test, OpenAI Whisper for
 * production) is chosen at bootstrap from config.
 */

export interface TranscriptionInput {
  audio: Buffer;
  contentType: string;
  filename: string;
  /** Optional ISO-639-1 hint (e.g. 'pt'); improves accuracy when known. */
  language?: string;
}

export interface TranscriptionResult {
  text: string;
  provider: string;
  model: string;
  language?: string;
}

export interface Transcriber {
  readonly id: string;
  transcribe(input: TranscriptionInput): Promise<TranscriptionResult>;
}
