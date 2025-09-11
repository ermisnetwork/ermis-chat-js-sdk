/* eslint no-unused-vars: "off" */
/* global process */

import axios, { AxiosError, AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import https from 'https';
import WebSocket from 'isomorphic-ws';

import { Channel } from './channel';
import { ClientState } from './client_state';
import { StableWSConnection } from './connection';
import { DevToken, JWTUserToken } from './signing';
import { TokenManager } from './token_manager';
import { WSConnectionFallback } from './connection_fallback';
import { Campaign } from './campaign';
import { Segment } from './segment';
import { isErrorResponse, isWSFailure } from './errors';
import { EventSourcePolyfill } from 'event-source-polyfill';
import {
  addFileToFormData,
  axiosParamsSerializer,
  chatCodes,
  enrichWithUserInfo,
  ensureMembersUserInfoLoaded,
  getDirectChannelImage,
  getDirectChannelName,
  isFunction,
  isOnline,
  isOwnUserBaseProperty,
  normalizeQuerySort,
  randomId,
  retryInterval,
  sleep,
} from './utils';

import {
  APIErrorResponse,
  APIResponse,
  AppSettings,
  AppSettingsAPIResponse,
  BannedUsersFilters,
  BannedUsersPaginationOptions,
  BannedUsersResponse,
  BannedUsersSort,
  BanUserOptions,
  BaseDeviceFields,
  BlockList,
  BlockListResponse,
  CampaignResponse,
  CampaignData,
  CampaignFilters,
  CampaignQueryOptions,
  ChannelAPIResponse,
  ChannelData,
  ChannelFilters,
  ChannelMute,
  ChannelOptions,
  ChannelResponse,
  ChannelSort,
  ChannelStateOptions,
  CheckPushResponse,
  CheckSNSResponse,
  CheckSQSResponse,
  Configs,
  ConnectAPIResponse,
  CreateChannelOptions,
  CreateChannelResponse,
  CreateCommandOptions,
  CreateCommandResponse,
  CreateImportOptions,
  CreateImportResponse,
  CreateImportURLResponse,
  CustomPermissionOptions,
  DeactivateUsersOptions,
  DefaultGenerics,
  DeleteChannelsResponse,
  DeleteCommandResponse,
  DeleteUserOptions,
  Device,
  EndpointName,
  ErrorFromResponse,
  Event,
  EventHandler,
  ExportChannelOptions,
  ExportChannelRequest,
  ExportChannelResponse,
  ExportChannelStatusResponse,
  ExportUsersRequest,
  ExportUsersResponse,
  ExtendableGenerics,
  FlagMessageResponse,
  FlagReportsFilters,
  FlagReportsPaginationOptions,
  FlagReportsResponse,
  FlagsFilters,
  FlagsPaginationOptions,
  FlagsResponse,
  FlagUserResponse,
  GetCallTokenResponse,
  GetChannelTypeResponse,
  GetCommandResponse,
  GetImportResponse,
  GetMessageAPIResponse,
  GetRateLimitsResponse,
  QueryThreadsAPIResponse,
  GetUnreadCountAPIResponse,
  GetUnreadCountBatchAPIResponse,
  ListChannelResponse,
  ListCommandsResponse,
  ListImportsPaginationOptions,
  ListImportsResponse,
  Logger,
  Message,
  MessageFilters,
  MessageFlagsFilters,
  MessageFlagsPaginationOptions,
  MessageFlagsResponse,
  MessageResponse,
  Mute,
  MuteUserOptions,
  MuteUserResponse,
  OGAttachment,
  OwnUserResponse,
  PartialMessageUpdate,
  PartialPollUpdate,
  PartialUserUpdate,
  PermissionAPIResponse,
  PermissionsAPIResponse,
  PollData,
  PollOptionData,
  PollVoteData,
  PollVotesAPIResponse,
  PushProvider,
  PushProviderConfig,
  PushProviderID,
  PushProviderListResponse,
  PushProviderUpsertResponse,
  QueryChannelsAPIResponse,
  QuerySegmentsOptions,
  QueryPollsResponse,
  ReactionResponse,
  ReactivateUserOptions,
  ReactivateUsersOptions,
  ReservedMessageFields,
  ReviewFlagReportOptions,
  ReviewFlagReportResponse,
  SearchAPIResponse,
  SearchMessageSortBase,
  SearchOptions,
  SearchPayload,
  SegmentResponse,
  SegmentData,
  SegmentType,
  SendFileAPIResponse,
  ErmisChatOptions,
  SyncOptions,
  SyncResponse,
  TaskResponse,
  TaskStatus,
  TestPushDataInput,
  TestSNSDataInput,
  TestSQSDataInput,
  TokenOrProvider,
  UnBanUserOptions,
  UpdateChannelOptions,
  UpdateChannelResponse,
  UpdateCommandOptions,
  UpdateCommandResponse,
  UpdatedMessage,
  UpdateMessageAPIResponse,
  UpdateMessageOptions,
  UpdateSegmentData,
  UserCustomEvent,
  UserResponse,
  GetThreadAPIResponse,
  PartialThreadUpdate,
  QueryThreadsOptions,
  GetThreadOptions,
  CampaignSort,
  SegmentTargetsResponse,
  QuerySegmentTargetsFilter,
  SortParam,
  GetMessageOptions,
  QueryVotesFilters,
  VoteSort,
  CreatePollAPIResponse,
  GetPollAPIResponse,
  UpdatePollAPIResponse,
  CreatePollOptionAPIResponse,
  GetPollOptionAPIResponse,
  UpdatePollOptionAPIResponse,
  PollVote,
  CastVoteAPIResponse,
  QueryPollsFilters,
  PollSort,
  QueryPollsOptions,
  QueryVotesOptions,
  ReactionFilters,
  ReactionSort,
  QueryReactionsAPIResponse,
  QueryReactionsOptions,
  ContactResponse,
  UsersResponse,
  ChainsResponse,
  ContactResult,
  GetTokenResponse,
  Contact,
} from './types';
import { Thread } from './thread';

function isString(x: unknown): x is string {
  return typeof x === 'string' || x instanceof String;
}
const ERMIS_PROJECT_ID = '6fbdecb0-1ec8-4e32-99d7-ff2683e308b7';
export class ErmisChat<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  private static _instance?: unknown | ErmisChat; // type is undefined|ErmisChat, unknown is due to TS limitations with statics

  _user?: OwnUserResponse<ErmisChatGenerics> | UserResponse<ErmisChatGenerics>;
  activeChannels: {
    [key: string]: Channel<ErmisChatGenerics>;
  };
  axiosInstance: AxiosInstance;
  baseURL?: string;
  browser: boolean;
  clientID?: string;
  configs: Configs<ErmisChatGenerics>;
  key: string;
  projectId: string;
  listeners: Record<string, Array<(event: Event<ErmisChatGenerics>) => void>>;
  logger: Logger;
  /**
   * When network is recovered, we re-query the active channels on client. But in single query, you can recover
   * only 30 channels. So its not guaranteed that all the channels in activeChannels object have updated state.
   * Thus in UI sdks, state recovery is managed by components themselves, they don't rely on js client for this.
   *
   * `recoverStateOnReconnect` parameter can be used in such cases, to disable state recovery within js client.
   * When false, user/consumer of this client will need to make sure all the channels present on UI by
   * manually calling queryChannels endpoint.
   */
  recoverStateOnReconnect?: boolean;
  mutedChannels: ChannelMute<ErmisChatGenerics>[];
  node: boolean;
  options: ErmisChatOptions;
  secret?: string;
  setUserPromise: ConnectAPIResponse<ErmisChatGenerics> | null;
  state: ClientState<ErmisChatGenerics>;
  tokenManager: TokenManager<ErmisChatGenerics>;
  user?: OwnUserResponse<ErmisChatGenerics> | UserResponse<ErmisChatGenerics>;
  userAgent?: string;
  userID?: string;
  wsBaseURL?: string;
  wsConnection: StableWSConnection<ErmisChatGenerics> | null;
  wsFallback?: WSConnectionFallback<ErmisChatGenerics>;
  wsPromise: ConnectAPIResponse<ErmisChatGenerics> | null;
  consecutiveFailures: number;
  defaultWSTimeoutWithFallback: number;
  defaultWSTimeout: number;

  private eventSource: EventSourcePolyfill | null = null;

  // Chain
  chains?: ChainsResponse<ErmisChatGenerics>;
  private nextRequestAbortController: AbortController | null = null;

  /**
   * Initialize a client
   *
   * **Only use constructor for advanced usages. It is strongly advised to use `ErmisChat.getInstance()` instead of `new ErmisChat()` to reduce integration issues due to multiple WebSocket connections**
   * @param {string} key - the api key
   * @param {string} [secret] - the api secret
   * @param {ErmisChatOptions} [options] - additional options, here you can pass custom options to axios instance
   * @param {boolean} [options.browser] - enforce the client to be in browser mode
   * @param {boolean} [options.warmUp] - default to false, if true, client will open a connection as soon as possible to speed up following requests
   * @param {Logger} [options.Logger] - custom logger
   * @param {number} [options.timeout] - default to 3000
   * @param {httpsAgent} [options.httpsAgent] - custom httpsAgent, in node it's default to https.agent()
   * @example <caption>initialize the client in user mode</caption>
   * new ErmisChat('api_key')
   * @example <caption>initialize the client in user mode with options</caption>
   * new ErmisChat('api_key', { warmUp:true, timeout:5000 })
   * @example <caption>secret is optional and only used in server side mode</caption>
   * new ErmisChat('api_key', "secret", { httpsAgent: customAgent })
   */
  constructor(key: string, projectId: string, options?: ErmisChatOptions);
  constructor(key: string, projectId: string, secret?: string, options?: ErmisChatOptions);
  constructor(key: string, projectId: string, secretOrOptions?: ErmisChatOptions | string, options?: ErmisChatOptions) {
    // set the key
    this.key = key;
    this.projectId = projectId;
    this.listeners = {};
    this.state = new ClientState<ErmisChatGenerics>();
    // a list of channels to hide ws events from
    this.mutedChannels = [];

    // set the secret
    if (secretOrOptions && isString(secretOrOptions)) {
      this.secret = secretOrOptions;
    }

    // set the options... and figure out defaults...
    const inputOptions = options ? options : secretOrOptions && !isString(secretOrOptions) ? secretOrOptions : {};

    this.browser = typeof inputOptions.browser !== 'undefined' ? inputOptions.browser : typeof window !== 'undefined';
    this.node = !this.browser;

    this.options = {
      timeout: 3000,
      withCredentials: false, // making sure cookies are not sent
      warmUp: false,
      recoverStateOnReconnect: true,
      ...inputOptions,
    };

    if (this.node && !this.options.httpsAgent) {
      this.options.httpsAgent = new https.Agent({
        keepAlive: true,
        keepAliveMsecs: 3000,
      });
    }

    this.axiosInstance = axios.create(this.options);

    this.setBaseURL(this.options.baseURL || 'https://api.ermis.network');

    if (typeof process !== 'undefined' && process.env.STREAM_LOCAL_TEST_RUN) {
      this.setBaseURL('http://localhost:3030');
    }

    if (typeof process !== 'undefined' && process.env.STREAM_LOCAL_TEST_HOST) {
      this.setBaseURL('http://' + process.env.STREAM_LOCAL_TEST_HOST);
    }

    // WS connection is initialized when setUser is called
    this.wsConnection = null;
    this.wsPromise = null;
    this.setUserPromise = null;
    // keeps a reference to all the channels that are in use
    this.activeChannels = {};

    // mapping between channel groups and configs
    this.configs = {};

    // If its a server-side client, then lets initialize the tokenManager, since token will be
    // generated from secret.
    this.tokenManager = new TokenManager(this.secret);
    this.consecutiveFailures = 0;

    this.defaultWSTimeoutWithFallback = 6000;
    this.defaultWSTimeout = 15000;

    this.axiosInstance.defaults.paramsSerializer = axiosParamsSerializer;

    /**
     * logger function should accept 3 parameters:
     * @param logLevel string
     * @param message   string
     * @param extraData object
     *
     * e.g.,
     * const client = new ErmisChat('api_key', {}, {
     * 		logger = (logLevel, message, extraData) => {
     * 			console.log(message);
     * 		}
     * })
     *
     * extraData contains tags array attached to log message. Tags can have one/many of following values:
     * 1. api
     * 2. api_request
     * 3. api_response
     * 4. client
     * 5. channel
     * 6. connection
     * 7. event
     *
     * It may also contains some extra data, some examples have been mentioned below:
     * 1. {
     * 		tags: ['api', 'api_request', 'client'],
     * 		url: string,
     * 		payload: object,
     * 		config: object
     * }
     * 2. {
     * 		tags: ['api', 'api_response', 'client'],
     * 		url: string,
     * 		response: object
     * }
     * 3. {
     * 		tags: ['api', 'api_response', 'client'],
     * 		url: string,
     * 		error: object
     * }
     * 4. {
     * 		tags: ['event', 'client'],
     * 		event: object
     * }
     * 5. {
     * 		tags: ['channel'],
     * 		channel: object
     * }
     */
    this.logger = isFunction(inputOptions.logger) ? inputOptions.logger : () => null;
    this.recoverStateOnReconnect = this.options.recoverStateOnReconnect;

    this.chains = {
      chains: [],
      joined: [],
      not_joined: [],
    };
  }

  /**
   * Get a client instance
   *
   * This function always returns the same Client instance to avoid issues raised by multiple Client and WS connections
   *
   * **After the first call, the client configuration will not change if the key or options parameters change**
   *
   * @param {string} key - the api key
   * @param {string} [secret] - the api secret
   * @param {ErmisChatOptions} [options] - additional options, here you can pass custom options to axios instance
   * @param {boolean} [options.browser] - enforce the client to be in browser mode
   * @param {boolean} [options.warmUp] - default to false, if true, client will open a connection as soon as possible to speed up following requests
   * @param {Logger} [options.Logger] - custom logger
   * @param {number} [options.timeout] - default to 3000
   * @param {httpsAgent} [options.httpsAgent] - custom httpsAgent, in node it's default to https.agent()
   * @example <caption>initialize the client in user mode</caption>
   * ErmisChat.getInstance('api_key')
   * @example <caption>initialize the client in user mode with options</caption>
   * ErmisChat.getInstance('api_key', { timeout:5000 })
   * @example <caption>secret is optional and only used in server side mode</caption>
   * ErmisChat.getInstance('api_key', "secret", { httpsAgent: customAgent })
   */
  public static getInstance<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics>(
    key: string,
    projectId: string,
    options?: ErmisChatOptions,
  ): ErmisChat<ErmisChatGenerics>;
  public static getInstance<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics>(
    key: string,
    projectId: string,
    secret?: string,
    options?: ErmisChatOptions,
  ): ErmisChat<ErmisChatGenerics>;
  public static getInstance<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics>(
    key: string,
    projectId: string,
    secretOrOptions?: ErmisChatOptions | string,
    options?: ErmisChatOptions,
  ): ErmisChat<ErmisChatGenerics> {
    if (!ErmisChat._instance) {
      if (typeof secretOrOptions === 'string') {
        ErmisChat._instance = new ErmisChat<ErmisChatGenerics>(key, projectId, secretOrOptions, options);
      } else {
        ErmisChat._instance = new ErmisChat<ErmisChatGenerics>(key, projectId, secretOrOptions);
      }
    }

    return ErmisChat._instance as ErmisChat<ErmisChatGenerics>;
  }

  devToken(userID: string) {
    return DevToken(userID);
  }
  async refreshNewToken(refresh_token: string) {
    return await this.post<APIResponse>(this.baseURL + '/uss/v1/refresh_token', { refresh_token });
  }
  getAuthType() {
    return 'jwt';
  }

  setBaseURL(baseURL: string) {
    this.baseURL = baseURL;
    this.wsBaseURL = this.baseURL.replace('http', 'ws').replace(':3030', ':8800');
  }

  _getConnectionID = () => this.wsConnection?.connectionID || this.wsFallback?.connectionID;

  _hasConnectionID = () => Boolean(this._getConnectionID());

  /**
   * connectUser - Set the current user and open a WebSocket connection
   *
   * @param {OwnUserResponse<ErmisChatGenerics> | UserResponse<ErmisChatGenerics>} user Data about this user. IE {name: "john"}
   * @param {TokenOrProvider} userTokenOrProvider Token or provider
   *
   * @return {ConnectAPIResponse<ErmisChatGenerics>} Returns a promise that resolves when the connection is setup
   */

  async getExternalAuthToken(data: any) {
    const params: any = { apikey: data.apiKey, name: data.user.name };
    if (data.user.image) {
      params.avatar = data.user.image;
    }
    const url = this.baseURL + '/uss/v1/get_token/external_auth';
    const query = new URLSearchParams(params).toString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (data.token) {
      const tokenStr = data.token.startsWith('Bearer ') ? data.token : `Bearer ${data.token}`;
      headers['Authorization'] = tokenStr;
    }
    const response = await fetch(`${url}?${query}`, {
      method: 'GET',
      headers,
    });
    if (!response.ok) {
      throw new Error('Failed to fetch external auth token');
    }
    return await response.json();
  }

  connectUser = async (
    user: OwnUserResponse<ErmisChatGenerics> | UserResponse<ErmisChatGenerics>,
    userTokenOrProvider: TokenOrProvider,
    extenal_auth?: boolean, // pass true if you are using external auth
  ) => {
    this.logger('info', 'client:connectUser() - started', {
      tags: ['connection', 'client'],
    });
    if (!user.id) {
      throw new Error('The "id" field on the user is missing');
    }

    // If external auth is enabled, get the token from the server
    if (extenal_auth) {
      // this.tokenManager.setTokenOrProvider(userTokenOrProvider, user);
      try {
        const data = {
          apiKey: this.key,
          user,
          token: userTokenOrProvider,
        };
        const external_auth_token = await this.getExternalAuthToken(data);

        userTokenOrProvider = external_auth_token.token;
      } catch (error) {
        throw new Error('Failed to get external auth token');
      }
    }

    /**
     * Calling connectUser multiple times is potentially the result of a  bad integration, however,
     * If the user id remains the same we don't throw error
     */
    if (this.userID === user.id && this.setUserPromise) {
      console.warn(
        'Consecutive calls to connectUser is detected, ideally you should only call this function once in your app.',
      );
      return this.setUserPromise;
    }

    if (this.userID) {
      throw new Error(
        'Use client.disconnect() before trying to connect as a different user. connectUser was called twice.',
      );
    }

    if (this.node && !this.options.allowServerSideConnect) {
      console.warn(
        'Please do not use connectUser server side. connectUser impacts MAU and concurrent connection usage and thus your bill. If you have a valid use-case, add "allowServerSideConnect: true" to the client options to disable this warning.',
      );
    }

    // we generate the client id client side
    this.userID = user.id;

    const setTokenPromise = this._setToken(user, userTokenOrProvider);
    this._setUser(user);

    const wsPromise = this.openConnection();

    this.setUserPromise = Promise.all([setTokenPromise, wsPromise]).then(
      (result) => result[1], // We only return connection promise;
    );

    try {
      const result = await this.setUserPromise;
      // Call SSE after successful connect
      await this.connectToSSE();
      return result;
    } catch (err) {
      this.disconnectUser();
      throw err;
    }
  };

  /**
   * @deprecated Please use connectUser() function instead. Its naming is more consistent with its functionality.
   *
   * setUser - Set the current user and open a WebSocket connection
   *
   * @param {OwnUserResponse<ErmisChatGenerics> | UserResponse<ErmisChatGenerics>} user Data about this user. IE {name: "john"}
   * @param {TokenOrProvider} userTokenOrProvider Token or provider
   *
   * @return {ConnectAPIResponse<ErmisChatGenerics>} Returns a promise that resolves when the connection is setup
   */
  setUser = this.connectUser;

  _setToken = (user: UserResponse<ErmisChatGenerics>, userTokenOrProvider: TokenOrProvider) =>
    this.tokenManager.setTokenOrProvider(userTokenOrProvider, user);

  _setUser(user: OwnUserResponse<ErmisChatGenerics> | UserResponse<ErmisChatGenerics>) {
    /**
     * This one is used by the frontend. This is a copy of the current user object stored on backend.
     * It contains reserved properties and own user properties which are not present in `this._user`.
     */
    this.user = user;
    this.userID = user.id;
    // this one is actually used for requests. This is a copy of current user provided to `connectUser` function.
    this._user = { ...user };
  }

  /**
   * Disconnects the websocket connection, without removing the user set on client.
   * client.closeConnection will not trigger default auto-retry mechanism for reconnection. You need
   * to call client.openConnection to reconnect to websocket.
   *
   * This is mainly useful on mobile side. You can only receive push notifications
   * if you don't have active websocket connection.
   * So when your app goes to background, you can call `client.closeConnection`.
   * And when app comes back to foreground, call `client.openConnection`.
   *
   * @param timeout Max number of ms, to wait for close event of websocket, before forcefully assuming succesful disconnection.
   *                https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
   */
  closeConnection = async (timeout?: number) => {
    await Promise.all([this.wsConnection?.disconnect(timeout), this.wsFallback?.disconnect(timeout)]);
    return Promise.resolve();
  };

  /**
   * Creates a new WebSocket connection with the current user. Returns empty promise, if there is an active connection
   */
  openConnection = async () => {
    if (!this.userID) {
      throw Error('User is not set on client, use client.connectUser or client.connectAnonymousUser instead');
    }

    if (this.wsConnection?.isConnecting && this.wsPromise) {
      this.logger('info', 'client:openConnection() - connection already in progress', {
        tags: ['connection', 'client'],
      });
      return this.wsPromise;
    }

    if ((this.wsConnection?.isHealthy || this.wsFallback?.isHealthy()) && this._hasConnectionID()) {
      this.logger('info', 'client:openConnection() - openConnection called twice, healthy connection already exists', {
        tags: ['connection', 'client'],
      });

      return Promise.resolve();
    }

    this.clientID = `${this.userID}--${randomId()}`;
    this.wsPromise = this.connect();
    return this.wsPromise;
  };

  /**
   * @deprecated Please use client.openConnction instead.
   * @private
   *
   * Creates a new websocket connection with current user.
   */
  _setupConnection = this.openConnection;

  _normalizeDate = (before: Date | string | null): string | null => {
    if (before instanceof Date) {
      before = before.toISOString();
    }

    if (before === '') {
      throw new Error("Don't pass blank string for since, use null instead if resetting the token revoke");
    }

    return before;
  };

  /**
   * Disconnects the websocket and removes the user from client.
   *
   * @param timeout Max number of ms, to wait for close event of websocket, before forcefully assuming successful disconnection.
   *                https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
   */
  disconnectUser = async (timeout?: number) => {
    this.logger('info', 'client:disconnect() - Disconnecting the client', {
      tags: ['connection', 'client'],
    });

    // remove the user specific fields
    delete this.user;
    delete this._user;
    delete this.userID;
    const closePromise = this.closeConnection(timeout);

    for (const channel of Object.values(this.activeChannels)) {
      channel._disconnect();
    }
    // ensure we no longer return inactive channels
    this.activeChannels = {};
    // reset client state
    this.state = new ClientState();
    // reset token manager
    setTimeout(this.tokenManager.reset); // delay reseting to use token for disconnect calls

    // close the WS connection
    return closePromise;
  };

  /**
   *
   * @deprecated Please use client.disconnectUser instead.
   *
   * Disconnects the websocket and removes the user from client.
   */
  disconnect = this.disconnectUser;

  /**
   * on - Listen to events on all channels and users your watching
   *
   * client.on('message.new', event => {console.log("my new message", event, channel.state.messages)})
   * or
   * client.on(event => {console.log(event.type)})
   *
   * @param {EventHandler<ErmisChatGenerics> | string} callbackOrString  The event type to listen for (optional)
   * @param {EventHandler<ErmisChatGenerics>} [callbackOrNothing] The callback to call
   *
   * @return {{ unsubscribe: () => void }} Description
   */
  on(callback: EventHandler<ErmisChatGenerics>): { unsubscribe: () => void };
  on(eventType: string, callback: EventHandler<ErmisChatGenerics>): { unsubscribe: () => void };
  on(
    callbackOrString: EventHandler<ErmisChatGenerics> | string,
    callbackOrNothing?: EventHandler<ErmisChatGenerics>,
  ): { unsubscribe: () => void } {
    const key = callbackOrNothing ? (callbackOrString as string) : 'all';
    const callback = callbackOrNothing ? callbackOrNothing : (callbackOrString as EventHandler<ErmisChatGenerics>);
    if (!(key in this.listeners)) {
      this.listeners[key] = [];
    }
    this.logger('info', `Attaching listener for ${key} event`, {
      tags: ['event', 'client'],
    });
    this.listeners[key].push(callback);
    return {
      unsubscribe: () => {
        this.logger('info', `Removing listener for ${key} event`, {
          tags: ['event', 'client'],
        });
        this.listeners[key] = this.listeners[key].filter((el) => el !== callback);
      },
    };
  }

  /**
   * off - Remove the event handler
   *
   */
  off(callback: EventHandler<ErmisChatGenerics>): void;
  off(eventType: string, callback: EventHandler<ErmisChatGenerics>): void;
  off(callbackOrString: EventHandler<ErmisChatGenerics> | string, callbackOrNothing?: EventHandler<ErmisChatGenerics>) {
    const key = callbackOrNothing ? (callbackOrString as string) : 'all';
    const callback = callbackOrNothing ? callbackOrNothing : (callbackOrString as EventHandler<ErmisChatGenerics>);
    if (!(key in this.listeners)) {
      this.listeners[key] = [];
    }

    this.logger('info', `Removing listener for ${key} event`, {
      tags: ['event', 'client'],
    });
    this.listeners[key] = this.listeners[key].filter((value) => value !== callback);
  }

  _logApiRequest(
    type: string,
    url: string,
    data: unknown,
    config: AxiosRequestConfig & {
      config?: AxiosRequestConfig & { maxBodyLength?: number };
    },
  ) {
    this.logger(
      'info',
      `client: ${type} - Request - ${url}- ${JSON.stringify(data)} - ${JSON.stringify(config.params)}`,
      {
        tags: ['api', 'api_request', 'client'],
        url,
        payload: data,
        config,
      },
    );
  }

  _logApiResponse<T>(type: string, url: string, response: AxiosResponse<T>) {
    this.logger('info', `client:${type} - Response - url: ${url} > status ${response.status}`, {
      tags: ['api', 'api_response', 'client'],
      url,
      response,
    });
  }

  _logApiError(type: string, url: string, error: unknown, options: unknown) {
    this.logger(
      'error',
      `client:${type} - Error: ${JSON.stringify(error)} - url: ${url} - options: ${JSON.stringify(options)}`,
      {
        tags: ['api', 'api_response', 'client'],
        url,
        error,
      },
    );
  }

  doAxiosRequest = async <T>(
    type: string,
    url: string,
    data?: unknown,
    options: AxiosRequestConfig & {
      config?: AxiosRequestConfig & { maxBodyLength?: number };
    } = {},
  ): Promise<T> => {
    await this.tokenManager.tokenReady();

    const requestConfig = this._enrichAxiosOptions(options);

    try {
      let response: AxiosResponse<T>;
      this._logApiRequest(type, url, data, requestConfig);
      switch (type) {
        case 'get':
          response = await this.axiosInstance.get(url, requestConfig);
          break;
        case 'delete':
          response = await this.axiosInstance.delete(url, requestConfig);
          break;
        case 'post':
          response = await this.axiosInstance.post(url, data, requestConfig);
          break;
        case 'postForm':
          response = await this.axiosInstance.postForm(url, data, requestConfig);
          break;
        case 'put':
          response = await this.axiosInstance.put(url, data, requestConfig);
          break;
        case 'patch':
          response = await this.axiosInstance.patch(url, data, requestConfig);
          break;
        case 'options':
          response = await this.axiosInstance.options(url, requestConfig);
          break;
        default:
          throw new Error('Invalid request type');
      }
      this._logApiResponse<T>(type, url, response);
      this.consecutiveFailures = 0;
      return this.handleResponse(response);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any /**TODO: generalize error types  */) {
      e.client_request_id = requestConfig.headers?.['x-client-request-id'];
      this._logApiError(type, url, e, options);
      this.consecutiveFailures += 1;
      if (e.response) {
        /** connection_fallback depends on this token expiration logic */
        if (e.response.data.code === chatCodes.TOKEN_EXPIRED && !this.tokenManager.isStatic()) {
          if (this.consecutiveFailures > 1) {
            await sleep(retryInterval(this.consecutiveFailures));
          }
          this.tokenManager.loadToken();
          return await this.doAxiosRequest<T>(type, url, data, requestConfig);
        }
        return this.handleResponse(e.response);
      } else {
        throw e as AxiosError<APIErrorResponse>;
      }
    }
  };

  get<T>(url: string, params?: AxiosRequestConfig['params']) {
    return this.doAxiosRequest<T>('get', url, null, { params });
  }

  put<T>(url: string, data?: unknown) {
    return this.doAxiosRequest<T>('put', url, data);
  }

  post<T>(url: string, data?: unknown, params?: AxiosRequestConfig['params']) {
    return this.doAxiosRequest<T>('post', url, data, { params });
  }

  patch<T>(url: string, data?: unknown) {
    return this.doAxiosRequest<T>('patch', url, data);
  }

  delete<T>(url: string, params?: AxiosRequestConfig['params']) {
    return this.doAxiosRequest<T>('delete', url, null, { params });
  }

  sendFile(
    url: string,
    uri: string | NodeJS.ReadableStream | Buffer | File,
    name?: string,
    contentType?: string,
    user?: UserResponse<ErmisChatGenerics>,
  ) {
    const data = addFileToFormData(uri, name, contentType || 'multipart/form-data');
    if (user != null) data.append('user', JSON.stringify(user));

    return this.doAxiosRequest<SendFileAPIResponse>('postForm', url, data, {
      headers: data.getHeaders ? data.getHeaders() : {}, // node vs browser
      config: {
        timeout: 0,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      },
    });
  }

  errorFromResponse(response: AxiosResponse<APIErrorResponse>): ErrorFromResponse<APIErrorResponse> {
    let err: ErrorFromResponse<APIErrorResponse>;
    err = new ErrorFromResponse(`ErmisChat error HTTP code: ${response.status}`);
    if (response.data && response.data.code) {
      err = new Error(`ErmisChat error code ${response.data.code}: ${response.data.message}`);
      err.code = response.data.code;
    }
    err.response = response;
    err.status = response.status;
    return err;
  }

  handleResponse<T>(response: AxiosResponse<T>) {
    const data = response.data;
    if (isErrorResponse(response)) {
      throw this.errorFromResponse(response);
    }
    return data;
  }

  dispatchEvent = (event: Event<ErmisChatGenerics>) => {
    if (!event.received_at) event.received_at = new Date();

    // If the event is channel.created, handle it asynchronously
    if (event.type === 'channel.created') {
      this._handleChannelCreatedEvent(event).then(() => {
        this._afterDispatchEvent(event);
      });
    } else {
      const postListenerCallbacks = this._handleClientEvent(event);

      // channel event handlers
      const cid = event.cid;
      const channel = cid ? this.activeChannels[cid] : undefined;
      if (channel) {
        channel._handleChannelEvent(event);
      }

      this._callClientListeners(event);

      if (channel) {
        channel._callChannelListeners(event);
      }

      postListenerCallbacks.forEach((c) => c());
    }
  };

  _afterDispatchEvent(event: Event<ErmisChatGenerics>) {
    const postListenerCallbacks = this._handleClientEvent(event);

    const cid = event.cid;
    const channel = cid ? this.activeChannels[cid] : undefined;
    if (channel) {
      channel._handleChannelEvent(event);
    }

    this._callClientListeners(event);

    if (channel) {
      channel._callChannelListeners(event);
    }

    postListenerCallbacks.forEach((c) => c());
  }

  private async _handleChannelCreatedEvent(event: Event<ErmisChatGenerics>) {
    const members = event.channel?.members || [];
    // Ensure all members' user info are loaded in state.users
    await ensureMembersUserInfoLoaded(this, members);

    // Get the latest users after updating
    const updatedUsers = Object.values(this.state.users);

    const enrichedMembers = enrichWithUserInfo(members, updatedUsers);
    const channelName =
      event.channel_type === 'messaging'
        ? getDirectChannelName(enrichedMembers, this.userID || '')
        : event.channel?.name;
    const channel = {
      ...event.channel,
      members: enrichedMembers,
      name: channelName,
    };
    const channelState: any = {
      channel,
      members: enrichedMembers,
      messages: [],
      pinned_messages: [],
    };
    const c = this.channel(event.channel_type || '', event.channel_id);
    c.data = channel;
    c._initializeState(channelState, 'latest');
  }

  handleEvent = (messageEvent: WebSocket.MessageEvent) => {
    // dispatch the event to the channel listeners
    const jsonString = messageEvent.data as string;
    const event = JSON.parse(jsonString) as Event<ErmisChatGenerics>;
    this.dispatchEvent(event);
  };

  /**
   * Updates the members, watchers and read references of the currently active channels that contain this user
   *
   * @param {UserResponse<ErmisChatGenerics>} user
   */
  _updateMemberWatcherReferences = (user: UserResponse<ErmisChatGenerics>) => {
    const refMap = this.state.userChannelReferences[user.id] || {};
    for (const channelID in refMap) {
      const channel = this.activeChannels[channelID];
      if (channel?.state) {
        if (channel.state.members[user.id]) {
          channel.state.members[user.id].user = user;
        }
        if (channel.state.watchers[user.id]) {
          channel.state.watchers[user.id] = user;
        }
        if (channel.state.read[user.id]) {
          channel.state.read[user.id].user = user;
        }
      }
    }
  };

  /**
   * @deprecated Please _updateMemberWatcherReferences instead.
   * @private
   */
  _updateUserReferences = this._updateMemberWatcherReferences;

  /**
   * @private
   *
   * Updates the messages from the currently active channels that contain this user,
   * with updated user object.
   *
   * @param {UserResponse<ErmisChatGenerics>} user
   */
  _updateUserMessageReferences = (user: UserResponse<ErmisChatGenerics>) => {
    const refMap = this.state.userChannelReferences[user.id] || {};

    for (const channelID in refMap) {
      const channel = this.activeChannels[channelID];

      if (!channel) continue;

      const state = channel.state;

      /** update the messages from this user. */
      state?.updateUserMessages(user);
    }
  };

  /**
   * @private
   *
   * Deletes the messages from the currently active channels that contain this user
   *
   * If hardDelete is true, all the content of message will be stripped down.
   * Otherwise, only 'message.type' will be set as 'deleted'.
   *
   * @param {UserResponse<ErmisChatGenerics>} user
   * @param {boolean} hardDelete
   */
  _deleteUserMessageReference = (user: UserResponse<ErmisChatGenerics>, hardDelete = false) => {
    const refMap = this.state.userChannelReferences[user.id] || {};

    for (const channelID in refMap) {
      const channel = this.activeChannels[channelID];
      const state = channel.state;

      /** deleted the messages from this user. */
      state?.deleteUserMessages(user, hardDelete);
    }
  };

  _handleClientEvent(event: Event<ErmisChatGenerics>) {
    const client = this;
    const postListenerCallbacks = [];
    this.logger('info', `client:_handleClientEvent - Received event of type { ${event.type} }`, {
      tags: ['event', 'client'],
      event,
    });

    // if (event.type === 'user.presence.changed' || event.type === 'user.updated' || event.type === 'user.deleted') {
    //   this._handleUserEvent(event);
    // }

    if (event.type === 'health.check' && event.me) {
      client.user = event.me;
      client.state.updateUser(event.me);
      // client.mutedChannels = event.me.channel_mutes;
    }

    if (event.channel && event.type === 'notification.message_new') {
      this._addChannelConfig(event.channel);
    }

    if ((event.type === 'channel.deleted' || event.type === 'notification.channel_deleted') && event.cid) {
      client.state.deleteAllChannelReference(event.cid);
      this.activeChannels[event.cid]?._disconnect();

      postListenerCallbacks.push(() => {
        if (!event.cid) return;

        delete this.activeChannels[event.cid];
      });
    }
    if (event.type === 'notification.invite_rejected') {
      if (event.member?.user_id === this.userID && event.cid) {
        client.state.deleteAllChannelReference(event.cid);
        this.activeChannels[event.cid]?._disconnect();

        postListenerCallbacks.push(() => {
          if (!event.cid) return;

          delete this.activeChannels[event.cid];
        });
      }
    }
    if (event.type === 'notification.invite_accepted') {
      //TODO handle channel list and invited channels here
    }

    if (event.type === 'member.added') {
      if (event.member?.user_id === this.userID) {
        const c = this.channel(event.channel_type || '', event.channel_id);
        // Gọi watch để lấy đầy đủ thông tin channel từ server
        c.watch().catch((err) => {
          this.logger('error', 'Failed to watch channel after member.added', { err, event });
        });
      }
    }

    return postListenerCallbacks;
  }

  _muteStatus(cid: string) {
    let muteStatus;
    for (let i = 0; i < this.mutedChannels.length; i++) {
      const mute = this.mutedChannels[i];
      if (mute.channel?.cid === cid) {
        muteStatus = {
          muted: mute.expires ? new Date(mute.expires).getTime() > new Date().getTime() : true,
          createdAt: mute.created_at ? new Date(mute.created_at) : new Date(),
          expiresAt: mute.expires ? new Date(mute.expires) : null,
        };
        break;
      }
    }

    if (muteStatus) {
      return muteStatus;
    }

    return {
      muted: false,
      createdAt: null,
      expiresAt: null,
    };
  }

  _callClientListeners = (event: Event<ErmisChatGenerics>) => {
    const client = this;
    // gather and call the listeners
    const listeners: Array<(event: Event<ErmisChatGenerics>) => void> = [];
    if (client.listeners.all) {
      listeners.push(...client.listeners.all);
    }
    if (client.listeners[event.type]) {
      listeners.push(...client.listeners[event.type]);
    }

    // call the event and send it to the listeners
    for (const listener of listeners) {
      listener(event);
    }
  };

  recoverState = async () => {
    this.logger('info', `client:recoverState() - Start of recoverState with connectionID ${this._getConnectionID()}`, {
      tags: ['connection'],
    });

    const cids = Object.keys(this.activeChannels);
    if (cids.length && this.recoverStateOnReconnect) {
      this.logger('info', `client:recoverState() - Start the querying of ${cids.length} channels`, {
        tags: ['connection', 'client'],
      });

      await this.queryChannels(
        { cid: { $in: cids } } as ChannelFilters<ErmisChatGenerics>,
        { last_message_at: -1 },
        { limit: 30 },
      );

      this.logger('info', 'client:recoverState() - Querying channels finished', { tags: ['connection', 'client'] });
      this.dispatchEvent({
        type: 'connection.recovered',
      } as Event<ErmisChatGenerics>);
    } else {
      this.dispatchEvent({
        type: 'connection.recovered',
      } as Event<ErmisChatGenerics>);
    }

    this.wsPromise = Promise.resolve();
    this.setUserPromise = Promise.resolve();
  };

  /**
   * @private
   */
  async connect() {
    if (!this.userID || !this._user) {
      throw Error('Call connectUser or connectAnonymousUser before starting the connection');
    }
    if (!this.wsBaseURL) {
      throw Error('Websocket base url not set');
    }
    if (!this.clientID) {
      throw Error('clientID is not set');
    }
    // The StableWSConnection handles all the reconnection logic.
    if (this.options.wsConnection && this.node) {
      // Intentionally avoiding adding ts generics on wsConnection in options since its only useful for unit test purpose.
      (this.options.wsConnection as unknown as StableWSConnection<ErmisChatGenerics>).setClient(this);
      this.wsConnection = this.options.wsConnection as unknown as StableWSConnection<ErmisChatGenerics>;
    } else {
      this.wsConnection = new StableWSConnection<ErmisChatGenerics>({
        client: this,
      });
    }

    try {
      // if fallback is used before, continue using it instead of waiting for WS to fail
      if (this.wsFallback) {
        return await this.wsFallback.connect();
      }

      // if WSFallback is enabled, ws connect should timeout faster so fallback can try
      return await this.wsConnection.connect(
        this.options.enableWSFallback ? this.defaultWSTimeoutWithFallback : this.defaultWSTimeout,
      );
    } catch (err: any) {
      // run fallback only if it's WS/Network error and not a normal API error
      // make sure browser is online before even trying the longpoll
      if (this.options.enableWSFallback && isWSFailure(err) && isOnline()) {
        this.logger('info', 'client:connect() - WS failed, fallback to longpoll', { tags: ['connection', 'client'] });
        this.dispatchEvent({ type: 'transport.changed', mode: 'longpoll' });

        this.wsConnection._destroyCurrentWSConnection();
        this.wsConnection.disconnect().then(); // close WS so no retry
        this.wsFallback = new WSConnectionFallback<ErmisChatGenerics>({
          client: this,
        });
        return await this.wsFallback.connect();
      }

      throw err;
    }
  }

  public async connectToSSE(onCallBack?: (data: any) => void): Promise<void> {
    if (this.eventSource) {
      this.logger('info', 'client:connectToSSE() - SSE connection already established', {});
      return;
    }
    let token = this._getToken();

    if (!token?.startsWith('Bearer ')) {
      token = `Bearer ${token}`;
    }
    const headers = {
      method: 'GET',
      Authorization: token,
    };
    this.eventSource = new EventSourcePolyfill(this.baseURL + '/uss/v1/sse/subscribe', {
      headers,
      heartbeatTimeout: 60000,
    });
    this.eventSource.onopen = () => {
      this.logger('info', 'client:connectToSSE() - SSE connection established', {});
    };
    this.eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      this.logger('info', `client:connectToSSE() - SSE message received event :  ${JSON.stringify(data)}`, { event });

      if (data.type === 'AccountUserChainProjects') {
        let user: UserResponse = {
          name: data.name,
          id: data.id,
          avatar: data.avatar,
          about_me: data.about_me,
          project_id: data.project_id,
        };

        if (this.user?.id === user.id) {
          this.user = { ...this.user, ...user };
        }
        if (this._user?.id === user.id) {
          this._user = { ...this._user, ...user };
        }

        this.state.updateUser(user);

        const userInfo = {
          id: user.id,
          name: user.name ? user.name : user.id,
          avatar: user?.avatar || '',
        };

        this._updateMemberWatcherReferences(userInfo);
        this._updateUserMessageReferences(userInfo);

        Object.values(this.activeChannels).forEach((channel) => {
          if (channel.data?.type === 'messaging' && Object.keys(channel.state.members).length === 2) {
            const otherMember = Object.values(channel.state.members).find((member) => member.user?.id !== this.userID);
            if (otherMember && otherMember.user?.id === user.id) {
              // Cập nhật tên và avatar channel theo user vừa đổi thông tin
              channel.data.name = user.name || user.id;
              channel.data.image = user.avatar || '';
            }
          }
        });

        if (onCallBack) {
          onCallBack(data);
        }
      }
    };
    this.eventSource.onerror = (event: any) => {
      this.logger('error', `client:connectToSSE() - SSE connection error : ${JSON.stringify(event.data)} `, { event });
      if (event.status === 401) {
        this.logger('error', 'client:connectToSSE() - Unauthorized (401). Aborting the connection.', {});
        this.disconnectFromSSE();
      } else if (
        this.eventSource?.readyState === EventSourcePolyfill.CLOSED ||
        this.eventSource?.readyState === EventSourcePolyfill.CONNECTING
      ) {
        this.eventSource.close();
        setTimeout(() => {
          this.logger('info', 'client:connectToSSE() - Reconnecting to SSE', {});
          this.connectToSSE(onCallBack);
        }, 3000);
      }
    };
  }

  public async disconnectFromSSE(): Promise<void> {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      this.logger('info', 'client:disconnectFromSSE() - SSE connection closed', {});
    } else {
      this.logger('info', 'client:disconnectFromSSE() - SSE connection already closed', {});
    }
  }

  /**
   * queryUsers - Query users and watch user presence
   *
   *
   * @return {Promise<{
   *data: Array<UserResponse<ErmisChatGenerics>>,
   *count: number,
   *total: number,
   *page: number,
   *page_count: number,
   * }>} User Query Response
   */
  async queryUsers(page_size?: string, page?: number): Promise<UsersResponse> {
    const defaultOptions = {
      presence: false,
    };

    // Make sure we wait for the connect promise if there is a pending one
    await this.wsPromise;

    if (!this._hasConnectionID()) {
      defaultOptions.presence = false;
    }
    let project_id = this.projectId;
    // Return a list of users
    const data = await this.get<UsersResponse>(this.baseURL + '/uss/v1/users', {
      project_id,
      page,
      page_size,
    });

    this.state.updateUsers(data.data);

    return data;
  }

  async queryUser(user_id: string): Promise<UserResponse<ErmisChatGenerics>> {
    const project_id = this.projectId;

    const userResponse = await this.get<UserResponse<ErmisChatGenerics>>(this.baseURL + '/uss/v1/users/' + user_id, {
      project_id,
    });

    this.state.updateUser(userResponse);
    return userResponse;
  }

  async getBatchUsers(users: string[], page?: number, page_size?: number) {
    let project_id = this.projectId;

    const usersRepsonse = await this.post<UsersResponse>(
      this.baseURL + '/uss/v1/users/batch?page=1&page_size=10000',
      { users, project_id },
      { page, page_size },
    );

    this.state.updateUsers(usersRepsonse.data);

    return usersRepsonse.data || [];
  }

  async searchUsers(page: number, page_size: number, name?: string): Promise<UsersResponse> {
    let project_id = this.projectId;

    const usersResponse = await this.post<UsersResponse>(this.baseURL + '/uss/v1/users/search', undefined, {
      page,
      page_size,
      name,
      project_id,
    });

    // this.state.updateUsers(usersResponse.data);

    return usersResponse;
  }

  async queryContacts(): Promise<ContactResult> {
    let project_id = this.projectId;
    const contactResponse = await this.post<ContactResponse>(this.baseURL + '/contacts/list', { project_id });
    const userIds = contactResponse.project_id_user_ids[project_id];
    const contact_users: UserResponse<ErmisChatGenerics>[] = [];
    const block_users: UserResponse<ErmisChatGenerics>[] = [];

    userIds.forEach((contact: Contact) => {
      const userID = contact.other_id;
      const state_user = this.state.users[userID];
      const user = state_user ? state_user : { id: userID };
      switch (contact.relation_status) {
        case 'blocked':
          block_users.push(user);
          break;
        case 'normal':
          contact_users.push(user);
          break;
        default:
      }
    });

    return {
      contact_users,
      block_users,
    };
  }

  async getChains(): Promise<ChainsResponse> {
    let chain_response = await this.get<ChainsResponse>(this.baseURL + '/uss/v1/users/chains');
    this.chains = chain_response;
    return chain_response;
  }

  /**
   *
   * @param chain_project includes chain_id and clients.
   * clients just includes updating client.
   * projects just includes updating project.
   */
  async joinChainProject(project_id: string): Promise<ChainsResponse> {
    let chains_response = await this.post<ChainsResponse>(this.baseURL + '/uss/v1/users/join', { project_id });
    this.chains = chains_response;
    return chains_response;
  }

  _updateProjectID(project_id: string) {
    this.projectId = project_id;
  }

  async uploadFile(file: any) {
    const formData = new FormData();
    formData.append('avatar', file);
    let response = await this.post<{ avatar: string }>(this.baseURL + '/uss/v1/users/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    if (this.user) {
      this.user.avatar = response.avatar;
      const new_user = { ...this.user, avatar: response.avatar };
      this.state.updateUser(new_user);
    }
    if (this._user) {
      this._user.avatar = response.avatar;
    }
    return response;
  }

  async updateProfile(name: string, about_me: string) {
    let body = {
      name,
      about_me,
    };
    let response = await this.patch<UserResponse<ErmisChatGenerics>>(this.baseURL + '/uss/v1/users/update', body);
    this.user = response;
    this._user = response;
    this.state.updateUser(response);
    return response;
  }

  /**
   * queryChannels - Query channels
   *
   * @param {ChannelFilters<ErmisChatGenerics>} filterConditions object MongoDB style filters
   * @param {ChannelSort<ErmisChatGenerics>} [sort] Sort options, for instance {created_at: -1}.
   * When using multiple fields, make sure you use array of objects to guarantee field order, for instance [{last_updated: -1}, {created_at: 1}]
   * @param {ChannelOptions} [options] Options object
   * @param {ChannelStateOptions} [stateOptions] State options object. These options will only be used for state management and won't be sent in the request.
   * - stateOptions.skipInitialization - Skips the initialization of the state for the channels matching the ids in the list.
   *
   * @return {Promise<{ channels: Array<ChannelAPIResponse<AErmisChatGenerics>>}> } search channels response
   */
  async queryChannels(
    filterConditions: ChannelFilters<ErmisChatGenerics>,
    sort: ChannelSort<ErmisChatGenerics> = [],
    options: ChannelOptions = {},
    stateOptions: ChannelStateOptions = {},
  ) {
    // Make sure we wait for the connect promise if there is a pending one
    await this.wsPromise;

    let project_id = this.projectId;

    // Return a list of channels
    const payload = {
      filter_conditions: { ...filterConditions, project_id },
      sort: normalizeQuerySort(sort),
      ...options,
    };

    const data = await this.post<QueryChannelsAPIResponse<ErmisChatGenerics>>(this.baseURL + '/channels', payload);

    // Sort channels by latest message created_at (including topics if present)
    data.channels.sort((a, b) => {
      // Helper to get latest created_at from messages array
      const getLatestCreatedAt = (messages: any[] = []) =>
        messages.length > 0 ? Math.max(...messages.map((msg) => new Date(msg.created_at).getTime())) : 0;

      // Get latest message created_at in channel a
      let aLatest = getLatestCreatedAt(a.messages);

      // If channel a has topics, check messages in topics
      if (a.channel.type === 'team' && Array.isArray(a.topics)) {
        for (const topic of a.topics) {
          aLatest = Math.max(aLatest, getLatestCreatedAt(topic.messages));
        }
      }

      // Get latest message created_at in channel b
      let bLatest = getLatestCreatedAt(b.messages);

      // If channel b has topics, check messages in topics
      if (b.channel.type === 'team' && Array.isArray(b.topics)) {
        for (const topic of b.topics) {
          bLatest = Math.max(bLatest, getLatestCreatedAt(topic.messages));
        }
      }

      // Descending order (newest first)
      return bLatest - aLatest;
    });

    const memberIds =
      Array.from(
        new Set(data.channels.flatMap((c) => (c.channel.members || []).map((member: any) => member.user.id))),
      ) || [];

    const membersInfo = filterConditions.parent_cid
      ? Object.values(this.state.users)
      : await this.getBatchUsers(memberIds);
    data.channels.forEach((c) => {
      c.channel.members = enrichWithUserInfo(c.channel.members, membersInfo);
      c.messages = enrichWithUserInfo(c.messages, membersInfo);
      c.read = enrichWithUserInfo(c.read || [], membersInfo);
      c.channel.name =
        c.channel.type === 'messaging' ? getDirectChannelName(c.channel.members, this.userID || '') : c.channel.name;
      c.channel.image =
        c.channel.type === 'messaging' ? getDirectChannelImage(c.channel.members, this.userID || '') : c.channel.image;
    });

    this.dispatchEvent({
      type: 'channels.queried',
      queriedChannels: {
        channels: data.channels,
        isLatestMessageSet: true,
      },
    });

    const { channels, userIds } = this.hydrateChannels(data.channels, stateOptions);

    // if (userIds.length > 0) {
    //   await this.getBatchUsers(userIds);
    // }

    return channels;
  }

  /**
   * @param {ChannelFilters<ErmisChatGenerics>} filterConditions for invited channels: just set roles to ['pending'], The "type" field still has the same options as before.
   * type: ["general", "team", "messaging"],
   * roles: ["owner", "moder", "member","pending"],
   *
   **/
  async queryInvitedChannels(
    filterConditions: ChannelFilters<ErmisChatGenerics>,
    sort: ChannelSort<ErmisChatGenerics> = [],
    options: ChannelOptions = {},
    stateOptions: ChannelStateOptions = {},
  ) {
    // Ensure the roles field is always set to pending.
    const invitedFilter = { ...filterConditions, roles: ['pending'] };

    // Make sure we wait for the connect promise if there is a pending one
    await this.wsPromise;

    let project_id = this.projectId;

    // Return a list of channels
    const payload = {
      filter_conditions: { ...invitedFilter, project_id },
      sort: normalizeQuerySort(sort),
      ...options,
    };

    const data = await this.post<QueryChannelsAPIResponse<ErmisChatGenerics>>(this.baseURL + '/channels', payload);

    const { channels, userIds } = this.hydrateChannels(data.channels, stateOptions);

    if (userIds.length > 0) {
      await this.getBatchUsers(userIds);
    }

    return channels;
  }

  async startCall(payload: any) {
    const connection_id = this.wsConnection?.connectionID;
    const data = {
      ...payload,
      connection_id,
    };

    return this.post(this.baseURL + '/signal', data);
  }

  hydrateChannels(
    channelsFromApi: ChannelAPIResponse<ErmisChatGenerics>[] = [],
    stateOptions: ChannelStateOptions = {},
  ) {
    const { skipInitialization, offlineMode = false } = stateOptions;

    // NOTE: we don't send config with channel data anymore
    // for (const channelState of channelsFromApi) {
    //   this._addChannelConfig(channelState.channel);
    // }

    const channels: Channel<ErmisChatGenerics>[] = [];
    const userIds: string[] = [];
    for (const channelState of channelsFromApi) {
      const c = this.channel(channelState.channel.type, channelState.channel.id);
      c.data = { ...channelState.channel, is_pinned: channelState.is_pinned || false };
      c.offlineMode = offlineMode;
      c.initialized = !offlineMode;

      if (skipInitialization === undefined) {
        c._initializeState(channelState, 'latest', (id) => {
          if (!userIds.includes(id)) {
            userIds.push(id);
          }
        });
      } else if (!skipInitialization.includes(channelState.channel.id)) {
        c.state.clearMessages();
        c._initializeState(channelState, 'latest', (id) => {
          if (!userIds.includes(id)) {
            userIds.push(id);
          }
        });
      }

      channels.push(c);
    }

    // const sortedChannels = channels.sort((a: any, b: any) => {
    //   const aTime = a.state.last_message_at
    //     ? new Date(a.state.last_message_at).getTime()
    //     : a.data.created_at
    //     ? new Date(a.data.created_at).getTime()
    //     : 0;
    //   const bTime = b.state.last_message_at
    //     ? new Date(b.state.last_message_at).getTime()
    //     : b.data.created_at
    //     ? new Date(b.data.created_at).getTime()
    //     : 0;
    //   return bTime - aTime; // Descending order
    // });

    // ensure we have the users for all the channels we just added

    return { channels, userIds };
  }

  async searchPublicChannel(search_term: string, offset = 0, limit = 25) {
    let project_id = this.projectId;

    return await this.post<APIResponse>(this.baseURL + `/channels/public/search`, {
      project_id,
      search_term,
      limit: limit,
      offset: offset,
    });
  }

  async pinChannel(channelType: string, channelId: string) {
    return await this.post<APIResponse>(this.baseURL + `/channels/${channelType}/${channelId}/pin`);
  }

  async unpinChannel(channelType: string, channelId: string) {
    return await this.post<APIResponse>(this.baseURL + `/channels/${channelType}/${channelId}/unpin`);
  }

  /**
   * getUnreadCount - Returns unread counts for a single user
   *
   * @param {string} [userID] User ID.
   *
   * @return {<GetUnreadCountAPIResponse>}
   */
  async getUnreadCount(userID?: string) {
    return await this.get<GetUnreadCountAPIResponse>(this.baseURL + '/unread', userID ? { user_id: userID } : {});
  }

  _addChannelConfig({ cid, config }: ChannelResponse<ErmisChatGenerics>) {
    this.configs[cid] = config;
  }

  /**
   * channel - Returns a new channel with the given type, id and custom data
   *
   * If you want to create a unique conversation between 2 or more users; you can leave out the ID parameter and provide the list of members.
   * Make sure to await channel.create() or channel.watch() before accessing channel functions:
   * ie. channel = client.channel("messaging", {members: ["tommaso", "thierry"]})
   * await channel.create() to assign an ID to channel
   *
   * @param {string} channelType The channel type
   * @param {string | ChannelData<ErmisChatGenerics> | null} [channelIDOrCustom]   The channel ID, you can leave this out if you want to create a conversation channel
   * @param {object} [custom]    Custom data to attach to the channel
   *
   * @return {channel} The channel object, initialize it using channel.watch()
   */
  channel(
    channelType: string,
    channelID?: string | null,
    custom?: ChannelData<ErmisChatGenerics>,
  ): Channel<ErmisChatGenerics>;
  channel(channelType: string, custom?: ChannelData<ErmisChatGenerics>): Channel<ErmisChatGenerics>;
  channel(
    channelType: string,
    channelIDOrCustom?: string | ChannelData<ErmisChatGenerics> | null,
    custom: ChannelData<ErmisChatGenerics> = {} as ChannelData<ErmisChatGenerics>,
  ) {
    if (!this.userID) {
      throw Error('Call connectUser or connectAnonymousUser before creating a channel');
    }

    if (~channelType.indexOf(':')) {
      throw Error(`Invalid channel group ${channelType}, can't contain the : character`);
    }

    // support channel("messaging", {options})
    if (channelIDOrCustom && typeof channelIDOrCustom === 'object') {
      return this.getChannel(channelType, channelIDOrCustom);
    }

    // support channel("messaging", null, {options})
    // support channel("messaging", undefined, {options})
    // support channel("messaging", "", {options})
    if (!channelIDOrCustom) {
      return new Channel<ErmisChatGenerics>(this, channelType, undefined, custom);
    }

    return this.getChannelById(channelType, channelIDOrCustom, custom);
  }

  /**
   * Its a helper method for `client.channel()` method, used to channel given the id of channel.
   *
   * If the channel already exists in `activeChannels` list, then we simply return it, since that
   * means the same channel was already requested or created.
   *
   * Otherwise we create a new instance of Channel class and return it.
   *
   * @private
   *
   * @param {string} channelType The channel type
   * @param {string} [channelID] The channel ID
   * @param {object} [custom]    Custom data to attach to the channel
   *
   * @return {channel} The channel object, initialize it using channel.watch()
   */
  getChannelById = (channelType: string, channelID: string, custom: ChannelData<ErmisChatGenerics>) => {
    /**
     * don't handle channelID without : character anymore
     */
    // if (typeof channelID === 'string' && ~channelID.indexOf(':')) {
    //   throw Error(`Invalid channel id ${channelID}, can't contain the : character`);
    // }

    // only allow 1 channel object per cid
    const cid = `${channelType}:${channelID}`;
    if (cid in this.activeChannels && !this.activeChannels[cid].disconnected) {
      const channel = this.activeChannels[cid];
      if (Object.keys(custom).length > 0) {
        channel.data = custom;
        channel._data = custom;
      }
      return channel;
    }
    const channel = new Channel<ErmisChatGenerics>(this, channelType, channelID, custom);
    this.activeChannels[channel.cid] = channel;

    return channel;
  };
  /**
   *  getChannel - Returns a new channel with the given type, id and custom data
   * team channel id will be automatically generated from sdk.
   * */
  getChannel = (channelType: string, custom: ChannelData<ErmisChatGenerics>) => {
    const uuid = randomId();
    const id = `${this.projectId}:${uuid}`;
    // only allow 1 channel object per cid
    const cid = `${channelType}:${id}`;
    if (cid in this.activeChannels && !this.activeChannels[cid].disconnected) {
      const channel = this.activeChannels[cid];
      if (Object.keys(custom).length > 0) {
        channel.data = custom;
        channel._data = custom;
      }
      return channel;
    }
    const channel = new Channel<ErmisChatGenerics>(this, channelType, id, custom);
    this.activeChannels[channel.cid] = channel;

    return channel;
  };

  getUserAgent() {
    return (
      this.userAgent || `ermis-chat-sdk-javascript-client-${this.node ? 'node' : 'browser'}-${process.env.PKG_VERSION}`
    );
  }

  setUserAgent(userAgent: string) {
    this.userAgent = userAgent;
  }

  _enrichAxiosOptions(
    options: AxiosRequestConfig & { config?: AxiosRequestConfig } = {
      params: {},
      headers: {},
      config: {},
    },
  ): AxiosRequestConfig {
    let token = this._getToken();

    if (!token?.startsWith('Bearer ')) {
      token = `Bearer ${token}`;
    }

    const authorization = token ? { Authorization: token } : undefined;
    let signal: AbortSignal | null = null;
    if (this.nextRequestAbortController !== null) {
      signal = this.nextRequestAbortController.signal;
      this.nextRequestAbortController = null;
    }

    if (!options.headers?.['x-client-request-id']) {
      options.headers = {
        ...options.headers,
        'x-client-request-id': randomId(),
      };
    }
    const {
      params: axiosRequestConfigParams,
      headers: axiosRequestConfigHeaders,
      ...axiosRequestConfigRest
    } = this.options.axiosRequestConfig || {};

    let user_service_params = {
      ...options.params,
      ...(axiosRequestConfigParams || {}),
    };

    return {
      params: user_service_params,
      headers: {
        ...authorization,
        'stream-auth-type': this.getAuthType(),
        'X-Stream-Client': this.getUserAgent(),
        ...options.headers,
        ...(axiosRequestConfigHeaders || {}),
      },
      ...(signal ? { signal } : {}),
      ...options.config,
      ...(axiosRequestConfigRest || {}),
    };
  }

  _getToken() {
    if (!this.tokenManager) return null;

    return this.tokenManager.getToken();
  }

  /**
   * encode ws url payload
   * @private
   * @returns json string
   */
  _buildWSPayload = (client_request_id?: string) => {
    return JSON.stringify({
      user_id: this.userID,
      user_details: this._user,
      device: this.options.device,
      client_request_id,
    });
  };

  /** sync - returns all events that happened for a list of channels since last sync
   * @param {string[]} channel_cids list of channel CIDs
   * @param {string} last_sync_at last time the user was online and in sync. RFC3339 ie. "2020-05-06T15:05:01.207Z"
   * @param {SyncOptions} options See JSDoc in the type fields for more info
   *
   * @returns {Promise<SyncResponse>}
   */
  sync(channel_cids: string[], last_sync_at: string, options: SyncOptions = {}) {
    return this.post<SyncResponse>(`${this.baseURL}/sync`, {
      channel_cids,
      last_sync_at,
      ...options,
    });
  }

  /**
   * deleteChannels - Deletes a list of channel
   *
   * @param {string[]} cids Channel CIDs
   * @param {boolean} [options.hard_delete] Defines if the channel is hard deleted or not
   *
   * @return {DeleteChannelsResponse} Result of the soft deletion, if server-side, it holds the task ID as well
   */
  async deleteChannels(cids: string[], options: { hard_delete?: boolean } = {}) {
    return await this.post<APIResponse & DeleteChannelsResponse>(this.baseURL + `/channels/delete`, {
      cids,
      ...options,
    });
  }
}
