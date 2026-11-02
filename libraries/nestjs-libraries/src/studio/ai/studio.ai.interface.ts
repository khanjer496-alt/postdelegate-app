import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { StudioWord } from '@gitroom/helpers/utils/studio.captions';

// Studio's AI always runs on the workspace's own key: PostDelegate never pays
// for it. A provider is the one place that talks to an AI company; nothing
// else in Studio imports its SDK. Adding one is adding a class with
// @StudioAiProvider whose identifier is an AiCredential.provider value

export interface StudioAiProviderParams {
  identifier: string;
}

// What a script is written from
export interface StudioAiScriptRequest {
  topic: string;
  tone: string;
  // the length the spoken script should have
  seconds: number;
}

export interface StudioAiScript {
  hook: string;
  lines: string[];
  cta: string;
  postText: string;
}

export interface StudioAiVoiceRequest {
  text: string;
  // a voice of the provider, its default when empty or unknown
  voice: string;
  // how it is said (tone, pace)
  instructions: string;
}

export interface StudioAiImageRequest {
  prompt: string;
}

export interface StudioAiVideoRequest {
  prompt: string;
  seconds: number;
}

export interface StudioAiCall {
  // aborts the call: a request budget or a cancelled render
  signal?: AbortSignal;
}

// A failure of the AI, with a message written for the customer. "retry" says
// a later attempt may work (a rate limit, a timeout, an outage); a rejected
// key, an empty account or a refusal never does, so those are never retried.
// "account" says no call can work until the customer fixes their key or
// their account (a rejected key, no credit)
export class StudioAiError extends Error {
  constructor(
    message: string,
    public status: number,
    public retry = false,
    public account = false
  ) {
    super(message);
    this.name = 'StudioAiError';
  }
}

export function StudioAiProvider(params: StudioAiProviderParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('studio-ai-provider', StudioAiProviderAbstract) || [];
    existingMetadata.push({ target, ...params });
    Reflect.defineMetadata(
      'studio-ai-provider',
      existingMetadata,
      StudioAiProviderAbstract
    );
  };
}

export abstract class StudioAiProviderAbstract {
  // the voices the editor offers, the first is the default
  abstract voices: readonly string[];

  abstract script(
    org: string,
    request: StudioAiScriptRequest,
    call?: StudioAiCall
  ): Promise<StudioAiScript>;

  // an mp3 of the text
  abstract tts(
    org: string,
    request: StudioAiVoiceRequest,
    call?: StudioAiCall
  ): Promise<Buffer>;

  // the words of a local audio file with their times
  abstract transcribe(
    org: string,
    file: string,
    call?: StudioAiCall
  ): Promise<StudioWord[]>;

  // a vertical still for b-roll, as a jpeg
  abstract image(
    org: string,
    request: StudioAiImageRequest,
    call?: StudioAiCall
  ): Promise<Buffer>;

  // a short clip, only on providers that can make one; Studio hides AI
  // video wherever the workspace's provider has none
  video?(
    org: string,
    request: StudioAiVideoRequest,
    call?: StudioAiCall
  ): Promise<Buffer>;

  voice(voice?: string) {
    return voice && this.voices.includes(voice) ? voice : this.voices[0];
  }
}

// What a template asks the AI to make before it renders. The render waits
// for all of them and gets the files back in the same order
export type StudioAiAssetRequest =
  | ({ kind: 'voice' } & StudioAiVoiceRequest)
  | ({ kind: 'image' } & StudioAiImageRequest);

// The StudioAsset kinds of what the AI makes, next to the music
export const STUDIO_AI_ASSET_KINDS: StudioAiAssetRequest['kind'][] = [
  'voice',
  'image',
];

// A file the AI made: stored in our storage and kept as a StudioAsset of its
// project (never a Media row), so erasure and the daily cleanup cover it
export interface StudioAiAsset {
  // the StudioAsset row, once it is kept
  id?: string;
  kind: StudioAiAssetRequest['kind'];
  // the hash of what it was made from
  key: string;
  // the storage key and the public path of the file
  name: string;
  path: string;
  // voice only: its length and the times of its words
  seconds?: number;
  words?: StudioWord[];
}

// Files are found by the hash of what they were made from, so a render
// reuses the voice the customer previewed and a retry never pays twice
export const studioAiAssetKey = (request: StudioAiAssetRequest) =>
  createHash('sha256')
    .update(JSON.stringify(request))
    .digest('hex')
    .slice(0, 32);

// What StudioAsset.data keeps of a file the AI made
export const studioAiAssetData = (asset: StudioAiAsset) =>
  JSON.stringify({
    key: asset.key,
    ...(asset.seconds ? { seconds: asset.seconds } : {}),
    ...(asset.words ? { words: asset.words } : {}),
  });

// A StudioAsset row of a file the AI made, undefined when it is not one
export const studioAiAssetFromRow = (row: {
  id: string;
  kind: string;
  name: string;
  path: string;
  data?: string | null;
}): StudioAiAsset | undefined => {
  if (!STUDIO_AI_ASSET_KINDS.includes(row.kind as StudioAiAsset['kind'])) {
    return undefined;
  }
  try {
    const data = JSON.parse(row.data || '{}');
    if (typeof data?.key !== 'string') {
      return undefined;
    }
    return {
      id: row.id,
      kind: row.kind as StudioAiAsset['kind'],
      key: data.key,
      name: row.name,
      path: row.path,
      ...(typeof data.seconds === 'number' ? { seconds: data.seconds } : {}),
      ...(Array.isArray(data.words) ? { words: data.words } : {}),
    };
  } catch (err) {
    return undefined;
  }
};
