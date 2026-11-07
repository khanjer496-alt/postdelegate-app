export const dynamic = 'force-dynamic';
import { AdminReviewsComponent } from '@gitroom/frontend/components/admin/admin-reviews.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: `PostDelegate Admin Reviews`,
};

export default async function Page() {
  return (
    <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] gap-[12px]">
      <AdminReviewsComponent />
    </div>
  );
}
