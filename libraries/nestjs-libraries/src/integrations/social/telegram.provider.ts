import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
//@ts-ignore
import mime from 'mime';
import TelegramBot from 'node-telegram-bot-api';
import { Integration } from '@prisma/client';

const telegramBot = new TelegramBot(process.env.TELEGRAM_TOKEN!);
// Added to support local storage posting
const frontendURL = process.env.FRONTEND_URL || 'http://localhost:5000';
const mediaStorage = process.env.STORAGE_PROVIDER || 'local';

// The tags Telegram's HTML parse mode accepts, by the tag the editor writes
const TELEGRAM_TAGS: Record<string, string> = {
  b: 'b',
  strong: 'b',
  i: 'i',
  em: 'i',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  code: 'code',
  pre: 'pre',
};

// Telegram refuses a caption over 1,024 characters, a text message takes 4,096
const TELEGRAM_CAPTION_LENGTH = 1024;

const escapeTelegram = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export class TelegramProvider extends SocialAbstract implements SocialProvider {
  override maxConcurrentJob = 3; // Telegram has moderate bot API limits
  identifier = 'telegram';
  name = 'Telegram';
  isBetweenSteps = false;
  isWeb3 = true;
  scopes = [] as string[];
  editor = 'html' as const;
  maxLength() {
    return 4096;
  }

  // Media goes out with the text as its caption, which Telegram caps lower
  // than a text message
  override async checkValidity(
    posts: Array<ValidityMedia[]>,
    settings: any,
    additionalSettings: any[],
    texts: string[] = []
  ): Promise<string | true> {
    // Telegram counts the text it shows, without the markup
    const shown = (text: string) =>
      this.formatMessage(text || '')
        .replace(/<[^>]*>/g, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
    const tooLong = (posts || []).some(
      (media, index) =>
        (media || []).length > 0 &&
        shown(texts[index]).length > TELEGRAM_CAPTION_LENGTH
    );
    if (tooLong) {
      return `A Telegram post with media can have at most ${TELEGRAM_CAPTION_LENGTH} characters of text, shorten the text or send the media in a reply`;
    }

    return true;
  }

  // The editor's HTML (<p dir="auto">, lists, headings, links) as the HTML
  // Telegram's parse mode accepts: paragraphs and <br> become line breaks,
  // only Telegram's own tags are kept, and the text is escaped again since
  // the content arrives with &lt; &gt; &amp; decoded.
  formatMessage(html: string) {
    const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
    const open: string[] = [];
    let text = '';
    let last = 0;

    const lineBreak = () => {
      if (text.length && !text.endsWith('\n')) {
        text += '\n';
      }
    };

    for (const match of html.matchAll(tagPattern)) {
      text += escapeTelegram(html.slice(last, match.index));
      last = match.index! + match[0].length;
      const closing = !!match[1];
      const name = match[2].toLowerCase();
      const top = open[open.length - 1];

      // Telegram takes no markup inside code, only the closing tag counts
      if (
        (top === 'code' || top === 'pre') &&
        !(closing && TELEGRAM_TAGS[name] === top)
      ) {
        text += ['p', 'br'].includes(name)
          ? closing || name === 'br'
            ? '\n'
            : ''
          : escapeTelegram(match[0]);
      } else if (name === 'p') {
        text += closing ? '\n' : '';
      } else if (name === 'br') {
        text += '\n';
      } else if (['h1', 'h2', 'h3'].includes(name)) {
        // on the stack like the other tags, so a stray heading tag stays balanced
        if (!closing) {
          open.push('b');
          text += '<b>';
        } else if (top === 'b') {
          open.pop();
          text += '</b>\n';
        } else {
          text += escapeTelegram(match[0]);
        }
      } else if (name === 'ul' || name === 'ol') {
        lineBreak();
      } else if (name === 'li') {
        if (closing) {
          lineBreak();
        } else {
          text += '- ';
        }
      } else if (name === 'a') {
        // a link Telegram can't open keeps its text without the link, '' on
        // the stack so its closing tag is dropped too
        if (!closing) {
          const href = /\shref="([^"]*)"/i.exec(match[3])?.[1] || '';
          const link = /^(https?:|tg:|mailto:)/i.test(href) ? 'a' : '';
          open.push(link);
          text += link ? `<a href="${escapeTelegram(href)}">` : '';
        } else if (['a', ''].includes(top)) {
          text += open.pop() ? '</a>' : '';
        }
      } else if (TELEGRAM_TAGS[name]) {
        const tag = TELEGRAM_TAGS[name];
        if (!closing) {
          open.push(tag);
          text += `<${tag}>`;
        } else if (top === tag) {
          open.pop();
          text += `</${tag}>`;
        } else {
          text += escapeTelegram(match[0]);
        }
      } else {
        // not markup the editor writes: text that had "<" in it
        text += escapeTelegram(match[0]);
      }
    }
    text += escapeTelegram(html.slice(last));

    // a tag left open would make Telegram refuse the whole message
    while (open.length) {
      const tag = open.pop();
      text += tag ? `</${tag}>` : '';
    }

    return text.replace(/\n+$/, '');
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeSecureId(17);
    return {
      url: state,
      codeVerifier: makeSecureId(10),
      state,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const chat = await telegramBot.getChat(params.code);

    console.log(JSON.stringify(chat));
    if (!chat?.id) {
      return 'No chat found';
    }

    const photo = !chat?.photo?.big_file_id
      ? ''
      : await telegramBot.getFileLink(chat.photo.big_file_id);

    // Modified id to work with chat.username (public groups/channels) or chat.id (private groups/channels) when chat.username is not available
    return {
      id: String(chat.username ? chat.username : chat.id),
      name: chat.title!,
      accessToken: String(chat.id),
      refreshToken: '',
      expiresIn: dayjs().add(200, 'year').unix() - dayjs().unix(),
      picture: photo || '',
      username: chat.username!,
    };
  }

  async getBotId(query: { id?: number; word: string }) {
    // Added allowed_updates Ensure only necessary updates are fetched
    const res = await telegramBot.getUpdates({
      ...(query.id ? { offset: query.id } : {}),
      allowed_updates: ['message', 'channel_post'],
    });
    //message.text is for groups, channel_post.text is for channels
    const match = res.find(
      (p) =>
        (p?.message?.text === `/connect ${query.word}` &&
          p?.message?.chat?.id) ||
        (p?.channel_post?.text === `/connect ${query.word}` &&
          p?.channel_post?.chat?.id)
    );
    // get correct chatId based on the channel type
    const chatId = match?.message?.chat?.id || match?.channel_post?.chat?.id;

    // prevents the code from running while chatId is still undefined to avoid the error 'ETELEGRAM: 400 Bad Request: chat_id is empty'. the code would still work eventually but console spam is not pretty
    if (chatId) {
      //get the numberic ID of the bot
      const botId = (await telegramBot.getMe()).id;
      // check if the bot is an admin in the chat
      const isAdmin = await this.botIsAdmin(chatId, botId);
      // get the messageId of the message that triggered the connection
      const connectMessageId =
        match?.message?.message_id || match?.channel_post?.message_id;

      if (!isAdmin) {
        // alternatively you can replace this with a console.log if you do not want to inform the user of the bot's admin status
        telegramBot.sendMessage(
          chatId,
          "Connection Successful. I don't have admin privileges to delete these messages, please go ahead and remove them yourself."
        );
      } else {
        // Delete the message that triggered the connection
        await telegramBot.deleteMessage(chatId, connectMessageId);
        // Send success message to the chat
        const successMessage = await telegramBot.sendMessage(
          chatId,
          'Connection Successful. Message will be deleted in 10 seconds.'
        );
        // Delete the success message after 10 seconds
        setTimeout(async () => {
          await telegramBot.deleteMessage(chatId, successMessage.message_id);
          console.log('Success message deleted.');
        }, 10000);
      }
    }

    // modified lastChatId to work with any type of channel (private/public groups/channels)
    return chatId
      ? { chatId }
      : res.length > 0
      ? {
          lastChatId: res[res.length - 1].update_id + 1,
        }
      : {};
  }

  private processMedia(mediaFiles: PostDetails['media']) {
    return (mediaFiles || []).map((media) => {
      let mediaUrl = media.path;
      if (mediaStorage === 'local' && mediaUrl.startsWith(frontendURL)) {
        mediaUrl = mediaUrl.replace(frontendURL, '');
      }
      // node-telegram-bot-api uploads any existing local path it is given, so
      // everything that isn't a url has to be a file of the upload directory
      if (mediaUrl.indexOf('http') !== 0) {
        mediaUrl = this.localMediaPath(mediaUrl, 'telegram-error');
      }
      //get mime type to pass contentType to telegram api.
      //some photos and videos might not pass telegram api restrictions, so they are sent as documents instead of returning errors
      const mimeType = mime.getType(mediaUrl); // Detect MIME type
      let mediaType: 'photo' | 'video' | 'document';

      if (mimeType?.startsWith('image/')) {
        mediaType = 'photo';
      } else if (mimeType?.startsWith('video/')) {
        mediaType = 'video';
      } else {
        mediaType = 'document';
      }

      return {
        type: mediaType,
        media: mediaUrl,
        fileOptions: {
          filename: media.path.split('/').pop(),
          contentType: mimeType || 'application/octet-stream',
        },
      };
    });
  }

  private async sendMessage(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    try {
      return await this.sendMessageInternal(
        accessToken,
        message,
        replyToMessageId
      );
    } catch (error: any) {
      // A Telegram 400 is a permanent rejection of this request (caption too
      // long, media Telegram could not download, ...): retrying it can never
      // succeed, so surface it to the user instead.
      const body = error?.response?.body;
      if (error?.code === 'ETELEGRAM' && body?.error_code === 400) {
        const description = (body.description || '').replace(
          'Bad Request: ',
          ''
        );
        throw new BadBody(
          'telegram-error',
          JSON.stringify(body),
          Buffer.from(JSON.stringify(body)),
          description === 'failed to get HTTP URL content'
            ? 'Telegram could not download your media file, please check the file and try again'
            : `Telegram rejected the post: ${description}`
        );
      }
      throw error;
    }
  }

  private async sendMessageInternal(
    accessToken: string,
    message: PostDetails,
    replyToMessageId?: number
  ): Promise<number | null> {
    let messageId: number | null = null;
    const mediaFiles = message.media || [];
    const text = this.formatMessage(message.message || '');

    const processedMedia = this.processMedia(mediaFiles);

    // if there's no media, bot sends a text message only
    if (processedMedia.length === 0) {
      const response = await telegramBot.sendMessage(accessToken, text, {
        parse_mode: 'HTML',
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      });
      messageId = response.message_id;
    }
    // if there's only one media, bot sends the media with the text message as caption
    else if (processedMedia.length === 1) {
      const media = processedMedia[0];
      const options = {
        caption: text,
        parse_mode: 'HTML' as const,
        ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
      };
      const response =
        media.type === 'video'
          ? await telegramBot.sendVideo(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : media.type === 'photo'
          ? await telegramBot.sendPhoto(
              accessToken,
              media.media,
              options,
              media.fileOptions
            )
          : await telegramBot.sendDocument(
              accessToken,
              media.media,
              options,
              media.fileOptions
            );
      messageId = response.message_id;
    }
    // if there are multiple media, bot sends them as a media group - max 10 media per group - with the text as a caption (if there are more than 1 group, the caption will only be sent with the first group)
    else {
      const mediaGroups = this.chunkMedia(processedMedia, 10);
      for (let i = 0; i < mediaGroups.length; i++) {
        const mediaGroup = mediaGroups[i].map((m, index) => ({
          type: m.type === 'document' ? 'document' : m.type, // Documents are not allowed in media groups
          media: m.media,
          caption: i === 0 && index === 0 ? text : undefined,
          parse_mode: 'HTML',
        }));

        const response = await telegramBot.sendMediaGroup(
          accessToken,
          mediaGroup as any[],
          {
            ...(replyToMessageId && i === 0
              ? { reply_to_message_id: replyToMessageId }
              : {}),
          }
        );
        if (i === 0) {
          messageId = response[0].message_id;
        }
      }
    }

    return messageId;
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails[]
  ): Promise<PostResponse[]> {
    const [firstPost] = postDetails;

    const messageId = await this.sendMessage(accessToken, firstPost);

    // for private groups/channels message.id is undefined so the link generated by Postiz will be unusable "https://t.me/c/undefined/16"
    // to avoid that, we use accessToken instead of message.id and we generate the link manually removing the -100 from the start.
    if (messageId) {
      return [
        {
          id: firstPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails[],
    integration: Integration
  ): Promise<PostResponse[]> {
    const [commentPost] = postDetails;
    const replyToId = Number(lastCommentId || postId);

    const messageId = await this.sendMessage(accessToken, commentPost, replyToId);

    if (messageId) {
      return [
        {
          id: commentPost.id,
          postId: String(messageId),
          releaseURL: `https://t.me/${
            id !== 'undefined' ? id : `c/${accessToken.replace('-100', '')}`
          }/${messageId}`,
          status: 'completed',
        },
      ];
    }

    return [];
  }
  // chunkMedia is used to split media into groups of "size". 10 is used here because telegram api allows a maximum of 10 media per group
  private chunkMedia(media: { type: string; media: string }[], size: number) {
    const result = [];
    for (let i = 0; i < media.length; i += size) {
      result.push(media.slice(i, i + size));
    }
    return result;
  }

  async botIsAdmin(chatId: number, botId: number): Promise<boolean> {
    try {
      const chatMember = await telegramBot.getChatMember(chatId, botId);

      if (
        chatMember.status === 'administrator' ||
        chatMember.status === 'creator'
      ) {
        const permissions = chatMember.can_delete_messages;
        return !!permissions; // Return true if bot can delete messages
      }

      return false;
    } catch (error) {
      console.error('Error checking bot privileges:', error);
      return false;
    }
  }
}
