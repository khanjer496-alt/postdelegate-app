import { Global, Module } from '@nestjs/common';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { TalkingHeadCaptionsTemplate } from '@gitroom/nestjs-libraries/studio/templates/talking.head.captions.template';
import { ImageSlideshowTemplate } from '@gitroom/nestjs-libraries/studio/templates/image.slideshow.template';
import { BeforeAfterTemplate } from '@gitroom/nestjs-libraries/studio/templates/before.after.template';
import { TopNListTemplate } from '@gitroom/nestjs-libraries/studio/templates/top.n.list.template';
import { QuoteCardTemplate } from '@gitroom/nestjs-libraries/studio/templates/quote.card.template';
import { AiUgcTemplate } from '@gitroom/nestjs-libraries/studio/templates/ai.ugc.template';
import { StudioAiManager } from '@gitroom/nestjs-libraries/studio/ai/studio.ai.manager';
import { OpenAiStudioProvider } from '@gitroom/nestjs-libraries/studio/ai/providers/openai.studio.provider';

@Global()
@Module({
  providers: [
    HookOverClipTemplate,
    TalkingHeadCaptionsTemplate,
    ImageSlideshowTemplate,
    BeforeAfterTemplate,
    TopNListTemplate,
    QuoteCardTemplate,
    AiUgcTemplate,
    StudioTemplateManager,
    OpenAiStudioProvider,
    StudioAiManager,
  ],
  get exports() {
    return this.providers;
  },
})
export class StudioModule {}
