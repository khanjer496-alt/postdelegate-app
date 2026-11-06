'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface AiCredential {
  provider: 'openai';
  maskedKey: string;
}

export const useAiCredential = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    const response = await fetch('/ai-credentials');
    // an error body is not a credential: SWR keeps it as an error instead
    if (!response.ok) {
      throw new Error(`Could not load the AI key (${response.status})`);
    }
    // no saved key comes back as {}
    return response.json();
  }, []);

  return useSWR<Partial<AiCredential>>('ai-credentials', load);
};

export const AiSettings: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, isLoading, mutate } = useAiCredential();
  const [apiKey, setApiKey] = useState('');
  const [replacing, setReplacing] = useState(false);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(async () => {
    await mutate();
    await globalMutate('/user/self');
  }, [mutate, globalMutate]);

  const save = useCallback(async () => {
    if (!apiKey.trim()) {
      return;
    }
    setSaving(true);
    let response: Response;
    try {
      response = await fetch('/ai-credentials', {
        method: 'POST',
        body: JSON.stringify({ provider: 'openai', apiKey: apiKey.trim() }),
      });
    } catch {
      toaster.show(
        t('ai_key_save_failed', 'Could not save this key, please try again'),
        'warning'
      );
      return;
    } finally {
      setSaving(false);
    }

    // saving is limited per hour, and the throttler's own text is not for users
    if (response.status === 429) {
      toaster.show(
        t(
          'ai_key_too_many_attempts',
          'Too many attempts. Try again in an hour.'
        ),
        'warning'
      );
      return;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const message = Array.isArray(error?.message)
        ? error.message[0]
        : error?.message;
      toaster.show(
        message ||
          t('ai_key_save_failed', 'Could not save this key, please try again'),
        'warning'
      );
      return;
    }

    setApiKey('');
    setReplacing(false);
    await refresh();
    toaster.show(t('ai_key_saved', 'AI key saved'), 'success');
  }, [apiKey, fetch, refresh, toaster, t]);

  const remove = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'ai_key_remove_confirm',
          'Remove this AI key? AI features will turn off for this workspace.'
        ),
        t('remove', 'Remove')
      ))
    ) {
      return;
    }
    // on any failure the key is still saved, so the saved state stays as it is
    const response = await fetch('/ai-credentials', {
      method: 'DELETE',
    }).catch(() => undefined);
    if (!response?.ok) {
      toaster.show(
        t('ai_key_remove_failed', 'Could not remove this key, please try again'),
        'warning'
      );
      return;
    }

    setApiKey('');
    setReplacing(false);
    await refresh();
    toaster.show(t('ai_key_removed', 'AI key removed'), 'success');
  }, [fetch, refresh, toaster, t]);

  const showInput = !data?.maskedKey || replacing;

  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('ai_settings', 'AI')}</h3>
      <div className="text-textItemBlur mt-[4px]">
        {t(
          'ai_settings_description',
          "PostDelegate's AI writing, Agent and images run on your own OpenAI account. You pay OpenAI directly for what you use. A ChatGPT Plus subscription doesn't include API usage."
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[16px]">
        {isLoading ? (
          <div className="animate-pulse">{t('loading', 'Loading...')}</div>
        ) : error && data === undefined ? (
          // never shown as "no key": a failed load says nothing about the key
          <div className="text-[14px] text-red-400">
            {t(
              'ai_key_load_failed',
              'Could not load your AI key, please refresh the page'
            )}
          </div>
        ) : (
          <>
            {!!data?.maskedKey && (
              <div className="flex items-center justify-between gap-[16px] mobile:flex-col mobile:items-start">
                <div className="text-[14px] break-all">
                  {t('ai_openai_key', 'OpenAI key: {{maskedKey}}', {
                    maskedKey: data.maskedKey,
                  })}
                </div>
                <div className="flex gap-[8px]">
                  {!replacing && (
                    <Button
                      secondary
                      onClick={() => setReplacing(true)}
                      className="rounded-[8px]"
                    >
                      {t('replace', 'Replace')}
                    </Button>
                  )}
                  <Button secondary onClick={remove} className="rounded-[8px]">
                    {t('remove', 'Remove')}
                  </Button>
                </div>
              </div>
            )}
            {showInput && (
              <div className="flex flex-col gap-[8px]">
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[14px] underline underline-offset-4 hover:text-textItemFocused w-fit"
                >
                  {t('get_an_api_key', 'Get an API key')}
                </a>
                <div className="flex items-start gap-[8px] mobile:flex-col mobile:items-stretch">
                  <div className="flex-1">
                    <Input
                      label=""
                      name="openaiApiKey"
                      type="password"
                      autoComplete="new-password"
                      disableForm={true}
                      removeError={true}
                      placeholder="sk-..."
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onKeyDown={(e) => {
                        // The settings panel sits inside the profile form
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          save();
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={save}
                    loading={saving}
                    disabled={!apiKey.trim()}
                    className="rounded-[8px] h-[42px]"
                  >
                    {t('save', 'Save')}
                  </Button>
                  {replacing && (
                    <Button
                      secondary
                      onClick={() => {
                        setApiKey('');
                        setReplacing(false);
                      }}
                      className="rounded-[8px] h-[42px]"
                    >
                      {t('cancel', 'Cancel')}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
