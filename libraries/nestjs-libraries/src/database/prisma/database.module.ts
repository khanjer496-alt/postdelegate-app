import { Global, Module } from '@nestjs/common';
import { PrismaRepository, PrismaService, PrismaTransaction } from './prisma.service';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { SubscriptionRepository } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { NotificationsRepository } from '@gitroom/nestjs-libraries/database/prisma/notifications/notifications.repository';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { PaymentService } from '@gitroom/nestjs-libraries/services/payment/payment.service';
import { PaymentProviderManager } from '@gitroom/nestjs-libraries/services/payment/payment.provider.manager';
import { RevenueCatProvider } from '@gitroom/nestjs-libraries/services/payment/providers/revenuecat.provider';
import { ExtractContentService } from '@gitroom/nestjs-libraries/openai/extract.content.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { DeepgramService } from '@gitroom/nestjs-libraries/deepgram/deepgram.service';
import { ClippingService } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.service';
import { ClippingRepository } from '@gitroom/nestjs-libraries/database/prisma/clipping/clipping.repository';
import { AgenciesService } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.service';
import { AgenciesRepository } from '@gitroom/nestjs-libraries/database/prisma/agencies/agencies.repository';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { ThirdPartyRepository } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.repository';
import { AiCredentialRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.repository';
import { AiCredentialService } from '@gitroom/nestjs-libraries/database/prisma/ai-credentials/ai.credential.service';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { StudioTemplateManager } from '@gitroom/nestjs-libraries/studio/studio.manager';
import { FalService } from '@gitroom/nestjs-libraries/openai/fal.service';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { AnnouncementsRepository } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.repository';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { ErrorsRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.repository';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';
import { AdminStatsRepository } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.repository';
import { AdminStatsService } from '@gitroom/nestjs-libraries/database/prisma/admin-stats/admin-stats.service';
import { AnalyticsRepository } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.repository';
import { AnalyticsService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.service';
import { AnalyticsSnapshotService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.snapshot.service';
import { AnalyticsReportService } from '@gitroom/nestjs-libraries/database/prisma/analytics/analytics.report.service';
import { AffiliateRepository } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.repository';
import { AffiliateService } from '@gitroom/nestjs-libraries/database/prisma/affiliates/affiliate.service';
import { ReviewRepository } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.repository';
import { ReviewService } from '@gitroom/nestjs-libraries/database/prisma/reviews/review.service';
import { ActivationRepository } from '@gitroom/nestjs-libraries/database/prisma/activation/activation.repository';
import { ActivationService } from '@gitroom/nestjs-libraries/database/prisma/activation/activation.service';
import { LoginLockoutService } from '@gitroom/nestjs-libraries/services/login.lockout.service';
import { IdeasRepository } from '@gitroom/nestjs-libraries/database/prisma/ideas/ideas.repository';
import { IdeasService } from '@gitroom/nestjs-libraries/database/prisma/ideas/ideas.service';
import { StudioRepository } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.repository';
import { StudioService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.service';
import { StudioScheduleService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.schedule.service';
import { StudioAiService } from '@gitroom/nestjs-libraries/database/prisma/studio/studio.ai.service';
import { PostsEvergreenRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.repository';
import { PostsEvergreenService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.evergreen.service';
import { PostsImportRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.repository';
import { PostsImportService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.import.service';
import { PostsBulkVideosService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.bulk.videos.service';
import { WeeklySummaryRepository } from '@gitroom/nestjs-libraries/database/prisma/weekly-summary/weekly.summary.repository';
import { WeeklySummaryService } from '@gitroom/nestjs-libraries/database/prisma/weekly-summary/weekly.summary.service';
import { TrialOnboardingRepository } from '@gitroom/nestjs-libraries/database/prisma/trial-onboarding/trial.onboarding.repository';
import { TrialOnboardingService } from '@gitroom/nestjs-libraries/database/prisma/trial-onboarding/trial.onboarding.service';
import { IntegrationAuthorizationLifecycleService } from '@gitroom/nestjs-libraries/integrations/integration.authorization.lifecycle.service';
import { ActivityLogRepository } from '@gitroom/nestjs-libraries/database/prisma/activity-log/activity.log.repository';
import { ActivityLogService } from '@gitroom/nestjs-libraries/database/prisma/activity-log/activity.log.service';
import { ApprovalsRepository } from '@gitroom/nestjs-libraries/database/prisma/approvals/approvals.repository';
import { ApprovalPolicyService } from '@gitroom/nestjs-libraries/database/prisma/approvals/approval.policy.service';
import { ApprovalsService } from '@gitroom/nestjs-libraries/database/prisma/approvals/approvals.service';

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [
    PrismaService,
    PrismaRepository,
    PrismaTransaction,
    UsersService,
    UsersRepository,
    OrganizationService,
    OrganizationRepository,
    SubscriptionService,
    SubscriptionRepository,
    NotificationService,
    NotificationsRepository,
    WebhooksRepository,
    WebhooksService,
    IntegrationService,
    IntegrationRepository,
    PostsService,
    PostsRepository,
    StripeService,
    PaymentService,
    PaymentProviderManager,
    RevenueCatProvider,
    SignatureRepository,
    AutopostRepository,
    AutopostService,
    SignatureService,
    MediaService,
    MediaRepository,
    AgenciesService,
    AgenciesRepository,
    IntegrationManager,
    RefreshIntegrationService,
    IntegrationAuthorizationLifecycleService,
    ExtractContentService,
    OpenaiService,
    DeepgramService,
    ClippingService,
    ClippingRepository,
    FalService,
    EmailService,
    TrackService,
    ShortLinkService,
    SetsService,
    SetsRepository,
    ThirdPartyRepository,
    ThirdPartyService,
    AiCredentialRepository,
    AiCredentialService,
    OAuthRepository,
    OAuthService,
    VideoManager,
    StudioTemplateManager,
    AnnouncementsRepository,
    AnnouncementsService,
    ErrorsRepository,
    ErrorsService,
    AdminStatsRepository,
    AdminStatsService,
    AnalyticsRepository,
    AnalyticsService,
    AnalyticsSnapshotService,
    AnalyticsReportService,
    AffiliateRepository,
    AffiliateService,
    ReviewRepository,
    ReviewService,
    ActivationRepository,
    ActivationService,
    LoginLockoutService,
    ActivityLogRepository,
    ActivityLogService,
    ApprovalsRepository,
    ApprovalPolicyService,
    ApprovalsService,
    IdeasRepository,
    IdeasService,
    StudioRepository,
    StudioService,
    StudioScheduleService,
    StudioAiService,
    PostsEvergreenRepository,
    PostsEvergreenService,
    PostsImportRepository,
    PostsImportService,
    PostsBulkVideosService,
    WeeklySummaryRepository,
    WeeklySummaryService,
    TrialOnboardingRepository,
    TrialOnboardingService,
  ],
  get exports() {
    return this.providers;
  },
})
export class DatabaseModule {}
