import { ErmisChat } from './client';
import {
  DefaultGenerics,
  ExtendableGenerics,
  MessageResponse,
  ThreadResponse,
  ChannelResponse,
  FormatMessageResponse,
  ReactionResponse,
  UserResponse,
} from './types';
import { addToMessageList, formatMessage } from './utils';

type ThreadReadStatus<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> = Record<
  string,
  {
    last_read: Date;
    last_read_message_id: string;
    unread_messages: number;
    user: UserResponse<ErmisChatGenerics>;
  }
>;

export class Thread<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  id: string;
  latestReplies: FormatMessageResponse<ErmisChatGenerics>[] = [];
  participants: ThreadResponse['thread_participants'] = [];
  message: FormatMessageResponse<ErmisChatGenerics>;
  channel: ChannelResponse<ErmisChatGenerics>;
  _channel: ReturnType<ErmisChat<ErmisChatGenerics>['channel']>;
  replyCount = 0;
  _client: ErmisChat<ErmisChatGenerics>;
  read: ThreadReadStatus<ErmisChatGenerics> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Record<string, any> = {};

  constructor(client: ErmisChat<ErmisChatGenerics>, t: ThreadResponse<ErmisChatGenerics>) {
    const {
      parent_message_id,
      parent_message,
      latest_replies,
      thread_participants,
      reply_count,
      channel,
      read,
      ...data
    } = t;

    this.id = parent_message_id;
    this.message = formatMessage(parent_message);
    this.latestReplies = latest_replies.map(formatMessage);
    this.participants = thread_participants;
    this.replyCount = reply_count;
    this.channel = channel;
    this._channel = client.channel(t.channel.type, t.channel.id);
    this._client = client;
    if (read) {
      for (const r of read) {
        this.read[r.user.id] = {
          ...r,
          last_read: new Date(r.last_read),
        };
      }
    }
    this.data = data;
  }

  getClient(): ErmisChat<ErmisChatGenerics> {
    return this._client;
  }

  /**
   * addReply - Adds or updates a latestReplies to the thread
   *
   * @param {MessageResponse<ErmisChatGenerics>} message reply message to be added.
   */
  addReply(message: MessageResponse<ErmisChatGenerics>) {
    if (message.parent_id !== this.message.id) {
      throw new Error('Message does not belong to this thread');
    }

    this.latestReplies = addToMessageList(this.latestReplies, formatMessage(message), true);
  }

  updateReply(message: MessageResponse<ErmisChatGenerics>) {
    this.latestReplies = this.latestReplies.map((m) => {
      if (m.id === message.id) {
        return formatMessage(message);
      }
      return m;
    });
  }

  updateMessageOrReplyIfExists(message: MessageResponse<ErmisChatGenerics>) {
    if (!message.parent_id && message.id !== this.message.id) {
      return;
    }

    if (message.parent_id && message.parent_id !== this.message.id) {
      return;
    }

    if (message.parent_id && message.parent_id === this.message.id) {
      this.updateReply(message);
      return;
    }

    if (!message.parent_id && message.id === this.message.id) {
      this.message = formatMessage(message);
    }
  }

  addReaction(
    reaction: ReactionResponse<ErmisChatGenerics>,
    message?: MessageResponse<ErmisChatGenerics>,
    enforce_unique?: boolean,
  ) {
    if (!message) return;

    this.latestReplies = this.latestReplies.map((m) => {
      if (m.id === message.id) {
        return formatMessage(
          this._channel.state.addReaction(reaction, message, enforce_unique) as MessageResponse<ErmisChatGenerics>,
        );
      }
      return m;
    });
  }

  removeReaction(reaction: ReactionResponse<ErmisChatGenerics>, message?: MessageResponse<ErmisChatGenerics>) {
    if (!message) return;

    this.latestReplies = this.latestReplies.map((m) => {
      if (m.id === message.id) {
        return formatMessage(
          this._channel.state.removeReaction(reaction, message) as MessageResponse<ErmisChatGenerics>,
        );
      }
      return m;
    });
  }
}
