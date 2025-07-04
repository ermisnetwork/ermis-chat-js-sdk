import { Channel } from './channel';
import {
  ChannelMemberResponse,
  ChannelMembership,
  FormatMessageResponse,
  Event,
  ExtendableGenerics,
  DefaultGenerics,
  MessageSetType,
  MessageResponse,
  ReactionResponse,
  UserResponse,
  PendingMessageResponse,
  PollVote,
  PollResponse,
} from './types';
import { addToMessageList } from './utils';

type ChannelReadStatus<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> = Record<
  string,
  {
    last_read: Date;
    unread_messages: number;
    user: UserResponse<ErmisChatGenerics>;
    first_unread_message_id?: string;
    last_read_message_id?: string;
    last_send?: string;
  }
>;

/**
 * ChannelState - A container class for the channel state.
 */
export class ChannelState<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  _channel: Channel<ErmisChatGenerics>;
  watcher_count: number;
  typing: Record<string, Event<ErmisChatGenerics>>;
  read: ChannelReadStatus<ErmisChatGenerics>;
  pinnedMessages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>;
  pending_messages: Array<PendingMessageResponse<ErmisChatGenerics>>;
  threads: Record<string, Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>>;
  mutedUsers: Array<UserResponse<ErmisChatGenerics>>;
  watchers: Record<string, UserResponse<ErmisChatGenerics>>;
  members: Record<string, ChannelMemberResponse<ErmisChatGenerics>>;
  unreadCount: number;
  membership: ChannelMembership<ErmisChatGenerics>;
  last_message_at: Date | null;
  /**
   * Flag which indicates if channel state contain latest/recent messages or no.
   * This flag should be managed by UI sdks using a setter - setIsUpToDate.
   * When false, any new message (received by websocket event - message.new) will not
   * be pushed on to message list.
   */
  isUpToDate: boolean;
  /**
   * Disjoint lists of messages
   * Users can jump in the message list (with searching) and this can result in disjoint lists of messages
   * The state manages these lists and merges them when lists overlap
   * The messages array contains the currently active set
   */
  messageSets: {
    isCurrent: boolean;
    isLatest: boolean;
    messages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>;
  }[] = [];
  constructor(channel: Channel<ErmisChatGenerics>) {
    this._channel = channel;
    this.watcher_count = 0;
    this.typing = {};
    this.read = {};
    this.initMessages();
    this.pinnedMessages = [];
    this.pending_messages = [];
    this.threads = {};
    // a list of users to hide messages from
    this.mutedUsers = [];
    this.watchers = {};
    this.members = {};
    this.membership = {};
    this.unreadCount = 0;
    /**
     * Flag which indicates if channel state contain latest/recent messages or no.
     * This flag should be managed by UI sdks using a setter - setIsUpToDate.
     * When false, any new message (received by websocket event - message.new) will not
     * be pushed on to message list.
     */
    this.isUpToDate = true;
    this.last_message_at = channel?.state?.last_message_at != null ? new Date(channel.state.last_message_at) : null;
  }

  get messages() {
    return this.messageSets.find((s) => s.isCurrent)?.messages || [];
  }

  set messages(messages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>) {
    const index = this.messageSets.findIndex((s) => s.isCurrent);
    this.messageSets[index].messages = messages;
  }

  /**
   * The list of latest messages
   * The messages array not always contains the latest messages (for example if a user searched for an earlier message, that is in a different message set)
   */
  get latestMessages() {
    return this.messageSets.find((s) => s.isLatest)?.messages || [];
  }

  set latestMessages(messages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>) {
    const index = this.messageSets.findIndex((s) => s.isLatest);
    this.messageSets[index].messages = messages;
  }

  /**
   * addMessageSorted - Add a message to the state
   *
   * @param {MessageResponse<ErmisChatGenerics>} newMessage A new message
   * @param {boolean} timestampChanged Whether updating a message with changed created_at value.
   * @param {boolean} addIfDoesNotExist Add message if it is not in the list, used to prevent out of order updated messages from being added.
   * @param {MessageSetType} messageSetToAddToIfDoesNotExist Which message set to add to if message is not in the list (only used if addIfDoesNotExist is true)
   */
  addMessageSorted(
    newMessage: MessageResponse<ErmisChatGenerics>,
    timestampChanged = false,
    addIfDoesNotExist = true,
    messageSetToAddToIfDoesNotExist: MessageSetType = 'latest',
  ) {
    return this.addMessagesSorted(
      [newMessage],
      timestampChanged,
      false,
      addIfDoesNotExist,
      messageSetToAddToIfDoesNotExist,
    );
  }

  /**
   * formatMessage - Takes the message object. Parses the dates, sets __html
   * and sets the status to received if missing. Returns a message object
   *
   * @param {MessageResponse<ErmisChatGenerics>} message a message object
   *
   */
  formatMessage(message: MessageResponse<ErmisChatGenerics>): FormatMessageResponse<ErmisChatGenerics> {
    return {
      ...message,
      /**
       * @deprecated please use `html`
       */
      __html: message.html,
      // parse the date..
      // pinned_at: message.pinned_at ? new Date(message.pinned_at) : null,
      pinned_at: null,
      created_at: message.created_at ? new Date(message.created_at) : new Date(),
      updated_at: message.updated_at ? new Date(message.updated_at) : null,
      status: message.status || 'received',
    };
  }

  /**
   * addMessagesSorted - Add the list of messages to state and resorts the messages
   *
   * @param {Array<MessageResponse<ErmisChatGenerics>>} newMessages A list of messages
   * @param {boolean} timestampChanged Whether updating messages with changed created_at value.
   * @param {boolean} initializing Whether channel is being initialized.
   * @param {boolean} addIfDoesNotExist Add message if it is not in the list, used to prevent out of order updated messages from being added.
   * @param {MessageSetType} messageSetToAddToIfDoesNotExist Which message set to add to if messages are not in the list (only used if addIfDoesNotExist is true)
   *
   */
  addMessagesSorted(
    newMessages: MessageResponse<ErmisChatGenerics>[],
    timestampChanged = false,
    initializing = false,
    addIfDoesNotExist = true,
    messageSetToAddToIfDoesNotExist: MessageSetType = 'current',
  ) {
    const { messagesToAdd, targetMessageSetIndex } = this.findTargetMessageSet(
      newMessages,
      addIfDoesNotExist,
      messageSetToAddToIfDoesNotExist,
    );

    for (let i = 0; i < messagesToAdd.length; i += 1) {
      const isFromShadowBannedUser = messagesToAdd[i].shadowed;
      if (isFromShadowBannedUser) {
        continue;
      }
      // If message is already formatted we can skip the tasks below
      // This will be true for messages that are already present at the state -> this happens when we perform merging of message sets
      // This will be also true for message previews used by some SDKs
      const isMessageFormatted = messagesToAdd[i].created_at instanceof Date;
      let message: ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>;
      if (isMessageFormatted) {
        message = messagesToAdd[i] as ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>;
      } else {
        message = this.formatMessage(messagesToAdd[i] as MessageResponse<ErmisChatGenerics>);

        if (message.user && this._channel?.cid) {
          /**
           * Store the reference to user for this channel, so that when we have to
           * handle updates to user, we can use the reference map, to determine which
           * channels need to be updated with updated user object.
           */
          this._channel.getClient().state.updateUserReference(message.user, this._channel.cid);
        }

        if (initializing && message.id && this.threads[message.id]) {
          // If we are initializing the state of channel (e.g., in case of connection recovery),
          // then in that case we remove thread related to this message from threads object.
          // This way we can ensure that we don't have any stale data in thread object
          // and consumer can refetch the replies.
          delete this.threads[message.id];
        }

        if (!this.last_message_at) {
          this.last_message_at = new Date(message.created_at.getTime());
        }

        if (message.created_at.getTime() > this.last_message_at.getTime()) {
          this.last_message_at = new Date(message.created_at.getTime());
        }
      }

      // update or append the messages...
      const parentID = message.parent_id;

      // add to the given message set
      if ((!parentID || message.show_in_channel) && targetMessageSetIndex !== -1) {
        this.messageSets[targetMessageSetIndex].messages = this._addToMessageList(
          this.messageSets[targetMessageSetIndex].messages,
          message,
          timestampChanged,
          'created_at',
          addIfDoesNotExist,
        );
      }

      /**
       * Add message to thread if applicable and the message
       * was added when querying for replies, or the thread already exits.
       * This is to prevent the thread state from getting out of sync if
       * a thread message is shown in channel but older than the newest thread
       * message. This situation can result in a thread state where a random
       * message is "oldest" message, and newer messages are therefore not loaded.
       * This can also occur if an old thread message is updated.
       */
      if (parentID && !initializing) {
        const thread = this.threads[parentID] || [];
        const threadMessages = this._addToMessageList(
          thread,
          message,
          timestampChanged,
          'created_at',
          addIfDoesNotExist,
        );
        this.threads[parentID] = threadMessages;
      }
    }

    return {
      messageSet: this.messageSets[targetMessageSetIndex],
    };
  }

  /**
   * addPinnedMessages - adds messages in pinnedMessages property
   *
   * @param {Array<MessageResponse<ErmisChatGenerics>>} pinnedMessages A list of pinned messages
   *
   */
  addPinnedMessages(pinnedMessages: MessageResponse<ErmisChatGenerics>[]) {
    for (let i = 0; i < pinnedMessages.length; i += 1) {
      this.addPinnedMessage(pinnedMessages[i]);
    }
  }

  /**
   * addPinnedMessage - adds message in pinnedMessages
   *
   * @param {MessageResponse<ErmisChatGenerics>} pinnedMessage message to update
   *
   */
  addPinnedMessage(pinnedMessage: MessageResponse<ErmisChatGenerics>) {
    this.pinnedMessages = this._addToMessageList(
      this.pinnedMessages,
      this.formatMessage(pinnedMessage),
      false,
      'pinned_at',
    );
  }

  /**
   * removePinnedMessage - removes pinned message from pinnedMessages
   *
   * @param {MessageResponse<ErmisChatGenerics>} message message to remove
   *
   */
  removePinnedMessage(message: MessageResponse<ErmisChatGenerics>) {
    const { result } = this.removeMessageFromArray(this.pinnedMessages, message);
    this.pinnedMessages = result;
  }

  addReaction(
    reaction: ReactionResponse<ErmisChatGenerics>,
    message?: MessageResponse<ErmisChatGenerics>,
    enforce_unique?: boolean,
  ) {
    if (!message) return;
    const messageWithReaction = message;
    this._updateMessage(message, (msg) => {
      messageWithReaction.own_reactions = this._addOwnReactionToMessage(msg.own_reactions, reaction, enforce_unique);
      return this.formatMessage(messageWithReaction);
    });
    return messageWithReaction;
  }

  _addOwnReactionToMessage(
    ownReactions: ReactionResponse<ErmisChatGenerics>[] | null | undefined,
    reaction: ReactionResponse<ErmisChatGenerics>,
    enforce_unique?: boolean,
  ) {
    if (enforce_unique) {
      ownReactions = [];
    } else {
      ownReactions = this._removeOwnReactionFromMessage(ownReactions, reaction);
    }

    ownReactions = ownReactions || [];
    if (this._channel.getClient().userID === reaction.user_id) {
      ownReactions.push(reaction);
    }

    return ownReactions;
  }

  _removeOwnReactionFromMessage(
    ownReactions: ReactionResponse<ErmisChatGenerics>[] | null | undefined,
    reaction: ReactionResponse<ErmisChatGenerics>,
  ) {
    if (ownReactions) {
      return ownReactions.filter((item) => item.user_id !== reaction.user_id || item.type !== reaction.type);
    }
    return ownReactions;
  }

  removeReaction(reaction: ReactionResponse<ErmisChatGenerics>, message?: MessageResponse<ErmisChatGenerics>) {
    if (!message) return;
    const messageWithReaction = message;
    this._updateMessage(message, (msg) => {
      messageWithReaction.own_reactions = this._removeOwnReactionFromMessage(msg.own_reactions, reaction);
      return this.formatMessage(messageWithReaction);
    });
    return messageWithReaction;
  }

  removeQuotedMessageReferences(message: MessageResponse<ErmisChatGenerics>) {
    const parseMessage = (m: ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>) =>
      (({
        ...m,
        created_at: m.created_at.toISOString(),
        pinned_at: m.pinned_at?.toISOString(),
        updated_at: m.updated_at?.toISOString(),
      } as unknown) as MessageResponse<ErmisChatGenerics>);

    this.messageSets.forEach((set) => {
      const updatedMessages = set.messages
        .filter((msg) => msg.quoted_message_id === message.id)
        .map(parseMessage)
        .map((msg) => ({ ...msg, quoted_message: { ...message, attachments: [] } }));

      this.addMessagesSorted(updatedMessages, true);
    });
  }

  /**
   * Updates all instances of given message in channel state
   * @param message
   * @param updateFunc
   */
  _updateMessage(
    message: {
      id?: string;
      parent_id?: string;
      pinned?: boolean;
      show_in_channel?: boolean;
    },
    updateFunc: (
      msg: ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>,
    ) => ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>,
  ) {
    const { parent_id, show_in_channel, pinned } = message;

    if (parent_id && this.threads[parent_id]) {
      const thread = this.threads[parent_id];
      const msgIndex = thread.findIndex((msg) => msg.id === message.id);
      if (msgIndex !== -1) {
        thread[msgIndex] = updateFunc(thread[msgIndex]);
        this.threads[parent_id] = thread;
      }
    }

    if ((!show_in_channel && !parent_id) || show_in_channel) {
      const messageSetIndex = this.findMessageSetIndex(message);
      if (messageSetIndex !== -1) {
        const msgIndex = this.messageSets[messageSetIndex].messages.findIndex((msg) => msg.id === message.id);
        if (msgIndex !== -1) {
          this.messageSets[messageSetIndex].messages[msgIndex] = updateFunc(
            this.messageSets[messageSetIndex].messages[msgIndex],
          );
        }
      }
    }

    if (pinned) {
      const msgIndex = this.pinnedMessages.findIndex((msg) => msg.id === message.id);
      if (msgIndex !== -1) {
        this.pinnedMessages[msgIndex] = updateFunc(this.pinnedMessages[msgIndex]);
      }
    }
  }

  /**
   * Setter for isUpToDate.
   *
   * @param isUpToDate  Flag which indicates if channel state contain latest/recent messages or no.
   *                    This flag should be managed by UI sdks using a setter - setIsUpToDate.
   *                    When false, any new message (received by websocket event - message.new) will not
   *                    be pushed on to message list.
   */
  setIsUpToDate = (isUpToDate: boolean) => {
    this.isUpToDate = isUpToDate;
  };

  /**
   * _addToMessageList - Adds a message to a list of messages, tries to update first, appends if message isn't found
   *
   * @param {Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>} messages A list of messages
   * @param message
   * @param {boolean} timestampChanged Whether updating a message with changed created_at value.
   * @param {string} sortBy field name to use to sort the messages by
   * @param {boolean} addIfDoesNotExist Add message if it is not in the list, used to prevent out of order updated messages from being added.
   */
  _addToMessageList(
    messages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>,
    message: ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>,
    timestampChanged = false,
    sortBy: 'pinned_at' | 'created_at' = 'created_at',
    addIfDoesNotExist = true,
  ) {
    return addToMessageList(messages, message, timestampChanged, sortBy, addIfDoesNotExist);
  }

  /**
   * removeMessage - Description
   *
   * @param {{ id: string; parent_id?: string }} messageToRemove Object of the message to remove. Needs to have at id specified.
   *
   * @return {boolean} Returns if the message was removed
   */
  removeMessage(messageToRemove: { id: string; messageSetIndex?: number; parent_id?: string }) {
    let isRemoved = false;
    if (messageToRemove.parent_id && this.threads[messageToRemove.parent_id]) {
      const { removed, result: threadMessages } = this.removeMessageFromArray(
        this.threads[messageToRemove.parent_id],
        messageToRemove,
      );

      this.threads[messageToRemove.parent_id] = threadMessages;
      isRemoved = removed;
    } else {
      const messageSetIndex = messageToRemove.messageSetIndex ?? this.findMessageSetIndex(messageToRemove);
      if (messageSetIndex !== -1) {
        const { removed, result: messages } = this.removeMessageFromArray(
          this.messageSets[messageSetIndex].messages,
          messageToRemove,
        );
        this.messageSets[messageSetIndex].messages = messages;
        isRemoved = removed;
      }
    }

    return isRemoved;
  }

  removeMessageFromArray = (
    msgArray: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>,
    msg: { id: string; parent_id?: string },
  ) => {
    const result = msgArray.filter((message) => !(!!message.id && !!msg.id && message.id === msg.id));

    return { removed: result.length < msgArray.length, result };
  };

  // this handles the case when vote on poll is changed
  // updatePollVote = (
  //   pollVote: PollVote<ErmisChatGenerics>,
  //   poll: PollResponse<ErmisChatGenerics>,
  //   messageId: string,
  // ) => {
  //   const message = this.findMessage(messageId);
  //   if (!message) return;

  //   if (message.poll_id !== pollVote.poll_id) return;

  //   const updatedPoll = { ...poll };
  //   let ownVotes = [...(message.poll?.own_votes || [])];

  //   if (pollVote.user_id === this._channel.getClient().userID) {
  //     if (pollVote.option_id && poll.enforce_unique_vote) {
  //       // remove all previous votes where option_id is not empty
  //       ownVotes = ownVotes.filter((vote) => !vote.option_id);
  //     } else if (pollVote.answer_text) {
  //       // remove all previous votes where option_id is empty
  //       ownVotes = ownVotes.filter((vote) => vote.answer_text);
  //     }

  //     ownVotes.push(pollVote);
  //   }

  //   updatedPoll.own_votes = ownVotes as PollVote<ErmisChatGenerics>[];
  //   const newMessage = { ...message, poll: updatedPoll };

  //   this.addMessageSorted((newMessage as unknown) as MessageResponse<ErmisChatGenerics>, false, false);
  // };

  // addPollVote = (pollVote: PollVote<ErmisChatGenerics>, poll: PollResponse<ErmisChatGenerics>, messageId: string) => {
  //   const message = this.findMessage(messageId);
  //   if (!message) return;

  //   if (message.poll_id !== pollVote.poll_id) return;

  //   const updatedPoll = { ...poll };
  //   const ownVotes = [...(message.poll?.own_votes || [])];

  //   if (pollVote.user_id === this._channel.getClient().userID) {
  //     ownVotes.push(pollVote);
  //   }

  //   updatedPoll.own_votes = ownVotes as PollVote<ErmisChatGenerics>[];
  //   const newMessage = { ...message, poll: updatedPoll };

  //   this.addMessageSorted((newMessage as unknown) as MessageResponse<ErmisChatGenerics>, false, false);
  // };

  // removePollVote = (
  //   pollVote: PollVote<ErmisChatGenerics>,
  //   poll: PollResponse<ErmisChatGenerics>,
  //   messageId: string,
  // ) => {
  //   const message = this.findMessage(messageId);
  //   if (!message) return;

  //   if (message.poll_id !== pollVote.poll_id) return;

  //   const updatedPoll = { ...poll };
  //   const ownVotes = [...(message.poll?.own_votes || [])];
  //   if (pollVote.user_id === this._channel.getClient().userID) {
  //     const index = ownVotes.findIndex((vote) => vote.option_id === pollVote.option_id);
  //     if (index > -1) {
  //       ownVotes.splice(index, 1);
  //     }
  //   }

  //   updatedPoll.own_votes = ownVotes as PollVote<ErmisChatGenerics>[];

  //   const newMessage = { ...message, poll: updatedPoll };
  //   this.addMessageSorted((newMessage as unknown) as MessageResponse<ErmisChatGenerics>, false, false);
  // };

  // updatePoll = (poll: PollResponse<ErmisChatGenerics>, messageId: string) => {
  //   const message = this.findMessage(messageId);
  //   if (!message) return;

  //   const updatedPoll = {
  //     ...poll,
  //     own_votes: [...(message.poll?.own_votes || [])],
  //   };

  //   const newMessage = { ...message, poll: updatedPoll };

  //   this.addMessageSorted((newMessage as unknown) as MessageResponse<ErmisChatGenerics>, false, false);
  // };

  /**
   * Updates the message.user property with updated user object, for messages.
   *
   * @param {UserResponse<ErmisChatGenerics>} user
   */
  updateUserMessages = (user: UserResponse<ErmisChatGenerics>) => {
    const _updateUserMessages = (
      messages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>,
      user: UserResponse<ErmisChatGenerics>,
    ) => {
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        const latestReactions = m?.latest_reactions || [];
        if (m.user?.id === user.id) {
          messages[i] = {
            ...m,
            user: m.user?.id === user.id ? user : m.user,
          };
        }

        if (latestReactions && latestReactions.some((r) => r.user?.id === user.id)) {
          messages[i] = {
            ...m,
            latest_reactions: latestReactions.map((r) => (r.user?.id === user.id ? { ...r, user } : r)),
          };
        }
      }
    };

    this.messageSets.forEach((set) => _updateUserMessages(set.messages, user));

    // for (const parentId in this.threads) {
    //   _updateUserMessages(this.threads[parentId], user);
    // }

    _updateUserMessages(this.pinnedMessages, user);
  };

  /**
   * Marks the messages as deleted, from deleted user.
   *
   * @param {UserResponse<ErmisChatGenerics>} user
   * @param {boolean} hardDelete
   */
  deleteUserMessages = (user: UserResponse<ErmisChatGenerics>, hardDelete = false) => {
    const _deleteUserMessages = (
      messages: Array<ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>>,
      user: UserResponse<ErmisChatGenerics>,
      hardDelete = false,
    ) => {
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.user?.id !== user.id) {
          continue;
        }

        if (hardDelete) {
          /**
           * In case of hard delete, we need to strip down all text, html,
           * attachments and all the custom properties on message
           */
          messages[i] = ({
            cid: m.cid,
            created_at: m.created_at,
            deleted_at: user.deleted_at,
            id: m.id,
            latest_reactions: [],
            mentioned_users: [],
            own_reactions: [],
            parent_id: m.parent_id,
            reply_count: m.reply_count,
            status: m.status,
            thread_participants: m.thread_participants,
            type: 'deleted',
            updated_at: m.updated_at,
            user: m.user,
          } as unknown) as ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>;
        } else {
          messages[i] = {
            ...m,
            type: 'deleted',
            deleted_at: user.deleted_at,
          };
        }
      }
    };

    this.messageSets.forEach((set) => _deleteUserMessages(set.messages, user, hardDelete));

    for (const parentId in this.threads) {
      _deleteUserMessages(this.threads[parentId], user, hardDelete);
    }

    _deleteUserMessages(this.pinnedMessages, user, hardDelete);
  };

  /**
   * filterErrorMessages - Removes error messages from the channel state.
   *
   */
  filterErrorMessages() {
    const filteredMessages = this.latestMessages.filter((message) => message.type !== 'error');

    this.latestMessages = filteredMessages;
  }

  /**
   * clean - Remove stale data such as users that stayed in typing state for more than 5 seconds
   */
  clean() {
    const now = new Date();
    // prevent old users from showing up as typing
    for (const [userID, lastEvent] of Object.entries(this.typing)) {
      const receivedAt =
        typeof lastEvent.received_at === 'string'
          ? new Date(lastEvent.received_at)
          : lastEvent.received_at || new Date();
      if (now.getTime() - receivedAt.getTime() > 7000) {
        delete this.typing[userID];
        this._channel.getClient().dispatchEvent({
          cid: this._channel.cid,
          type: 'typing.stop',
          user: { id: userID },
        } as Event<ErmisChatGenerics>);
      }
    }
  }

  clearMessages() {
    this.initMessages();
    this.pinnedMessages = [];
  }

  initMessages() {
    this.messageSets = [{ messages: [], isLatest: true, isCurrent: true }];
  }

  /**
   * loadMessageIntoState - Loads a given message (and messages around it) into the state
   *
   * @param {string} messageId The id of the message, or 'latest' to indicate switching to the latest messages
   * @param {string} parentMessageId The id of the parent message, if we want load a thread reply
   */
  async loadMessageIntoState(messageId: string | 'latest', parentMessageId?: string, limit = 25) {
    let messageSetIndex: number;
    let switchedToMessageSet = false;
    let loadedMessageThread = false;
    const messageIdToFind = parentMessageId || messageId;
    if (messageId === 'latest') {
      if (this.messages === this.latestMessages) {
        return;
      }
      messageSetIndex = this.messageSets.findIndex((s) => s.isLatest);
    } else {
      messageSetIndex = this.findMessageSetIndex({ id: messageIdToFind });
    }
    if (messageSetIndex !== -1) {
      this.switchToMessageSet(messageSetIndex);
      switchedToMessageSet = true;
    }
    loadedMessageThread = !parentMessageId || !!this.threads[parentMessageId]?.find((m) => m.id === messageId);
    if (switchedToMessageSet && loadedMessageThread) {
      return;
    }
    if (!switchedToMessageSet) {
      await this._channel.query({ messages: { id_around: messageIdToFind, limit } }, 'new');
    }
    if (!loadedMessageThread && parentMessageId) {
      await this._channel.getReplies(parentMessageId, { id_around: messageId, limit });
    }
    messageSetIndex = this.findMessageSetIndex({ id: messageIdToFind });
    if (messageSetIndex !== -1) {
      this.switchToMessageSet(messageSetIndex);
    }
  }

  /**
   * findMessage - Finds a message inside the state
   *
   * @param {string} messageId The id of the message
   * @param {string} parentMessageId The id of the parent message, if we want load a thread reply
   *
   * @return {ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>} Returns the message, or undefined if the message wasn't found
   */
  findMessage(messageId: string, parentMessageId?: string) {
    if (parentMessageId) {
      const messages = this.threads[parentMessageId];
      if (!messages) {
        return undefined;
      }
      return messages.find((m) => m.id === messageId);
    }

    const messageSetIndex = this.findMessageSetIndex({ id: messageId });
    if (messageSetIndex === -1) {
      return undefined;
    }
    return this.messageSets[messageSetIndex].messages.find((m) => m.id === messageId);
  }

  private switchToMessageSet(index: number) {
    const currentMessages = this.messageSets.find((s) => s.isCurrent);
    if (!currentMessages) {
      return;
    }
    currentMessages.isCurrent = false;
    this.messageSets[index].isCurrent = true;
  }

  private areMessageSetsOverlap(messages1: Array<{ id: string }>, messages2: Array<{ id: string }>) {
    return messages1.some((m1) => messages2.find((m2) => m1.id === m2.id));
  }

  private findMessageSetIndex(message: { id?: string }) {
    return this.messageSets.findIndex((set) => !!set.messages.find((m) => m.id === message.id));
  }

  private findTargetMessageSet(
    newMessages: MessageResponse<ErmisChatGenerics>[],
    addIfDoesNotExist = true,
    messageSetToAddToIfDoesNotExist: MessageSetType = 'current',
  ) {
    let messagesToAdd: (
      | MessageResponse<ErmisChatGenerics>
      | ReturnType<ChannelState<ErmisChatGenerics>['formatMessage']>
    )[] = newMessages;
    let targetMessageSetIndex!: number;
    if (addIfDoesNotExist) {
      const overlappingMessageSetIndices = this.messageSets
        .map((_, i) => i)
        .filter((i) => this.areMessageSetsOverlap(this.messageSets[i].messages, newMessages));
      switch (messageSetToAddToIfDoesNotExist) {
        case 'new':
          if (overlappingMessageSetIndices.length > 0) {
            targetMessageSetIndex = overlappingMessageSetIndices[0];
            // No new message set is created if newMessages only contains thread replies
          } else if (newMessages.some((m) => !m.parent_id)) {
            this.messageSets.push({ messages: [], isCurrent: false, isLatest: false });
            targetMessageSetIndex = this.messageSets.length - 1;
          }
          break;
        case 'current':
          targetMessageSetIndex = this.messageSets.findIndex((s) => s.isCurrent);
          break;
        case 'latest':
          targetMessageSetIndex = this.messageSets.findIndex((s) => s.isLatest);
          break;
        default:
          targetMessageSetIndex = -1;
      }
      // when merging the target set will be the first one from the overlapping message sets
      const mergeTargetMessageSetIndex = overlappingMessageSetIndices.splice(0, 1)[0];
      const mergeSourceMessageSetIndices = [...overlappingMessageSetIndices];
      if (mergeTargetMessageSetIndex !== undefined && mergeTargetMessageSetIndex !== targetMessageSetIndex) {
        mergeSourceMessageSetIndices.push(targetMessageSetIndex);
      }
      // merge message sets
      if (mergeSourceMessageSetIndices.length > 0) {
        const target = this.messageSets[mergeTargetMessageSetIndex];
        const sources = this.messageSets.filter((_, i) => mergeSourceMessageSetIndices.indexOf(i) !== -1);
        sources.forEach((messageSet) => {
          target.isLatest = target.isLatest || messageSet.isLatest;
          target.isCurrent = target.isCurrent || messageSet.isCurrent;
          messagesToAdd = [...messagesToAdd, ...messageSet.messages];
        });
        sources.forEach((s) => this.messageSets.splice(this.messageSets.indexOf(s), 1));
        const overlappingMessageSetIndex = this.messageSets.findIndex((s) =>
          this.areMessageSetsOverlap(s.messages, newMessages),
        );
        targetMessageSetIndex = overlappingMessageSetIndex;
      }
    } else {
      // assumes that all new messages belong to the same set
      targetMessageSetIndex = this.findMessageSetIndex(newMessages[0]);
    }

    return { targetMessageSetIndex, messagesToAdd };
  }
}
