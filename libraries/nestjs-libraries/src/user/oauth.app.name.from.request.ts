import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const GetOAuthAppNameFromRequest = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.oauthAppName as string | undefined;
  }
);
