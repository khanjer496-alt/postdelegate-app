'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type Board = {
  id: string;
  name?: string;
};

// The label is Pinterest's own board name: strip the characters that reorder
// or hide text (C0 controls, zero width, the bidi controls) and collapse the
// whitespace, so a broken name can't render as a garbled option, and fall back
// to the id when nothing readable is left.
const boardLabel = (board: Board, t: ReturnType<typeof useT>) => {
  const name = (board.name || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return name || t('pinterest_unnamed_board', 'Board {{id}}', { id: board.id });
};

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
  const [orgs, setOrgs] = useState<undefined | Board[]>();
  const [loadFailed, setLoadFailed] = useState(false);
  const { getValues } = useSettings();
  const [currentMedia, setCurrentMedia] = useState<string | undefined>();
  const [boardName, setBoardName] = useState('');
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // true for a generic failure, or Pinterest's reason
  const [createFailed, setCreateFailed] = useState<boolean | string>(false);
  // read by the create call when Pinterest answers, which can be after the
  // row was cancelled - the state of that render is stale by then
  const showCreateRef = useRef(false);
  const openCreate = (open: boolean) => {
    showCreateRef.current = open;
    setShowCreate(open);
    setBoardName('');
    setCreateFailed(false);
  };
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

  // A board can be created from here at any time: an account without boards
  // (always the case at first in Pinterest's sandbox, where boards made on
  // pinterest.com don't exist) has no other way to get one, and an account
  // with boards can still post to a new one without leaving the composer.
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
      // the row may have been cancelled while Pinterest was answering
      if (showCreateRef.current || !orgs?.length) {
        setCreateFailed(
          typeof board?.error === 'string' && board.error ? board.error : true
        );
      }
      return;
    }
    setOrgs([...(orgs || []).filter((o) => o.id !== board.id), board]);
    openCreate(false);
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

  const hasBoards = !!orgs.length;
  return (
    <div className="flex flex-col gap-[6px]">
      {hasBoards ? (
        <Select
          name={name}
          label="Select board"
          onChange={onChangeInner}
          value={currentMedia}
        >
          <option value="">{t('select_1', '--Select--')}</option>
          {orgs.map((org) => (
            <option key={org.id} value={org.id}>
              {boardLabel(org, t)}
            </option>
          ))}
        </Select>
      ) : (
        <div className="text-[14px]">
          {t(
            'pinterest_no_boards',
            'No boards on this Pinterest account yet. Create one to post to it.'
          )}
        </div>
      )}
      {!hasBoards || showCreate ? (
        <div className="flex gap-[6px]">
          <div className="flex-1 h-[42px] bg-newBgColorInner border-newTableBorder border rounded-[8px] flex items-center">
            <input
              className="h-full w-full bg-transparent outline-none px-[16px] text-[14px] text-textColor placeholder-textColor"
              placeholder={t('pinterest_board_name', 'Board name')}
              aria-label={t('pinterest_board_name', 'Board name')}
              value={boardName}
              maxLength={100}
              onChange={(e) => {
                setBoardName(e.target.value);
                setCreateFailed(false);
              }}
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
          {hasBoards && (
            <button
              type="button"
              className="h-[42px] px-[16px] flex items-center text-[14px] underline"
              onClick={() => openCreate(false)}
            >
              {t('cancel', 'Cancel')}
            </button>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="self-start text-start text-[12px] underline"
          onClick={() => openCreate(true)}
        >
          {t('pinterest_new_board', '+ New board')}
        </button>
      )}
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
};
