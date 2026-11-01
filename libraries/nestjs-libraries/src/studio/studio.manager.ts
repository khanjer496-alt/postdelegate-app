import { BadRequestException, Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  StudioTemplateAbstract,
  StudioTemplateParams,
} from '@gitroom/nestjs-libraries/studio/studio.interface';

// Every message of a validation, nested ones included. The DTOs word each
// message for the customer, so the same one twice is said once. A draft may
// still miss parts, so "partial" drops the "is missing" ones, an empty text
// (a hook being typed, a caption word being fixed) counting as missing
const DRAFT_SKIPS = ['isDefined', 'minLength'];
const messages = (errors: ValidationError[], partial: boolean): string[] => [
  ...new Set(
    errors.flatMap((error) => [
      ...Object.entries(error.constraints || {})
        .filter(([key]) => !partial || !DRAFT_SKIPS.includes(key))
        .map(([, message]) => message),
      ...messages(error.children || [], partial),
    ])
  ),
];

@Injectable()
export class StudioTemplateManager {
  constructor(private _moduleRef: ModuleRef) {}

  getAllTemplates(): (StudioTemplateParams & { target: any })[] {
    return Reflect.getMetadata('studio-template', StudioTemplateAbstract) || [];
  }

  getTemplate(identifier: string) {
    const template = this.getAllTemplates().find(
      (p) => p.identifier === identifier
    );
    if (!template) {
      return undefined;
    }

    return {
      ...template,
      instance: this._moduleRef.get(template.target, {
        strict: false,
      }) as StudioTemplateAbstract<any>,
    };
  }

  // The spec through the DTO of its template, unknown fields dropped
  async validateSpec<T = any>(
    identifier: string,
    spec: unknown,
    partial: boolean
  ): Promise<T> {
    const template = this.getTemplate(identifier);
    if (!template) {
      throw new BadRequestException('Unknown template');
    }

    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new BadRequestException('The project settings are not valid');
    }

    const instance = plainToInstance(template.dto, spec);
    const errors = messages(
      await validate(instance, {
        whitelist: true,
        forbidUnknownValues: true,
        skipMissingProperties: partial,
      }),
      partial
    );
    if (errors.length) {
      throw new BadRequestException(errors);
    }

    return instance;
  }
}
