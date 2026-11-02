jest.mock('node-telegram-bot-api', () => {
  const bot = {
    sendMessage: jest.fn(async () => ({ message_id: 7 })),
    sendPhoto: jest.fn(async () => ({ message_id: 8 })),
  };
  const TelegramBot = jest.fn(() => bot);
  (TelegramBot as any).bot = bot;
  return TelegramBot;
});

import TelegramBot from 'node-telegram-bot-api';
import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

const bot = (TelegramBot as any).bot as {
  sendMessage: jest.Mock;
  sendPhoto: jest.Mock;
};

// what the composer saves: tiptap writes <p dir="auto">, lists hold
// paragraphs, & < > are entities
const editorHtml =
  '<p dir="auto">Launch day &amp; <strong>big</strong> news: 2 &lt; 3 &gt; 1</p>' +
  '<p dir="auto"></p>' +
  '<h2 dir="auto">Details</h2>' +
  '<ul><li><p dir="auto">first</p></li><li><p dir="auto"><u>second</u></p></li></ul>' +
  '<p dir="auto">Read <a target="_blank" rel="noopener noreferrer nofollow" href="https://example.com/a?b=1&amp;c=2">the post</a></p>';

// the post activity hands Telegram (an html editor) the content this way
const asPublished = (html: string) =>
  stripHtmlValidation('html', html, true, false, !/<\/?[a-z][\s\S]*>/i.test(html));

describe('TelegramProvider.formatMessage', () => {
  const provider = new TelegramProvider();

  it('turns the editor output into the HTML Telegram accepts', () => {
    expect(provider.formatMessage(asPublished(editorHtml))).toBe(
      'Launch day &amp; <b>big</b> news: 2 &lt; 3 &gt; 1\n' +
        '\n' +
        '<b>Details</b>\n' +
        '- first\n' +
        '- <u>second</u>\n' +
        'Read <a href="https://example.com/a?b=1&amp;c=2">the post</a>'
    );
  });

  it('never leaves a <p> or an attribute Telegram refuses', () => {
    const text = provider.formatMessage(asPublished(editorHtml));
    expect(text).not.toMatch(/<p|dir=|target=|<\/?(ul|li|h2|strong)/);
    // every remaining tag is one Telegram knows
    expect(
      (text.match(/<\/?([a-z]+)/g) || []).every((tag) =>
        /^<\/?(b|i|u|s|a|code|pre)$/.test(tag)
      )
    ).toBe(true);
  });

  it('turns <br> into a line break and keeps Telegram tags', () => {
    expect(
      provider.formatMessage(
        'one<br>two<br/><em>three</em> <code>x</code> <del>y</del>'
      )
    ).toBe('one\ntwo\n<i>three</i> <code>x</code> <s>y</s>');
  });

  it('escapes text that only looks like markup, and closes what is left open', () => {
    expect(provider.formatMessage('a<b x<y and z>w <i>open')).toBe(
      'a&lt;b x&lt;y and z&gt;w <i>open</i>'
    );
  });

  it('keeps typed heading tags from unbalancing the message', () => {
    expect(provider.formatMessage('use </h1> to close <h2>Title')).toBe(
      'use &lt;/h1&gt; to close <b>Title</b>'
    );
  });

  it('takes no markup inside code', () => {
    expect(
      provider.formatMessage('<code>a <strong>b</strong> c</code> <b>d</b>')
    ).toBe('<code>a &lt;strong&gt;b&lt;/strong&gt; c</code> <b>d</b>');
  });

  it('drops a link Telegram cannot open but keeps its text', () => {
    expect(
      provider.formatMessage('<a href="javascript:alert(1)">click</a> done')
    ).toBe('click done');
  });

  it('escapes plain text without markup', () => {
    expect(provider.formatMessage('AT&T < Verizon')).toBe(
      'AT&amp;T &lt; Verizon'
    );
  });

  it('sends the converted text in HTML mode', async () => {
    bot.sendMessage.mockClear();
    await provider.post('channel', '-100123', [
      {
        id: 'post-1',
        message: asPublished('<p dir="auto">Hi &amp; bye</p>'),
        settings: {},
        media: [],
      } as any,
    ]);
    expect(bot.sendMessage).toHaveBeenCalledWith('-100123', 'Hi &amp; bye', {
      parse_mode: 'HTML',
    });
  });
});

describe('TelegramProvider.checkValidity', () => {
  const provider = new TelegramProvider();
  const long = asPublished(`<p dir="auto">${'a'.repeat(1025)}</p>`);
  const fits = asPublished(`<p dir="auto"><strong>${'a'.repeat(1024)}</strong></p>`);

  it('refuses a caption over 1,024 characters with media', async () => {
    expect(
      await provider.checkValidity([[{ path: 'a.png' }]], {}, [], [long])
    ).toMatch(/at most 1024 characters/);
  });

  it('counts the shown text, not the markup', async () => {
    expect(
      await provider.checkValidity([[{ path: 'a.png' }]], {}, [], [fits])
    ).toBe(true);
  });

  it('lets a long text message through, and checks replies too', async () => {
    expect(await provider.checkValidity([[]], {}, [], [long])).toBe(true);
    expect(
      await provider.checkValidity(
        [[], [{ path: 'b.png' }]],
        {},
        [],
        ['short', long]
      )
    ).toMatch(/1024/);
  });
});
