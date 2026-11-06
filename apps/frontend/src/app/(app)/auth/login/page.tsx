export const dynamic = 'force-dynamic';
import { Login } from '@gitroom/frontend/components/auth/login';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `PostDelegate Login`,
  description:
    'Sign in to PostDelegate to plan, schedule and publish your social media posts from one calendar.',
  openGraph: {
    title: 'Sign in to PostDelegate',
    description:
      'Sign in to PostDelegate to plan, schedule and publish your social media posts from one calendar.',
    siteName: 'PostDelegate',
  },
};
export default async function Auth() {
  return <Login />;
}
