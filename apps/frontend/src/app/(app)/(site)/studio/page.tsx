import { StudioComponent } from '@gitroom/frontend/components/studio/studio.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: `PostDelegate Studio`,
};

export default async function Page() {
  return <StudioComponent />;
}
