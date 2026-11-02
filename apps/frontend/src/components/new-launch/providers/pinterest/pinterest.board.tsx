'use client';

import { FC, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const PinterestBoard: FC<{
  name: string;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name } = props;
  const t = useT();

  const customFunc = useCustomProviderFunction();
  const [orgs, setOrgs] = useState<undefined | any[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const { getValues } = useSettings();
  const [currentMedia, setCurrentMedia] = useState<string | undefined>();
  const [boardName, setBoardName] = useState('');
  const [creating, setCreating] = useState(false);
  // true for a generic failure, or Pinterest's reason
  const [createFailed, setCreateFailed] = useState<boolean | string>(false);
  const onChangeInner = (event: {
    target: {
      value: string;
      name: string;
    };
  }) => {
    setCurrentMedia(event.target.value);
    onChange(event);
  };
  useEffect(() => {
    customFunc
      .get('boards')
      .catch(() => false)
      .then((data) => {
        // the dashboard function answers false when Pinterest refused
        if (Array.isArray(data)) {
          setOrgs(data);
        } else {
          setLoadFailed(true);
        }
      });
    const settings = getValues()[props.name];
    if (settings) {
      setCurrentMedia(settings);
    }
  }, []);

  // An account without boards (always the case at first in Pinterest's
  // sandbox, where boards made on pinterest.com don't exist) can create one
  // here and have it selected right away.
  const createBoard = async () => {
    if (!boardName.trim() || creating) {
      return;
    }
    setCreating(true);
    setCreateFailed(false);
    const board = await customFunc
      .get('createBoard', { name: boardName.trim() })
      .catch(() => false);
    setCreating(false);
    if (!board?.id) {
      setCreateFailed(
        typeof board?.error === 'string' && board.error ? board.error : true
      );
      return;
    }
    setOrgs([board]);
    onChangeInner({ target: { name, value: board.id } });
  };

  if (loadFailed) {
    return (
      <div className="text-[12px] text-red-400" role="alert">
        {t(
          'pinterest_boards_failed',
          'Pinterest could not load the boards of this account. Please try again later.'
        )}
      </div>
    );
  }
  if (!orgs) {
    return null;
  }
  if (!orgs.length) {
    return (
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">
          {t(
            'pinterest_no_boards',
            'No boards on this Pinterest account yet. Create one to post to it.'
          )}
        </div>
        <div className="flex gap-[6px]">
          <div className="flex-1 h-[42px] bg-newBgColorInner border-newTableBorder border rounded-[8px] flex items-center">
            <input
              className="h-full w-full bg-transparent outline-none px-[16px] text-[14px] text-textColor placeholder-textColor"
              placeholder={t('pinterest_board_name', 'Board name')}
              aria-label={t('pinterest_board_name', 'Board name')}
              value={boardName}
              maxLength={100}
              onChange={(e) => setBoardName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  createBoard();
                }
              }}
            />
          </div>
          <button
            type="button"
            className="h-[42px] px-[16px] flex items-center bg-newBgColorInner border-newTableBorder border rounded-[8px] text-[14px] disabled:opacity-50"
            disabled={!boardName.trim() || creating}
            onClick={createBoard}
          >
            {t('pinterest_create_board', 'Create board')}
          </button>
        </div>
        {!!createFailed && (
          <div className="text-[12px] text-red-400" role="alert">
            {typeof createFailed === 'string'
              ? createFailed
              : t(
                  'pinterest_create_board_failed',
                  'Pinterest could not create the board. Please try again.'
                )}
          </div>
        )}
      </div>
    );
  }
  return (
    <Select
      name={name}
      label="Select board"
      onChange={onChangeInner}
      value={currentMedia}
    >
      <option value="">{t('select_1', '--Select--')}</option>
      {orgs.map((org: any) => (
        <option key={org.id} value={org.id}>
          {org.name}
        </option>
      ))}
    </Select>
  );
};
