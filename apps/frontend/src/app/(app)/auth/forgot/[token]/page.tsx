export const dynamic = 'force-dynamic';
import { ForgotReturn } from '@gitroom/frontend/components/auth/forgot-return';
import { Metadata } from 'next';
export const metadata: Metadata = {
  title: `PostDelegate Forgot Password`,
  description:
    'Choose a new password for your PostDelegate account.',
  openGraph: {
    title: 'Choose a new PostDelegate password',
    description:
      'Choose a new password for your PostDelegate account.',
    siteName: 'PostDelegate',
  },
};
export default async function Auth(params: {
  params: Promise<{
    token: string;
  }>;
}) {
  return <ForgotReturn token={(await params.params).token} />;
}
