export const dynamic = 'force-dynamic';
import { AdminAffiliatesComponent } from '@gitroom/frontend/components/admin/admin-affiliates.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: `PostDelegate Admin Affiliates`,
};

export default async function Page() {
  return (
    <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] gap-[12px]">
      <AdminAffiliatesComponent />
    </div>
  );
}
