import PostDelegate, { Integration } from '@postdelegate/node';
import { APP_URL, CALENDAR_URL } from '../lib/constants';
import { composeText, isShareableUrl, isUploadableImageUrl, textToHtml } from '../lib/compose';
import { mapApiError } from '../lib/errors';
import { getPageDetails } from '../lib/page';
import { defaultScheduleValue, isInFuture, localInputToIso, toLocalInputValue } from '../lib/schedule';
import { clearConnection, getSettings, saveSettings, takePendingShare } from '../lib/storage';

type PostKind = 'now' | 'schedule' | 'draft';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const views = ['view-loading', 'view-connect', 'view-main', 'view-success'];
const state = {
  client: undefined as PostDelegate | undefined,
  channels: [] as Integration[],
  selected: new Set<string>(),
  imageUrl: '',
  busy: false,
};

if (new URLSearchParams(location.search).has('window')) {
  document.body.classList.add('windowed');
}

function show(view: string) {
  views.forEach((id) => ($(id).hidden = id !== view));
  const connected = view === 'view-main' || view === 'view-success';
  $('disconnect').hidden = !connected;
}

function showError(id: string, message: string) {
  const el = $(id);
  el.textContent = message;
  el.hidden = false;
}

function hideError(id: string) {
  $(id).hidden = true;
}

function setBusy(busy: boolean) {
  state.busy = busy;
  ['post-now', 'schedule', 'draft', 'connect-button'].forEach(
    (id) => (($(id) as HTMLButtonElement).disabled = busy)
  );
}

// ---------------------------------------------------------------- connect

async function connect(event: Event) {
  event.preventDefault();
  hideError('connect-error');
  const apiKey = $<HTMLInputElement>('api-key').value.trim();
  if (!apiKey) {
    return showError('connect-error', 'Paste your API key first.');
  }

  setBusy(true);
  try {
    const me = await new PostDelegate(apiKey).me();
    await saveSettings({ apiKey, orgName: me.organization?.name });
    $<HTMLInputElement>('api-key').value = '';
    await showMain();
  } catch (error) {
    const mapped = mapApiError(error);
    showError(
      'connect-error',
      mapped.kind === 'auth'
        ? 'That API key was not accepted. Copy it again from PostDelegate and try again.'
        : mapped.message
    );
  } finally {
    setBusy(false);
  }
}

async function disconnect() {
  await clearConnection();
  state.client = undefined;
  state.channels = [];
  state.selected.clear();
  show('view-connect');
}

// ------------------------------------------------------------------- main

function updateCharCount() {
  const length = $<HTMLTextAreaElement>('text').value.length;
  $('char-count').textContent = `${length} characters`;
}

function renderChannels() {
  const list = $('channels');
  list.replaceChildren();
  $('no-channels').hidden = state.channels.length > 0;
  list.hidden = state.channels.length === 0;

  state.channels.forEach((channel) => {
    const row = document.createElement('label');
    row.className = 'channel';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.selected.has(channel.id);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? state.selected.add(channel.id) : state.selected.delete(channel.id);
      saveSettings({ lastChannelIds: [...state.selected] });
    });

    const initial = (channel.name || '?').trim().charAt(0).toUpperCase();
    const avatar = document.createElement(channel.picture ? 'img' : 'span');
    avatar.className = 'avatar';
    if (avatar instanceof HTMLImageElement && channel.picture) {
      // some avatars are stored as app-relative paths
      avatar.src = new URL(channel.picture, APP_URL).href;
      avatar.alt = '';
      avatar.referrerPolicy = 'no-referrer';
      avatar.addEventListener('error', () => {
        const fallback = document.createElement('span');
        fallback.className = 'avatar';
        fallback.textContent = initial;
        avatar.replaceWith(fallback);
      });
    } else {
      avatar.textContent = initial;
    }

    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = channel.name;

    const type = document.createElement('span');
    type.className = 'channel-type';
    type.textContent = channel.identifier.split('-')[0];

    row.append(checkbox, avatar, name, type);
    list.append(row);
  });
}

async function loadShareContext() {
  const pending = await takePendingShare();
  let tabId = pending?.tabId;
  let url = pending?.url;
  let title = pending?.title;

  if (!pending) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    url = tab?.url;
    title = tab?.title;
  }

  const details = await getPageDetails(tabId);
  const kind = pending?.kind;
  const selection = kind === 'page' || kind === 'image' ? '' : pending?.selection || details.selection;

  return {
    text: composeText({
      selection,
      title,
      url: isShareableUrl(url) ? url : undefined,
    }),
    imageUrl: kind === 'image' ? pending?.imageUrl || '' : details.ogImage,
    isSharedImage: kind === 'image',
  };
}

