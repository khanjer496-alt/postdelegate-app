import { ReactNode } from 'react';
import { PreviewWrapper } from '@gitroom/frontend/components/preview/preview.wrapper';

// No app chrome: the report is a document to print or save as PDF
export default async function AnalyticsReportLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <PreviewWrapper>{children}</PreviewWrapper>;
}
