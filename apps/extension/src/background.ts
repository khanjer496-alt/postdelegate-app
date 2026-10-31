import { POPUP_PATH } from './lib/constants';
import { kindFromMenuId, MENU_IDS, MENU_ITEMS } from './lib/menus';
import { setPendingShare } from './lib/storage';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    MENU_ITEMS.forEach(({ kind, title, contexts }) =>
      chrome.contextMenus.create({ id: MENU_IDS[kind], title, contexts })
    );
  });
});

async function openShareUi(windowId?: number) {
  try {
    await chrome.action.openPopup(windowId ? { windowId } : undefined);
  } catch {
    // openPopup can fail (for example when the window is not focused), fall
    // back to a small standalone window that shows the same page.
    await chrome.windows.create({
      url: chrome.runtime.getURL(`${POPUP_PATH}?window=1`),
      type: 'popup',
      width: 420,
      height: 680,
    });
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const kind = kindFromMenuId(info.menuItemId);
  if (!kind) {
    return;
  }

  await setPendingShare({
    kind,
    tabId: tab?.id,
    url: info.pageUrl || tab?.url,
    title: tab?.title,
    selection: kind === 'selection' ? info.selectionText : undefined,
    imageUrl: kind === 'image' ? info.srcUrl : undefined,
    at: Date.now(),
  });
  await openShareUi(tab?.windowId);
});
