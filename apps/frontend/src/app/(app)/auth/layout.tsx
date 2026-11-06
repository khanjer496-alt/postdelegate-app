import { getT } from '@gitroom/react/translation/get.translation.service.backend';

export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import loadDynamic from 'next/dynamic';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { CookieSettingsButton } from '@gitroom/frontend/components/layout/cookie.consent';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const t = await getT();

  return (
    <MantineWrapper>
      <Toaster />
      <div className="bg-[#080A0F] flex flex-1 p-[12px] gap-[12px] min-h-screen w-screen text-[#F7F7F2]">
        {/*<style>{`html, body {overflow-x: hidden;}`}</style>*/}
        <ReturnUrlComponent />
        <div className="flex flex-col py-[40px] px-[20px] flex-1 lg:w-[600px] lg:flex-none rounded-[16px] ring-1 ring-[#262B37] text-white p-[12px] bg-[#11141C]">
          <div className="w-full max-w-[440px] mx-auto justify-center gap-[20px] h-full flex flex-col text-white">
            <LogoTextComponent />
            <main className="flex">{children}</main>
            <CookieSettingsButton className="self-start text-[13px] text-[#9299AA] hover:text-white underline underline-offset-2" />
          </div>
        </div>
        <div className="auth-brand-panel text-[36px] flex-1 pt-[88px] hidden lg:flex flex-col items-center rounded-[16px] ring-1 ring-[#262B37]">
          <div className="text-center font-[800] leading-[1.1] tracking-[-0.035em]">
            Plan, publish, and grow
            <br />
            with <span className="text-[#C8FF4D]">PostDelegate</span>
          </div>
          <a
            href="/source"
            target="_blank"
            rel="noreferrer"
            className="mt-[20px] text-[14px] text-[#9299AA] hover:text-white"
          >
            {t('source_code', 'Source code')}
          </a>
        </div>
      </div>
    </MantineWrapper>
  );
}
