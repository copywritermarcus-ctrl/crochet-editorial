import type { TranscribeRequest, VendorTranscript } from '../types.js';
import { notImplemented } from '../lib/notImplemented.js';

export interface Transcriber {
  transcribe(req: TranscribeRequest): Promise<VendorTranscript>;
}

/** Maps a raw AssemblyAI payload onto the vendor-neutral shape. Pure. */
export function parseAssemblyAiResponse(_raw: unknown): VendorTranscript {
  return notImplemented('parseAssemblyAiResponse');
}

export function createAssemblyAiTranscriber(_opts: { apiKey: string }): Transcriber {
  return notImplemented('createAssemblyAiTranscriber');
}
