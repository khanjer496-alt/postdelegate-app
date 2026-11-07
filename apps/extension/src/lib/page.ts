export interface PageDetails {
  selection: string;
  ogImage: string;
}

/**
 * Runs inside the page through chrome.scripting.executeScript, so it must not
 * reference anything outside of its own body. Read-only: it only reads the
 * current selection and the page's preview image.
 */
export function readPageDetails(): PageDetails {
  const meta = (selector: string) =>
    document.querySelector<HTMLMetaElement>(selector)?.content?.trim() || '';
  const image =
    meta('meta[property="og:image:secure_url"]') ||
    meta('meta[property="og:image"]') ||
    meta('meta[name="twitter:image"]');

  let ogImage = '';
  if (image) {
    try {
      ogImage = new URL(image, document.baseURI).href;
    } catch {
      ogImage = '';
    }
  }

  return {
    selection: window.getSelection()?.toString() || '',
    ogImage,
  };
}

/** Reads the selection and preview image of a tab. Empty on restricted pages. */
export async function getPageDetails(tabId?: number): Promise<PageDetails> {
  if (tabId === undefined) {
    return { selection: '', ogImage: '' };
  }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: readPageDetails,
    });
    return (result?.result as PageDetails) || { selection: '', ogImage: '' };
  } catch {
    // chrome:// pages, the Web Store, PDFs viewers etc. cannot be scripted
    return { selection: '', ogImage: '' };
  }
}
