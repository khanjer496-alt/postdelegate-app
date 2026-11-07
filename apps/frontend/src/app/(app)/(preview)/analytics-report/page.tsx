export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AnalyticsReportPage } from '@gitroom/frontend/components/platform-analytics/analytics.report.page';

export const metadata: Metadata = {
  title: 'Analytics report',
};

export default async function Index(props: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const searchParams = await props.searchParams;
  return (
    <AnalyticsReportPage
      from={searchParams?.from || ''}
      to={searchParams?.to || ''}
    />
  );
}
