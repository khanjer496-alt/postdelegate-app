export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { AfterActivate } from '@gitroom/frontend/components/auth/after.activate';
export const metadata: Metadata = {
  title: 'PostDelegate - Activate your account',
  description:
    'Confirm your email address to activate your PostDelegate account.',
  openGraph: {
    title: 'Activate your PostDelegate account',
    description:
      'Confirm your email address to activate your PostDelegate account.',
    siteName: 'PostDelegate',
  },
};
export default async function Auth() {
  return <AfterActivate />;
}
