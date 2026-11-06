export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { ReviewInbox } from '@gitroom/frontend/components/approvals/review.inbox';
export const metadata: Metadata = {
  title: `PostDelegate Review`,
};
export default async function Index() {
  return (
    <div className="flex flex-1 min-w-0 flex-col">
      <ReviewInbox />
    </div>
  );
}
