import { IdeasComponent } from '@gitroom/frontend/components/ideas/ideas.component';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: `PostDelegate Ideas`,
};

export default async function Page() {
  return <IdeasComponent />;
}
