import type { Transcriber, TranscriptionInput, TranscriptionResult } from './types.js';

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * OpenAI Whisper transcription. The API key is supplied at construction from
 * the environment (OPENAI_API_KEY) and is never logged or persisted.
 */
export class OpenAITranscriber implements Transcriber {
  readonly id = 'openai';
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append('model', this.model);
    if (input.language) form.append('language', input.language);
    form.append(
      'file',
      new Blob([input.audio], { type: input.contentType || 'audio/webm' }),
      input.filename || 'audio.webm',
    );

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI transcription failed (${res.status}): ${detail.slice(0, 300)}`);
    }
    const body = (await res.json()) as { text?: string; language?: string };
    return {
      text: body.text ?? '',
      provider: 'openai',
      model: this.model,
      language: body.language ?? input.language,
    };
  }
}
