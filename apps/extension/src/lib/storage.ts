// Everything lives in chrome.storage.local on this device. Nothing is written
// to chrome.storage.sync, so the API key is never copied to the user's Google
// account.

export interface Settings {
  apiKey?: string;
  orgName?: string;
  lastChannelIds?: string[];
}

export type ShareKind = 'page' | 'selection' | 'image';

/** Set by the context menu so the popup can open pre-filled. */
export interface PendingShare {
  kind: ShareKind;
  tabId?: number;
  url?: string;
  title?: string;
  selection?: string;
  imageUrl?: string;
  at: number;
}

const SETTINGS_KEY = 'settings';
const PENDING_KEY = 'pendingShare';
export const PENDING_TTL_MS = 60 * 1000;

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return (stored[SETTINGS_KEY] as Settings | undefined) || {};
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...patch } });
}

/** Forgets the key and the connection details but keeps nothing else. */
export async function clearConnection(): Promise<void> {
  await chrome.storage.local.remove(SETTINGS_KEY);
}

export async function setPendingShare(share: PendingShare): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: share });
}

/** Reads and removes the pending share. Expired entries are ignored. */
export async function takePendingShare(
  now: number = Date.now()
): Promise<PendingShare | undefined> {
  const stored = await chrome.storage.session.get(PENDING_KEY);
  const pending = stored[PENDING_KEY] as PendingShare | undefined;
  if (!pending) {
    return undefined;
  }
  await chrome.storage.session.remove(PENDING_KEY);
  return now - pending.at <= PENDING_TTL_MS ? pending : undefined;
}
