import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { AuthorizationActions, Sections, SubscriptionException } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { MISSING_AI_KEY } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';

// a member can't add the workspace's key, only an admin can
const ASK_ADMIN_FOR_AI_KEY =
  'Ask a workspace admin to add an OpenAI key in Settings → AI.';

@Catch(SubscriptionException)
export class SubscriptionExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const status = exception.getStatus();
    const error: {
      section: Sections;
      action: AuthorizationActions;
      message?: string;
    } = exception.getResponse() as any;

    const isMember = request?.org?.users?.[0]?.role === 'USER';
    const message = getErrorMessage(error, isMember);

    // AI is denied only when the workspace has no OpenAI key of its own, which
    // is fixed in Settings → AI, not by paying. A member gets no link, as the
    // AI settings are for admins
    const memberWithoutAi = error.section === Sections.AI && isMember;
    response.status(status).json({
      statusCode: status,
      message,
      section: error.section,
      ...(memberWithoutAi
        ? {}
        : {
            url:
              process.env.FRONTEND_URL +
              (error.section === Sections.AI ? '/settings?tab=ai' : '/billing'),
          }),
    });
  }
}

const getErrorMessage = (
  error: {
    section: Sections;
    action: AuthorizationActions;
    message?: string;
  },
  isMember: boolean
) => {
  switch (error.section) {
    case Sections.POSTS_PER_MONTH:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of posts for your subscription. Please upgrade your subscription to add more posts.';
      }
    case Sections.PROVIDER_POSTS_PER_MONTH:
      switch (error.action) {
        default:
          return (
            error.message ||
            'You have reached the maximum number of posts to this channel for your subscription. Please upgrade your subscription to add more posts.'
          );
      }
    case Sections.CHANNEL:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of channels for your subscription. Please upgrade your subscription to add more channels.';
      }
    case Sections.WEBHOOKS:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of webhooks for your subscription. Please upgrade your subscription to add more webhooks.';
      }
    case Sections.VIDEOS_PER_MONTH:
      switch (error.action) {
        default:
          return 'You have reached the maximum number of generated videos for your subscription. Please upgrade your subscription to generate more videos.';
      }
    case Sections.AI:
      switch (error.action) {
        default:
          return isMember ? ASK_ADMIN_FOR_AI_KEY : MISSING_AI_KEY;
      }
    case Sections.CLIPPING_MINUTES:
      switch (error.action) {
        default:
          return 'You have used all the clipping minutes of your subscription for this month. Please upgrade your subscription to clip more videos.';
      }
  }
};
