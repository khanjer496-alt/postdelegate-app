import { Global, Module } from '@nestjs/common';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { HookOverClipTemplate } from '@gitroom/nestjs-libraries/studio/templates/hook.over.clip.template';
import { TalkingHeadCaptionsTemplate } from '@gitroom/nestjs-libraries/studio/templates/talking.head.captions.template';

@Global()
@Module({
  providers: [
    HookOverClipTemplate,
    TalkingHeadCaptionsTemplate,
    StudioTemplateManager,
  ],
  get exports() {
    return this.providers;
  },
})
export class StudioModule {}
