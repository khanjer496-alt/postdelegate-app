export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PlatformAnalytics } from '@gitroom/frontend/components/platform-analytics/platform.analytics';
import { AnalyticsOverview } from '@gitroom/frontend/components/platform-analytics/analytics.overview';
export const metadata: Metadata = {
  title: `PostDelegate Analytics`,
};
export default async function Index() {
  return (
    <div className="flex flex-1 min-w-0 flex-col gap-[1px]">
      <AnalyticsOverview />
      <div className="flex flex-1 min-w-0 gap-[1px] mobile:flex-col">
        <PlatformAnalytics />
      </div>
    </div>
  );
}
