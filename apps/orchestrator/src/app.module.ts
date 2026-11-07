import { Module } from '@nestjs/common';
import { PostActivity } from '@gitroom/orchestrator/activities/post.activity';
import { getTemporalModule } from '@gitroom/nestjs-libraries/temporal/temporal.module';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { AutopostActivity } from '@gitroom/orchestrator/activities/autopost.activity';
import { EmailActivity } from '@gitroom/orchestrator/activities/email.activity';
import { IntegrationsActivity } from '@gitroom/orchestrator/activities/integrations.activity';
import { VideoActivity } from '@gitroom/orchestrator/activities/video.activity';
import { MediaActivity } from '@gitroom/orchestrator/activities/media.activity';
import { ClippingActivity } from '@gitroom/orchestrator/activities/clipping.activity';
import { VideoModule } from '@gitroom/nestjs-libraries/videos/video.module';
import { HealthController } from '@gitroom/orchestrator/health.controller';
import { IntegrationAuthorizationMaintenanceActivity } from '@gitroom/orchestrator/activities/integration.authorization.maintenance.activity';
import { AnalyticsHistoryActivity } from '@gitroom/orchestrator/activities/analytics.history.activity';
import { WeeklySummaryActivity } from '@gitroom/orchestrator/activities/weekly.summary.activity';
import { TrialOnboardingActivity } from '@gitroom/orchestrator/activities/trial.onboarding.activity';
import { StudioActivity } from '@gitroom/orchestrator/activities/studio.activity';
import { StudioModule } from '@gitroom/nestjs-libraries/studio/studio.module';

const activities = [
  PostActivity,
  AutopostActivity,
  EmailActivity,
  IntegrationsActivity,
  VideoActivity,
  MediaActivity,
  ClippingActivity,
  IntegrationAuthorizationMaintenanceActivity,
  AnalyticsHistoryActivity,
  WeeklySummaryActivity,
  TrialOnboardingActivity,
  StudioActivity,
];
@Module({
  imports: [
    DatabaseModule,
    VideoModule,
    StudioModule,
    getTemporalModule(true, require.resolve('./workflows'), activities),
  ],
  controllers: [HealthController],
  providers: [...activities],
  get exports() {
    return [...this.providers, ...this.imports];
  },
})
export class AppModule {}
