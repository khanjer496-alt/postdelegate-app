import { BadRequestException } from '@nestjs/common';
import {
  URL,
  Video,
  VideoAbstract,
} from '@gitroom/nestjs-libraries/videos/video.interface';
import { IsString } from 'class-validator';
import { JSONSchema } from 'class-validator-jsonschema';

class ImagesSlidesParams {
  @JSONSchema({
    description: 'Elevenlabs voice id, use a special tool to get it, this is a required filed',
  })
  @IsString()
  voice: string;

  @JSONSchema({
    description: 'Simple string of the prompt, not a json',
  })
  @IsString()
  prompt: string;
}

@Video({
  identifier: 'image-text-slides',
  title: 'Image Text Slides',
  description: 'Generate videos slides from images and text, Don\'t break down the slides, provide only the first slide information',
  placement: 'text-to-image',
  tools: [],
  dto: ImagesSlidesParams,
  trial: true,
  // fal.ai + ElevenLabs are platform-paid, PostDelegate is bring-your-own AI only
  available: false,
})
export class ImagesSlides extends VideoAbstract<ImagesSlidesParams> {
  override dto = ImagesSlidesParams;

  async process(
    output: 'vertical' | 'horizontal',
    customParams: ImagesSlidesParams
  ): Promise<URL> {
    throw new BadRequestException('This video type is not available');
  }
}
