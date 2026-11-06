import 'reflect-metadata';

const COMPOSER_ONLY = 'composer:only';

// A setting only the composer can fill: picked from a list it loads from
// the network (a board, a server channel, a subreddit) or set by a check it
// runs itself (TikTok's account check). A form without the composer, like
// bulk scheduling, leaves it out, and a channel that requires one gets
// drafts only there. Kept out of the JSON schema of the public API and MCP.
export const ComposerOnly = (): PropertyDecorator => (target, property) => {
  Reflect.defineMetadata(
    COMPOSER_ONLY,
    [...composerOnlySettings(target.constructor), String(property)],
    target.constructor
  );
};

// the composer-only settings of a provider settings DTO
export const composerOnlySettings = (dto: any): string[] =>
  (dto && Reflect.getMetadata(COMPOSER_ONLY, dto)) || [];
