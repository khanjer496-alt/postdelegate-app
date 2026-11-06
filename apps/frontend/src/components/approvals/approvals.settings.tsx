'use client';

import { FC, ReactNode, useCallback, useEffect, useId, useState } from 'react';
import clsx from 'clsx';
import { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import {
  readError,
  useApprovalSettings,
} from '@gitroom/frontend/components/approvals/approvals.hooks';

// An on/off switch with the native button semantics
const Switch: FC<{
  checked: boolean;
  onChange: (value: boolean) => void;
  labelledBy: string;
  describedBy?: string;
}> = ({ checked, onChange, labelledBy, describedBy }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-labelledby={labelledBy}
    aria-describedby={describedBy}
    onClick={() => onChange(!checked)}
    className={clsx(
      'shrink-0 w-[52px] h-[30px] p-[3px] rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
      checked ? 'bg-btnPrimary border-btnPrimary' : 'bg-newBgColor border-newTableBorder'
    )}
  >
    <span
      aria-hidden="true"
      className={clsx(
        'block w-[22px] h-[22px] rounded-full bg-white shadow transition-transform',
        checked ? 'translate-x-[22px] rtl:-translate-x-[22px]' : 'translate-x-0'
      )}
    />
  </button>
);

const ToggleRow: FC<{
  title: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}> = ({ title, description, checked, onChange }) => {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-[16px]">
      <div className="flex flex-col gap-[2px] min-w-0">
        <span id={`${id}-title`} className="text-[14px] font-[600]">
          {title}
        </span>
        <span id={`${id}-desc`} className="text-[13px] text-textItemBlur">
          {description}
        </span>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        labelledBy={`${id}-title`}
        describedBy={`${id}-desc`}
      />
    </div>
  );
};

const Section: FC<{ title: string; description?: string; children: ReactNode }> = ({
  title,
  description,
  children,
}) => (
  <section className="rounded-[12px] border border-newTableBorder bg-newBgColorInner p-[20px] mobile:p-[16px] flex flex-col gap-[18px]">
    <div className="flex flex-col gap-[4px]">
      <h3 className="text-[16px] font-[600]">{title}</h3>
      {!!description && (
        <p className="text-[13px] text-textItemBlur">{description}</p>
      )}
    </div>
    {children}
  </section>
);

const checkboxRow =
  'flex items-center gap-[10px] min-h-[36px] px-[10px] rounded-[8px] hover:bg-boxHover cursor-pointer text-[14px]';

