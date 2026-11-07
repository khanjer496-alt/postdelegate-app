import type { ShareKind } from './storage';

export const MENU_IDS: Record<ShareKind, string> = {
  page: 'share-page',
  selection: 'share-selection',
  image: 'share-image',
};

export const MENU_ITEMS: {
  kind: ShareKind;
  title: string;
  contexts: NonNullable<chrome.contextMenus.CreateProperties['contexts']>;
}[] = [
  { kind: 'page', title: 'Share page to PostDelegate', contexts: ['page'] },
  {
    kind: 'selection',
    title: 'Share selection to PostDelegate',
    contexts: ['selection'],
  },
  { kind: 'image', title: 'Share image to PostDelegate', contexts: ['image'] },
];

export function kindFromMenuId(id: string | number): ShareKind | undefined {
  return (Object.keys(MENU_IDS) as ShareKind[]).find(
    (kind) => MENU_IDS[kind] === id
  );
}
