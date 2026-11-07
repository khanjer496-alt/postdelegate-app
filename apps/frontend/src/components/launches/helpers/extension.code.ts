// The browser extension hands its session cookies to the connect page through
// the tab's sessionStorage, so they never sit in a URL (history, logs,
// referrers). Storage can be blocked (private mode), so every call is guarded.
const extensionCodeKey = (state: string) => `extension-code:${state}`;

// false when storage is blocked, the caller then falls back to the URL
export const putExtensionCode = (state: string, code: string) => {
  try {
    sessionStorage.setItem(extensionCodeKey(state), code);
    return true;
  } catch (e) {
    return false;
  }
};

export const readExtensionCode = (state?: string) => {
  if (!state || typeof window === 'undefined') {
    return undefined;
  }
  try {
    return sessionStorage.getItem(extensionCodeKey(state)) || undefined;
  } catch (e) {
    return undefined;
  }
};

// only once the backend answered, a reload after a network error can retry
export const clearExtensionCode = (state?: string) => {
  if (!state || typeof window === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(extensionCodeKey(state));
  } catch (e) {
    // storage blocked, nothing was stored
  }
};