export const ApprovalsSettings: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, isLoading, mutate } = useApprovalSettings();
  const { data: integrations } = useIntegrationList();
  const maxId = useId();

  const [requireApproval, setRequireApproval] = useState(false);
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [requireAgentApproval, setRequireAgentApproval] = useState(false);
  const [requireApiApproval, setRequireApiApproval] = useState(false);
  const [agentIntegrationIds, setAgentIntegrationIds] = useState<string[]>([]);
  const [maxPerDay, setMaxPerDay] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) {
      return;
    }
    setRequireApproval(data.requireApproval);
    setApproverIds(data.approverIds);
    setRequireAgentApproval(data.requireAgentApproval);
    setRequireApiApproval(data.requireApiApproval);
    setAgentIntegrationIds(data.agentIntegrationIds);
    setMaxPerDay(data.agentMaxPostsPerDay ? String(data.agentMaxPostsPerDay) : '');
  }, [data]);

  const toggle = (list: string[], id: string, value: boolean) =>
    value ? [...new Set([...list, id])] : list.filter((p) => p !== id);

  const maxValue = maxPerDay.trim() ? Number(maxPerDay) : null;
  const maxInvalid =
    maxValue !== null &&
    (!Number.isInteger(maxValue) || maxValue < 1 || maxValue > 10000);

  const save = useCallback(async () => {
    if (maxInvalid) {
      return;
    }
    setSaving(true);
    const response = await fetch('/approvals/settings', {
      method: 'PUT',
      body: JSON.stringify({
        requireApproval,
        approverIds,
        requireAgentApproval,
        requireApiApproval,
        agentIntegrationIds,
        agentMaxPostsPerDay: maxValue,
      }),
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(
        await readError(
          response,
          t('approval_settings_failed', 'Could not save the settings')
        ),
        'warning'
      );
      return;
    }
    mutate(await response.json(), { revalidate: false });
    globalMutate('/approvals/review/count');
    toaster.show(t('settings_updated', 'Settings updated'), 'success');
  }, [
    maxInvalid,
    maxValue,
    requireApproval,
    approverIds,
    requireAgentApproval,
    requireApiApproval,
    agentIntegrationIds,
    fetch,
    toaster,
    t,
    mutate,
    globalMutate,
  ]);

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-[16px]" aria-busy="true">
        <div className="h-[160px] rounded-[12px] bg-newBgColorInner animate-pulse" />
        <div className="h-[240px] rounded-[12px] bg-newBgColorInner animate-pulse" />
      </div>
    );
  }

  if (!data.isAdmin) {
    return (
      <p className="text-[14px] text-textItemBlur">
        {t(
          'approval_settings_admin_only',
          'Only workspace admins can change approval settings.'
        )}
      </p>
    );
  }

  const isAdminRole = (role: string) => role === 'ADMIN' || role === 'SUPERADMIN';
  const channels = (integrations || []).filter((p: any) => !p.disabled);

  return (
    <div className="flex flex-col gap-[16px] text-newTextColor">
      <div className="flex flex-col gap-[4px]">
        <h2 className="text-[20px] font-[600]">
          {t('approval_settings_title', 'Approvals')}
        </h2>
        <p className="text-[14px] text-textItemBlur">
          {t(
            'approval_settings_intro',
            'Decide which posts need a second pair of eyes before they go out. Posts that wait for approval show up in Review.'
          )}
        </p>
      </div>

      <Section title={t('approval_team_section', 'Team posts')}>
        <ToggleRow
          title={t('approval_require', 'Require approval before publishing')}
          description={t(
            'approval_require_description',
            "Posts by members who can't approve are sent for review instead of being scheduled."
          )}
          checked={requireApproval}
          onChange={setRequireApproval}
        />
        <fieldset className="flex flex-col gap-[6px]">
          <legend className="text-[14px] font-[600] mb-[4px]">
            {t('approval_who_can_approve', 'Who can approve')}
          </legend>
          <p className="text-[13px] text-textItemBlur mb-[6px]">
            {t(
              'approval_who_can_approve_description',
              'Admins can always approve. Pick other members who can approve too.'
            )}
          </p>
          <div className="flex flex-col">
            {data.members.map((member) => {
              const admin = isAdminRole(member.role);
              return (
                <label
                  key={member.id}
                  className={clsx(checkboxRow, admin && 'cursor-default')}
                >
                  <input
                    type="checkbox"
                    className="w-[16px] h-[16px] accent-btnPrimary"
                    checked={admin || approverIds.includes(member.id)}
                    disabled={admin}
                    onChange={(e) =>
                      setApproverIds(
                        toggle(approverIds, member.id, e.target.checked)
                      )
                    }
                  />
                  <span className="flex-1 min-w-0 truncate">
                    {member.name || member.email}
                    {!!member.name && (
                      <span className="text-textItemBlur"> · {member.email}</span>
                    )}
                  </span>
                  {admin && (
                    <span className="text-[12px] text-textItemBlur shrink-0">
                      {t('approval_admin', 'Admin')}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>
      </Section>

      <Section
        title={t('approval_agent_section', 'AI agent guardrails')}
        description={t(
          'approval_agent_section_description',
          'Rules for posts created by AI agents, like Claude or ChatGPT through MCP, the public API, the CLI and the PostDelegate agent. They are checked on our servers, and agents get a clear message when a rule stops them.'
        )}
      >
        <ToggleRow
          title={t('approval_require_agent', 'Require approval for AI-created posts')}
          description={t(
            'approval_require_agent_description',
            'When this is on, posts from MCP clients and the PostDelegate agent wait in Approvals until someone approves them.'
          )}
          checked={requireAgentApproval}
          onChange={setRequireAgentApproval}
        />
        {requireAgentApproval && (
          <div className="ps-[16px] border-s-2 border-newTableBorder">
            <ToggleRow
              title={t(
                'approval_require_api',
                'Also require approval for API and CLI posts'
              )}
              description={t(
                'approval_require_api_description',
                'Posts from the public API (API keys and connected apps) and the CLI wait for approval too. MCP clients always follow the setting above.'
              )}
              checked={requireApiApproval}
              onChange={setRequireApiApproval}
            />
          </div>
        )}

        <fieldset className="flex flex-col gap-[6px]">
          <legend className="text-[14px] font-[600] mb-[4px]">
            {t('approval_agent_channels', 'Channels agents can post to')}
          </legend>
          <p className="text-[13px] text-textItemBlur mb-[6px]">
            {agentIntegrationIds.length
              ? t(
                  'approval_agent_channels_some',
                  'Agents can only post to the checked channels.'
                )
              : t(
                  'approval_agent_channels_all',
                  'All channels. Check some to limit agents to them.'
                )}
          </p>
          {!channels.length ? (
            <p className="text-[13px] text-textItemBlur">
              {t('approval_no_channels', 'No channels connected yet.')}
            </p>
          ) : (
            <div className="grid grid-cols-2 mobile:grid-cols-1 gap-x-[8px]">
              {channels.map((channel: any) => (
                <label key={channel.id} className={checkboxRow}>
                  <input
                    type="checkbox"
                    className="w-[16px] h-[16px] accent-btnPrimary"
                    checked={agentIntegrationIds.includes(channel.id)}
                    onChange={(e) =>
                      setAgentIntegrationIds(
                        toggle(agentIntegrationIds, channel.id, e.target.checked)
                      )
                    }
                  />
                  <img
                    src={`/icons/platforms/${channel.identifier}.png`}
                    alt=""
                    className="w-[18px] h-[18px] rounded-[4px] shrink-0"
                  />
                  <span className="truncate">{channel.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-[6px]">
          <label htmlFor={maxId} className="text-[14px] font-[600]">
            {t('approval_agent_max', 'Max posts agents can create per day')}
          </label>
          <input
            id={maxId}
            type="number"
            inputMode="numeric"
            min={1}
            max={10000}
            value={maxPerDay}
            placeholder={t('approval_no_limit', 'No limit')}
            onChange={(e) => setMaxPerDay(e.target.value)}
            // the settings page sits inside the profile form, Enter saves here
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              }
            }}
            aria-invalid={maxInvalid}
            aria-describedby={`${maxId}-help`}
            className={clsx(
              'h-[44px] w-[200px] mobile:w-full rounded-[8px] border bg-newBgColor px-[12px] text-[14px] text-newTextColor outline-none focus-visible:ring-2 focus-visible:ring-btnPrimary',
              maxInvalid ? 'border-red-500' : 'border-newTableBorder'
            )}
          />
          <p
            id={`${maxId}-help`}
            className={clsx(
              'text-[13px]',
              maxInvalid ? 'text-red-500' : 'text-textItemBlur'
            )}
          >
            {maxInvalid
              ? t('approval_agent_max_invalid', 'Enter a whole number from 1 to 10,000.')
              : t(
                  'approval_agent_max_help',
                  'Counted per day in UTC, across all agents. Leave empty for no limit.'
                )}
          </p>
        </div>
      </Section>

      <div className="flex justify-end">
        <Button
          loading={saving}
          disabled={maxInvalid}
          onClick={save}
          className="rounded-[8px] min-w-[140px]"
        >
          {t('approval_save', 'Save')}
        </Button>
      </div>
    </div>
  );
};