function renderImage(imageUrl: string, isSharedImage: boolean) {
  state.imageUrl = imageUrl;
  const row = $('image-row');
  if (!imageUrl) {
    row.hidden = true;
    return;
  }
  const checkbox = $<HTMLInputElement>('include-image');
  const uploadable = isUploadableImageUrl(imageUrl);
  $<HTMLImageElement>('image-preview').src = imageUrl;
  $('image-label').textContent = uploadable
    ? isSharedImage
      ? 'Attach this image'
      : 'Include page image'
    : 'This image cannot be attached (only https images work)';
  checkbox.disabled = !uploadable;
  checkbox.checked = uploadable && isSharedImage;
  row.hidden = false;
}

async function showMain() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    return show('view-connect');
  }

  state.client = new PostDelegate(settings.apiKey);
  $('org-name').textContent = settings.orgName ? `Connected to ${settings.orgName}` : '';
  $('org-name').hidden = !settings.orgName;
  hideError('main-error');
  $('reconnect').hidden = true;
  show('view-loading');

  const scheduleInput = $<HTMLInputElement>('schedule-at');
  scheduleInput.min = toLocalInputValue(new Date());
  scheduleInput.value = defaultScheduleValue();

  try {
    const [context, integrations] = await Promise.all([
      loadShareContext(),
      state.client.integrations(),
    ]);

    $<HTMLTextAreaElement>('text').value = context.text;
    updateCharCount();
    renderImage(context.imageUrl, context.isSharedImage);

    state.channels = integrations.filter((channel) => !channel.disabled);
    const remembered = (settings.lastChannelIds || []).filter((id) =>
      state.channels.some((channel) => channel.id === id)
    );
    state.selected = new Set(
      remembered.length ? remembered : state.channels.length === 1 ? [state.channels[0].id] : []
    );
    renderChannels();
    show('view-main');
  } catch (error) {
    show('view-main');
    handleError(error);
  }
}

function handleError(error: unknown, prefix = '') {
  const mapped = mapApiError(error);
  showError('main-error', prefix + mapped.message);
  $('reconnect').hidden = !mapped.reconnect;
}

async function submit(kind: PostKind) {
  if (state.busy || !state.client) {
    return;
  }
  hideError('main-error');
  $('reconnect').hidden = true;

  const text = $<HTMLTextAreaElement>('text').value;
  const includeImage = !$<HTMLInputElement>('include-image').disabled && $<HTMLInputElement>('include-image').checked && !!state.imageUrl;
  if (!text.trim() && !includeImage) {
    return showError('main-error', 'Write something to share first.');
  }
  if (!state.selected.size) {
    return showError('main-error', 'Pick at least one channel.');
  }

  let date = new Date().toISOString();
  if (kind === 'schedule') {
    const iso = localInputToIso($<HTMLInputElement>('schedule-at').value);
    if (!iso) {
      return showError('main-error', 'Pick a valid date and time to schedule.');
    }
    if (!isInFuture(iso)) {
      return showError('main-error', 'Pick a time in the future.');
    }
    date = iso;
  }

  setBusy(true);
  try {
    let image: { id: string; path: string }[] = [];
    if (includeImage) {
      try {
        const media = await state.client.uploadFromUrl(state.imageUrl);
        image = [{ id: media.id, path: media.path }];
      } catch (error) {
        const mapped = mapApiError(error);
        if (mapped.kind === 'auth') {
          throw error;
        }
        return handleError(error, 'Could not attach the image: ');
      }
    }

    const ids = [...state.selected];
    await state.client.post({
      type: kind === 'draft' ? 'draft' : kind,
      date,
      shortLink: false,
      tags: [],
      posts: ids.map((id) => ({
        integration: { id },
        value: [{ content: textToHtml(text), image }],
        settings: {},
      })),
    });

    await saveSettings({ lastChannelIds: ids });
    showSuccess(kind, ids.length, date);
  } catch (error) {
    handleError(error);
  } finally {
    setBusy(false);
  }
}

function showSuccess(kind: PostKind, count: number, date: string) {
  const channels = `${count} channel${count === 1 ? '' : 's'}`;
  if (kind === 'now') {
    $('success-title').textContent = 'Posting now';
    $('success-detail').textContent = `Sent to ${channels}. It will be published within a minute.`;
  } else if (kind === 'schedule') {
    $('success-title').textContent = 'Scheduled';
    $('success-detail').textContent = `${channels}, ${new Date(date).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`;
  } else {
    $('success-title').textContent = 'Saved as draft';
    $('success-detail').textContent = `Draft created for ${channels}. Finish it in the calendar.`;
  }
  $<HTMLAnchorElement>('calendar-link').href = CALENDAR_URL;
  show('view-success');
}

// ------------------------------------------------------------------- init

$('connect-form').addEventListener('submit', connect);
$('disconnect').addEventListener('click', disconnect);
$('reconnect').addEventListener('click', disconnect);
$('done').addEventListener('click', () => window.close());
$('text').addEventListener('input', updateCharCount);
$('post-now').addEventListener('click', () => submit('now'));
$('schedule').addEventListener('click', () => submit('schedule'));
$('draft').addEventListener('click', () => submit('draft'));

(async () => {
  const settings = await getSettings();
  if (settings.apiKey) {
    await showMain();
  } else {
    show('view-connect');
  }
})();
