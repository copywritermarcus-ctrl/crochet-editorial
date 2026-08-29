import { AssemblyAI } from 'assemblyai';
import type { TranscribeRequest, VendorTranscript, VendorUtterance } from '../types.js';

export interface Transcriber {
  transcribe(req: TranscribeRequest): Promise<VendorTranscript>;
}

/**
 * AssemblyAI field names, verified against docs 2026-08-29.
 *
 * docs.assemblyai.com and www.assemblyai.com are both blocked by this
 * environment's network egress proxy, so these were verified instead against
 * the vendor's own OpenAPI-generated type definitions shipped in
 * assemblyai@4.37.0 (node_modules/assemblyai/dist/types/openapi.generated.d.ts),
 * which is the same spec the published docs are generated from:
 *
 *   request   speaker_labels?: boolean            enable diarisation
 *             speakers_expected?: number | null   hint, at most 10 speakers
 *   response  utterances: TranscriptUtterance[]   present when speaker_labels is on
 *             utterance.speaker  string           sequential capitals: "A", "B", ...
 *             utterance.start    number           MILLISECONDS
 *             utterance.end      number           MILLISECONDS
 *             utterance.text     string
 *             utterance.confidence number
 *             audio_duration     number           SECONDS
 *
 * Re-confirm against the live docs on the Mac Mini during Phase 3; the runbook
 * carries this as an explicit step.
 */
interface RawAssemblyAiResponse {
  id?: unknown;
  status?: unknown;
  error?: unknown;
  audio_duration?: unknown;
  utterances?: unknown;
}

/** Maps a raw AssemblyAI payload onto the vendor-neutral shape. Pure. */
export function parseAssemblyAiResponse(raw: unknown): VendorTranscript {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('AssemblyAI: response was not an object');
  }
  const doc = raw as RawAssemblyAiResponse;

  const status = typeof doc.status === 'string' ? doc.status : 'unknown';
  if (status === 'error') {
    const message = typeof doc.error === 'string' && doc.error ? doc.error : 'unknown vendor error';
    throw new Error(`AssemblyAI: ${message}`);
  }
  if (status !== 'completed') {
    throw new Error(`AssemblyAI: transcript is not complete (status "${status}")`);
  }

  const rawUtterances = Array.isArray(doc.utterances) ? doc.utterances : [];
  if (rawUtterances.length === 0) {
    throw new Error('AssemblyAI: response carried no utterances (was speaker_labels enabled?)');
  }

  const utterances: VendorUtterance[] = rawUtterances.map((entry) => {
    const u = entry as Record<string, unknown>;
    return {
      speaker: typeof u.speaker === 'string' ? u.speaker : '',
      start: typeof u.start === 'number' ? u.start : 0,
      end: typeof u.end === 'number' ? u.end : 0,
      text: typeof u.text === 'string' ? u.text : '',
      confidence: typeof u.confidence === 'number' ? u.confidence : null,
    };
  });

  return {
    id: typeof doc.id === 'string' ? doc.id : '',
    status: 'completed',
    audioDurationSec: typeof doc.audio_duration === 'number' ? doc.audio_duration : null,
    utterances,
    raw,
  };
}

export function createAssemblyAiTranscriber(opts: { apiKey: string }): Transcriber {
  const client = new AssemblyAI({ apiKey: opts.apiKey });

  return {
    async transcribe(req: TranscribeRequest): Promise<VendorTranscript> {
      // `transcribe` uploads the local file, submits, and polls to completion.
      const transcript = await client.transcripts.transcribe({
        audio: req.audioPath,
        speaker_labels: true,
        ...(req.speakersExpected !== null ? { speakers_expected: req.speakersExpected } : {}),
      });
      return parseAssemblyAiResponse(transcript);
    },
  };
}
