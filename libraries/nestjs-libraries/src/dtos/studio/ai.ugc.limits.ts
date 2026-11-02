// The limits of "AI UGC", apart from its DTO so the editor reads them
// without the server-only validation it imports
export const studioAiTones = [
  'friendly',
  'excited',
  'calm',
  'expert',
  'funny',
] as const;
export type StudioAiTone = (typeof studioAiTones)[number];

// The length the script is written for. The video is as long as the voice,
// and never longer than STUDIO_MAX_SECONDS
export const STUDIO_AI_MIN_SECONDS = 15;
export const STUDIO_AI_MAX_SECONDS = 45;
export const STUDIO_AI_MAX_FOOTAGE = 6;
export const STUDIO_AI_MAX_STILLS = 3;
export const STUDIO_AI_MAX_LINES = 8;
export const STUDIO_AI_LINE_CHARS = 160;
export const STUDIO_AI_POST_CHARS = 2200;
