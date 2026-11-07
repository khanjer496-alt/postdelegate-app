export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { ClientApproval } from '@gitroom/frontend/components/approvals/client.approval';

export const metadata: Metadata = {
  title: 'Approve posts',
  description: 'Posts shared with you for approval on PostDelegate.',
  // a private link, never listed by search engines
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function ApprovePage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  return <ClientApproval token={token} />;
}
