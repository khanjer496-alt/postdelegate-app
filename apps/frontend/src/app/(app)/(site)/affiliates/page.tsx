export const dynamic = 'force-dynamic';
import { AffiliatesComponent } from '@gitroom/frontend/components/affiliates/affiliates.component';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `PostDelegate Affiliates`,
};
export default async function Page() {
  return (
    <div className="bg-newBgColorInner flex-1 flex-col flex p-[20px] gap-[12px]">
      <AffiliatesComponent />
    </div>
  );
}
