export const dynamic = 'force-dynamic';
import { Forgot } from '@gitroom/frontend/components/auth/forgot';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `PostDelegate Forgot Password`,
  description:
    'Reset the password of your PostDelegate account.',
  openGraph: {
    title: 'Reset your PostDelegate password',
    description:
      'Reset the password of your PostDelegate account.',
    siteName: 'PostDelegate',
  },
};
export default async function Auth() {
  return <Forgot />;
}
