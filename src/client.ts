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
  MarkChannelsReadOptions,
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
import { InsightMetrics } from './insights';
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
  anonymous: boolean;
  persistUserOnConnectionFailure?: boolean;
  axiosInstance: AxiosInstance;
  baseURL?: string;
  browser: boolean;
  cleaningIntervalRef?: NodeJS.Timeout;
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
  mutedUsers: Mute<ErmisChatGenerics>[];
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
  insightMetrics: InsightMetrics;
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
    this.mutedUsers = [];

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
    this.anonymous = false;
    this.persistUserOnConnectionFailure = this.options?.persistUserOnConnectionFailure;

    // If its a server-side client, then lets initialize the tokenManager, since token will be
    // generated from secret.
    this.tokenManager = new TokenManager(this.secret);
    this.consecutiveFailures = 0;
    this.insightMetrics = new InsightMetrics();

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
    return this.anonymous ? 'anonymous' : 'jwt';
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

  async getExternalAuthToken(apikey: string, name?: string, avatar?: string) {
    const params: any = { apikey };
    if (name!!) {
      params.name = name;
    }
    if (avatar!!) {
      params.avatar = avatar;
    }
    return await this.get<GetTokenResponse>(this.baseURL + '/uss/v1/get_token/external_auth', params);
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
      this.tokenManager.setTokenOrProvider(userTokenOrProvider, user);
      try {
        const external_auth_token = await this.getExternalAuthToken(this.key, user.name, user.avatar);

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

    if ((this._isUsingServerAuth() || this.node) && !this.options.allowServerSideConnect) {
      console.warn(
        'Please do not use connectUser server side. connectUser impacts MAU and concurrent connection usage and thus your bill. If you have a valid use-case, add "allowServerSideConnect: true" to the client options to disable this warning.',
      );
    }

    // we generate the client id client side
    this.userID = user.id;
    this.anonymous = false;

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
      if (this.persistUserOnConnectionFailure) {
        // cleanup client to allow the user to retry connectUser again
        this.closeConnection();
      } else {
        this.disconnectUser();
      }
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
    if (this.cleaningIntervalRef != null) {
      clearInterval(this.cleaningIntervalRef);
      this.cleaningIntervalRef = undefined;
    }

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
    this._startCleaning();
    return this.wsPromise;
  };

  /**
   * @deprecated Please use client.openConnction instead.
   * @private
   *
   * Creates a new websocket connection with current user.
   */
  _setupConnection = this.openConnection;

  /**
   * updateAppSettings - updates application settings
   *
   * @param {AppSettings} options App settings.
   * IE: {
      'apn_config': {
        'auth_type': 'token',
        'auth_key": fs.readFileSync(
          './apn-push-auth-key.p8',
          'utf-8',
        ),
        'key_id': 'keyid',
        'team_id': 'teamid',
        'notification_template": 'notification handlebars template',
        'bundle_id': 'com.apple.your.app',
        'development': true
      },
      'firebase_config': {
        'server_key': 'server key from fcm',
        'notification_template': 'notification handlebars template',
        'data_template': 'data handlebars template',
        'apn_template': 'apn notification handlebars template under v2'
      },
      'webhook_url': 'https://acme.com/my/awesome/webhook/'
    }
   */
  async updateAppSettings(options: AppSettings) {
    const apn_config = options.apn_config;
    if (apn_config?.p12_cert) {
      options = {
        ...options,
        apn_config: {
          ...apn_config,
          p12_cert: Buffer.from(apn_config.p12_cert).toString('base64'),
        },
      };
    }
    return await this.patch<APIResponse>(this.baseURL + '/app', options);
  }

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
   * Revokes all tokens on application level issued before given time
   */
  async revokeTokens(before: Date | string | null) {
    return await this.updateAppSettings({
      revoke_tokens_issued_before: this._normalizeDate(before),
    });
  }

  /**
   * Revokes token for a user issued before given time
   */
  async revokeUserToken(userID: string, before?: Date | string | null) {
    return await this.revokeUsersToken([userID], before);
  }

  /**
   * Revokes tokens for a list of users issued before given time
   */
  async revokeUsersToken(userIDs: string[], before?: Date | string | null) {
    if (before === undefined) {
      before = new Date().toISOString();
    } else {
      before = this._normalizeDate(before);
    }

    const users: PartialUserUpdate<ErmisChatGenerics>[] = [];
    for (const userID of userIDs) {
      users.push({
        id: userID,
        set: <Partial<UserResponse<ErmisChatGenerics>>>{
          revoke_tokens_issued_before: before,
        },
      });
    }

    return await this.partialUpdateUsers(users);
  }

  /**
   * getAppSettings - retrieves application settings
   */
  async getAppSettings() {
    return await this.get<AppSettingsAPIResponse<ErmisChatGenerics>>(this.baseURL + '/app');
  }

  /**
   * testPushSettings - Tests the push settings for a user with a random chat message and the configured push templates
   *
   * @param {string} userID User ID. If user has no devices, it will error
   * @param {TestPushDataInput} [data] Overrides for push templates/message used
   *  IE: {
        messageID: 'id-of-message', // will error if message does not exist
        apnTemplate: '{}', // if app doesn't have apn configured it will error
        firebaseTemplate: '{}', // if app doesn't have firebase configured it will error
        firebaseDataTemplate: '{}', // if app doesn't have firebase configured it will error
        skipDevices: true, // skip config/device checks and sending to real devices
        pushProviderName: 'staging' // one of your configured push providers
        pushProviderType: 'apn' // one of supported provider types
      }
  */
  async testPushSettings(userID: string, data: TestPushDataInput = {}) {
    return await this.post<CheckPushResponse>(this.baseURL + '/check_push', {
      user_id: userID,
      ...(data.messageID ? { message_id: data.messageID } : {}),
      ...(data.apnTemplate ? { apn_template: data.apnTemplate } : {}),
      ...(data.firebaseTemplate ? { firebase_template: data.firebaseTemplate } : {}),
      ...(data.firebaseDataTemplate ? { firebase_data_template: data.firebaseDataTemplate } : {}),
      ...(data.skipDevices ? { skip_devices: true } : {}),
      ...(data.pushProviderName ? { push_provider_name: data.pushProviderName } : {}),
      ...(data.pushProviderType ? { push_provider_type: data.pushProviderType } : {}),
    });
  }

  /**
   * testSQSSettings - Tests that the given or configured SQS configuration is valid
   *
   * @param {TestSQSDataInput} [data] Overrides SQS settings for testing if needed
   *  IE: {
        sqs_key: 'auth_key',
        sqs_secret: 'auth_secret',
        sqs_url: 'url_to_queue',
      }
   */
  async testSQSSettings(data: TestSQSDataInput = {}) {
    return await this.post<CheckSQSResponse>(this.baseURL + '/check_sqs', data);
  }

  /**
   * testSNSSettings - Tests that the given or configured SNS configuration is valid
   *
   * @param {TestSNSDataInput} [data] Overrides SNS settings for testing if needed
   *  IE: {
        sns_key: 'auth_key',
        sns_secret: 'auth_secret',
        sns_topic_arn: 'topic_to_publish_to',
      }
   */
  async testSNSSettings(data: TestSNSDataInput = {}) {
    return await this.post<CheckSNSResponse>(this.baseURL + '/check_sns', data);
  }

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

    this.anonymous = false;

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
   * connectAnonymousUser - Set an anonymous user and open a WebSocket connection
   */
  connectAnonymousUser = () => {
    if ((this._isUsingServerAuth() || this.node) && !this.options.allowServerSideConnect) {
      console.warn(
        'Please do not use connectUser server side. connectUser impacts MAU and concurrent connection usage and thus your bill. If you have a valid use-case, add "allowServerSideConnect: true" to the client options to disable this warning.',
      );
    }

    this.anonymous = true;
    this.userID = randomId();
    const anonymousUser = {
      id: this.userID,
      anon: true,
    } as UserResponse<ErmisChatGenerics>;

    this._setToken(anonymousUser, '');
    this._setUser(anonymousUser);

    return this._setupConnection();
  };

  /**
   * @deprecated Please use connectAnonymousUser. Its naming is more consistent with its functionality.
   */
  setAnonymousUser = this.connectAnonymousUser;

  /**
   * setGuestUser - Setup a temporary guest user
   *
   * @param {UserResponse<ErmisChatGenerics>} user Data about this user. IE {name: "john"}
   *
   * @return {ConnectAPIResponse<ErmisChatGenerics>} Returns a promise that resolves when the connection is setup
   */
  async setGuestUser(user: UserResponse<ErmisChatGenerics>) {
    let response: { access_token: string; user: UserResponse<ErmisChatGenerics> } | undefined;
    this.anonymous = true;
    try {
      response = await this.post<
        APIResponse & {
          access_token: string;
          user: UserResponse<ErmisChatGenerics>;
        }
      >(this.baseURL + '/guest', { user });
    } catch (e) {
      this.anonymous = false;
      throw e;
    }
    this.anonymous = false;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { created_at, updated_at, last_active, online, ...guestUser } = response.user;
    return await this.connectUser(guestUser as UserResponse<ErmisChatGenerics>, response.access_token);
  }

  /**
   * createToken - Creates a token to authenticate this user. This function is used server side.
   * The resulting token should be passed to the client side when the users registers or logs in.
   *
   * @param {string} userID The User ID
   * @param {number} [exp] The expiration time for the token expressed in the number of seconds since the epoch
   *
   * @return {string} Returns a token
   */
  createToken(userID: string, exp?: number, iat?: number) {
    if (this.secret == null) {
      throw Error(`tokens can only be created server-side using the API Secret`);
    }
    const extra: { exp?: number; iat?: number } = {};

    if (exp) {
      extra.exp = exp;
    }

    if (iat) {
      extra.iat = iat;
    }

    return JWTUserToken(this.secret, userID, extra, {});
  }

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

  /**
   * @private
   *
   * Handle following user related events:
   * - user.presence.changed
   * - user.updated
   * - user.deleted
   *
   * @param {Event} event
   */
  // _handleUserEvent = (event: Event<ErmisChatGenerics>) => {
  //   if (!event.user) {
  //     return;
  //   }

  //   /** update the client.state with any changes to users */
  //   if (event.type === 'user.presence.changed' || event.type === 'user.updated') {
  //     if (event.user.id === this.userID) {
  //       const user = { ...(this.user || {}) };
  //       const _user = { ...(this._user || {}) };

  //       // Remove deleted properties from user objects.
  //       for (const key in this.user) {
  //         if (key in event.user || isOwnUserBaseProperty(key)) {
  //           continue;
  //         }

  //         delete user[key];
  //         delete _user[key];
  //       }

  //       /** Updating only available properties in _user object. */
  //       for (const key in event.user) {
  //         if (_user && key in _user) {
  //           _user[key] = event.user[key];
  //         }
  //       }

  //       // @ts-expect-error
  //       this._user = { ..._user };
  //       this.user = { ...user, ...event.user };
  //     }

  //     this.state.updateUser(event.user);
  //     this._updateMemberWatcherReferences(event.user);
  //   }

  //   if (event.type === 'user.updated') {
  //     this._updateUserMessageReferences(event.user);
  //   }

  //   if (event.type === 'user.deleted' && event.user.deleted_at && (event.mark_messages_deleted || event.hard_delete)) {
  //     this._deleteUserMessageReference(event.user, event.hard_delete);
  //   }
  // };

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
      // client.mutedUsers = event.me.mutes;
    }

    if (event.channel && event.type === 'notification.message_new') {
      this._addChannelConfig(event.channel);
    }

    // if (event.type === 'notification.channel_mutes_updated' && event.me?.channel_mutes) {
    //   this.mutedChannels = event.me.channel_mutes;
    // }

    // if (event.type === 'notification.mutes_updated' && event.me?.mutes) {
    //   this.mutedUsers = event.me.mutes;
    // }

    // if (event.type === 'notification.mark_read' && event.unread_channels === 0) {
    //   const activeChannelKeys = Object.keys(this.activeChannels);
    //   activeChannelKeys.forEach((activeChannelKey) => (this.activeChannels[activeChannelKey].state.unreadCount = 0));
    // }

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

    // if (!this.wsConnection && (this.options.warmUp || this.options.enableInsights)) {
    //   this._sayHi();
    // }
    // The StableWSConnection handles all the reconnection logic.
    if (this.options.wsConnection && this.node) {
      // Intentionally avoiding adding ts generics on wsConnection in options since its only useful for unit test purpose.
      ((this.options.wsConnection as unknown) as StableWSConnection<ErmisChatGenerics>).setClient(this);
      this.wsConnection = (this.options.wsConnection as unknown) as StableWSConnection<ErmisChatGenerics>;
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
   * Check the connectivity with server for warmup purpose.
   *
   * @private
   */
  _sayHi() {
    const client_request_id = randomId();
    const opts = { headers: { 'x-client-request-id': client_request_id } };
    this.doAxiosRequest('get', this.baseURL + '/', null, opts).catch((e) => {});
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
   * queryBannedUsers - Query user bans
   *
   * @param {BannedUsersFilters} filterConditions MongoDB style filter conditions
   * @param {BannedUsersSort} sort Sort options [{created_at: 1}].
   * @param {BannedUsersPaginationOptions} options Option object, {limit: 10, offset:0, exclude_expired_bans: true}
   *
   * @return {Promise<BannedUsersResponse<ErmisChatGenerics>>} Ban Query Response
   */
  async queryBannedUsers(
    filterConditions: BannedUsersFilters = {},
    sort: BannedUsersSort = [],
    options: BannedUsersPaginationOptions = {},
  ) {
    // Return a list of user bans
    return await this.get<BannedUsersResponse<ErmisChatGenerics>>(this.baseURL + '/query_banned_users', {
      payload: {
        filter_conditions: filterConditions,
        sort: normalizeQuerySort(sort),
        ...options,
      },
    });
  }

  /**
   * queryMessageFlags - Query message flags
   *
   * @param {MessageFlagsFilters} filterConditions MongoDB style filter conditions
   * @param {MessageFlagsPaginationOptions} options Option object, {limit: 10, offset:0}
   *
   * @return {Promise<MessageFlagsResponse<ErmisChatGenerics>>} Message Flags Response
   */
  async queryMessageFlags(filterConditions: MessageFlagsFilters = {}, options: MessageFlagsPaginationOptions = {}) {
    // Return a list of message flags
    return await this.get<MessageFlagsResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/flags/message', {
      payload: { filter_conditions: filterConditions, ...options },
    });
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

    const memberIds =
      Array.from(
        new Set(data.channels.flatMap((c) => (c.channel.members || []).map((member: any) => member.user.id))),
      ) || [];

    const membersInfo = await this.getBatchUsers(memberIds);
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

    const { channels, userIds } = await this.hydrateChannels(data.channels, stateOptions);

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

    const { channels, userIds } = await this.hydrateChannels(data.channels, stateOptions);

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

  /**
   * queryReactions - Query reactions
   *
   * @param {ReactionFilters<ErmisChatGenerics>} filter object MongoDB style filters
   * @param {ReactionSort<ErmisChatGenerics>} [sort] Sort options, for instance {created_at: -1}.
   * @param {QueryReactionsOptions} [options] Pagination object
   *
   * @return {Promise<{ QueryReactionsAPIResponse } search channels response
   */
  async queryReactions(
    messageID: string,
    filter: ReactionFilters<ErmisChatGenerics>,
    sort: ReactionSort<ErmisChatGenerics> = [],
    options: QueryReactionsOptions = {},
  ) {
    // Make sure we wait for the connect promise if there is a pending one
    await this.wsPromise;

    // Return a list of channels
    const payload = {
      filter,
      sort: normalizeQuerySort(sort),
      ...options,
    };

    return await this.post<QueryReactionsAPIResponse<ErmisChatGenerics>>(
      this.baseURL + '/messages/' + messageID + '/reactions',
      payload,
    );
  }

  async hydrateChannels(
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

    // ensure we have the users for all the channels we just added

    return { channels, userIds };
  }

  /**
   * search - Query messages
   *
   * @param {ChannelFilters<ErmisChatGenerics>} filterConditions MongoDB style filter conditions
   * @param {MessageFilters<ErmisChatGenerics> | string} query search query or object MongoDB style filters
   * @param {SearchOptions<ErmisChatGenerics>} [options] Option object, {user_id: 'tommaso'}
   *
   * @return {Promise<SearchAPIResponse<ErmisChatGenerics>>} search messages response
   */
  async search(
    filterConditions: ChannelFilters<ErmisChatGenerics>,
    query: string | MessageFilters<ErmisChatGenerics>,
    options: SearchOptions<ErmisChatGenerics> = {},
  ) {
    if (options.offset && options.next) {
      throw Error(`Cannot specify offset with next`);
    }
    const payload: SearchPayload<ErmisChatGenerics> = {
      filter_conditions: filterConditions,
      ...options,
      sort: options.sort ? normalizeQuerySort<SearchMessageSortBase<ErmisChatGenerics>>(options.sort) : undefined,
    };
    if (typeof query === 'string') {
      payload.query = query;
    } else if (typeof query === 'object') {
      payload.message_filter_conditions = query;
    } else {
      throw Error(`Invalid type ${typeof query} for query parameter`);
    }

    // Make sure we wait for the connect promise if there is a pending one
    await this.wsPromise;

    return await this.get<SearchAPIResponse<ErmisChatGenerics>>(this.baseURL + '/search', { payload });
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
   * setLocalDevice - Set the device info for the current client(device) that will be sent via WS connection automatically
   *
   * @param {BaseDeviceFields} device the device object
   * @param {string} device.id device id
   * @param {string} device.push_provider the push provider
   *
   */
  setLocalDevice(device: BaseDeviceFields) {
    if (
      (this.wsConnection?.isConnecting && this.wsPromise) ||
      ((this.wsConnection?.isHealthy || this.wsFallback?.isHealthy()) && this._hasConnectionID())
    ) {
      throw new Error('you can only set device before opening a websocket connection');
    }

    this.options.device = device;
  }

  /**
   * addDevice - Adds a push device for a user.
   *
   * @param {string} id the device id
   * @param {PushProvider} push_provider the push provider
   * @param {string} [userID] the user id (defaults to current user)
   * @param {string} [push_provider_name] user provided push provider name for multi bundle support
   *
   */
  async addDevice(id: string, push_provider: PushProvider, userID?: string, push_provider_name?: string) {
    return await this.post<APIResponse>(this.baseURL + '/devices/add', {
      id,
      push_provider,
      ...(userID != null ? { user_id: userID } : {}),
      ...(push_provider_name != null ? { push_provider_name } : {}),
    });
  }

  /**
   * getDevices - Returns the devices associated with a current user
   *
   * @param {string} [userID] User ID. Only works on serverside
   *
   * @return {Device<ErmisChatGenerics>[]} Array of devices
   */
  async getDevices(userID?: string) {
    return await this.get<APIResponse & { devices?: Device<ErmisChatGenerics>[] }>(
      this.baseURL + '/devices',
      userID ? { user_id: userID } : {},
    );
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

  /**
   * getUnreadCountBatch - Returns unread counts for multiple users at once. Only works server side.
   *
   * @param {string[]} [userIDs] List of user IDs to fetch unread counts for.
   *
   * @return {<GetUnreadCountBatchAPIResponse>}
   */
  async getUnreadCountBatch(userIDs: string[]) {
    return await this.post<GetUnreadCountBatchAPIResponse>(this.baseURL + '/unread_batch', { user_ids: userIDs });
  }

  /**
   * removeDevice - Removes the device with the given id. Clientside users can only delete their own devices
   *
   * @param {string} id The device id
   * @param {string} [userID] The user id. Only specify this for serverside requests
   *
   */
  async removeDevice(id: string, userID?: string) {
    return await this.post<APIResponse>(this.baseURL + '/devices/delete', {
      id,
      ...(userID ? { user_id: userID } : {}),
    });
  }

  /**
   * getRateLimits - Returns the rate limits quota and usage for the current app, possibly filter for a specific platform and/or endpoints.
   * Only available server-side.
   *
   * @param {object} [params] The params for the call. If none of the params are set, all limits for all platforms are returned.
   * @returns {Promise<GetRateLimitsResponse>}
   */
  async getRateLimits(params?: {
    android?: boolean;
    endpoints?: EndpointName[];
    ios?: boolean;
    serverSide?: boolean;
    web?: boolean;
  }) {
    const { serverSide, web, android, ios, endpoints } = params || {};
    return this.get<GetRateLimitsResponse>(this.baseURL + '/rate_limits', {
      server_side: serverSide,
      web,
      android,
      ios,
      endpoints: endpoints ? endpoints.join(',') : undefined,
    });
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
    if (!this.userID && !this._isUsingServerAuth()) {
      throw Error('Call connectUser or connectAnonymousUser before creating a channel');
    }

    if (~channelType.indexOf(':')) {
      throw Error(`Invalid channel group ${channelType}, can't contain the : character`);
    }

    // support channel("messaging", {options})
    if (channelIDOrCustom && typeof channelIDOrCustom === 'object') {
      return this.getChannel(channelType, channelIDOrCustom);
    }

    // // support channel("messaging", undefined, {options})
    if (!channelIDOrCustom && typeof custom === 'object' && custom.members?.length) {
      return this.getChannelByMembers(channelType, custom);
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
   * It's a helper method for `client.channel()` method, used to create unique conversation or
   * channel based on member list instead of id.
   *
   * If the channel already exists in `activeChannels` list, then we simply return it, since that
   * means the same channel was already requested or created.
   *
   * Otherwise we create a new instance of Channel class and return it.
   *
   * @private
   *
   * @param {string} channelType The channel type
   * @param {object} [custom]    Custom data to attach to the channel
   *
   * @return {channel} The channel object, initialize it using channel.watch()
   */
  getChannelByMembers = (channelType: string, custom: ChannelData<ErmisChatGenerics>) => {
    // Check if the channel already exists.
    // Only allow 1 channel object per cid
    const membersStr = [...(custom.members || [])].sort().join(',');
    const tempCid = `${channelType}:!members-${membersStr}`;

    if (!membersStr) {
      throw Error('Please specify atleast one member when creating unique conversation');
    }

    // channel could exist in `activeChannels` list with either one of the following two keys:
    // 1. cid - Which gets set on channel only after calling channel.query or channel.watch or channel.create
    // 2. Sorted membersStr - E.g., "messaging:amin,vishal" OR "messaging:amin,jaap,tom"
    //                        This is set when you create a channel, but haven't queried yet. After query,
    //                        we will replace it with `cid`
    for (const key in this.activeChannels) {
      const channel = this.activeChannels[key];
      if (channel.disconnected) {
        continue;
      }

      if (key === tempCid) {
        return channel;
      }

      if (key.indexOf(`${channelType}:!members-`) === 0) {
        const membersStrInExistingChannel = Object.keys(channel.state.members).sort().join(',');
        if (membersStrInExistingChannel === membersStr) {
          return channel;
        }
      }
    }

    const channel = new Channel<ErmisChatGenerics>(this, channelType, undefined, custom);

    // For the time being set the key as membersStr, since we don't know the cid yet.
    // In channel.query, we will replace it with 'cid'.
    this.activeChannels[tempCid] = channel;
    return channel;
  };

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

  /**
   * partialUpdateUser - Update the given user object
   *
   * @param {PartialUserUpdate<ErmisChatGenerics>} partialUserObject which should contain id and any of "set" or "unset" params;
   * example: {id: "user1", set:{field: value}, unset:["field2"]}
   *
   * @return {Promise<{ users: { [key: string]: UserResponse<ErmisChatGenerics> } }>} list of updated users
   */
  async partialUpdateUser(partialUserObject: PartialUserUpdate<ErmisChatGenerics>) {
    return await this.partialUpdateUsers([partialUserObject]);
  }

  /**
   * upsertUsers - Batch upsert the list of users
   *
   * @param {UserResponse<ErmisChatGenerics>[]} users list of users
   *
   * @return {Promise<{ users: { [key: string]: UserResponse<ErmisChatGenerics> } }>}
   */
  async upsertUsers(users: UserResponse<ErmisChatGenerics>[]) {
    const userMap: { [key: string]: UserResponse<ErmisChatGenerics> } = {};
    for (const userObject of users) {
      if (!userObject.id) {
        throw Error('User ID is required when updating a user');
      }
      userMap[userObject.id] = userObject;
    }

    return await this.post<
      APIResponse & {
        users: { [key: string]: UserResponse<ErmisChatGenerics> };
      }
    >(this.baseURL + '/users', { users: userMap });
  }

  /**
   * @deprecated Please use upsertUsers() function instead.
   *
   * updateUsers - Batch update the list of users
   *
   * @param {UserResponse<ErmisChatGenerics>[]} users list of users
   * @return {Promise<{ users: { [key: string]: UserResponse<ErmisChatGenerics> } }>}
   */
  updateUsers = this.upsertUsers;

  /**
   * upsertUser - Update or Create the given user object
   *
   * @param {UserResponse<ErmisChatGenerics>} userObject user object, the only required field is the user id. IE {id: "myuser"} is valid
   *
   * @return {Promise<{ users: { [key: string]: UserResponse<ErmisChatGenerics> } }>}
   */
  upsertUser(userObject: UserResponse<ErmisChatGenerics>) {
    return this.upsertUsers([userObject]);
  }

  /**
   * @deprecated Please use upsertUser() function instead.
   *
   * updateUser - Update or Create the given user object
   *
   * @param {UserResponse<ErmisChatGenerics>} userObject user object, the only required field is the user id. IE {id: "myuser"} is valid
   * @return {Promise<{ users: { [key: string]: UserResponse<ErmisChatGenerics> } }>}
   */
  updateUser = this.upsertUser;

  /**
   * partialUpdateUsers - Batch partial update of users
   *
   * @param {PartialUserUpdate<ErmisChatGenerics>[]} users list of partial update requests
   *
   * @return {Promise<{ users: { [key: string]: UserResponse<ErmisChatGenerics> } }>}
   */
  async partialUpdateUsers(users: PartialUserUpdate<ErmisChatGenerics>[]) {
    for (const userObject of users) {
      if (!userObject.id) {
        throw Error('User ID is required when updating a user');
      }
    }

    return await this.patch<
      APIResponse & {
        users: { [key: string]: UserResponse<ErmisChatGenerics> };
      }
    >(this.baseURL + '/users', { users });
  }

  async deleteUser(
    userID: string,
    params?: {
      delete_conversation_channels?: boolean;
      hard_delete?: boolean;
      mark_messages_deleted?: boolean;
    },
  ) {
    return await this.delete<
      APIResponse & { user: UserResponse<ErmisChatGenerics> } & {
        task_id?: string;
      }
    >(this.baseURL + `/users/${userID}`, params);
  }

  /**
   * restoreUsers - Restore soft deleted users
   *
   * @param {string[]} user_ids which users to restore
   *
   * @return {APIResponse} An API response
   */
  async restoreUsers(user_ids: string[]) {
    return await this.post<APIResponse>(this.baseURL + `/users/restore`, {
      user_ids,
    });
  }

  /**
   * reactivateUser - Reactivate one user
   *
   * @param {string} userID which user to reactivate
   * @param {ReactivateUserOptions} [options]
   *
   * @return {UserResponse} Reactivated user
   */
  async reactivateUser(userID: string, options?: ReactivateUserOptions) {
    return await this.post<APIResponse & { user: UserResponse<ErmisChatGenerics> }>(
      this.baseURL + `/users/${userID}/reactivate`,
      { ...options },
    );
  }

  /**
   * reactivateUsers - Reactivate many users asynchronously
   *
   * @param {string[]} user_ids which users to reactivate
   * @param {ReactivateUsersOptions} [options]
   *
   * @return {TaskResponse} A task ID
   */
  async reactivateUsers(user_ids: string[], options?: ReactivateUsersOptions) {
    return await this.post<APIResponse & TaskResponse>(this.baseURL + `/users/reactivate`, { user_ids, ...options });
  }

  /**
   * deactivateUser - Deactivate one user
   *
   * @param {string} userID which user to deactivate
   * @param {DeactivateUsersOptions} [options]
   *
   * @return {UserResponse} Deactivated user
   */
  async deactivateUser(userID: string, options?: DeactivateUsersOptions) {
    return await this.post<APIResponse & { user: UserResponse<ErmisChatGenerics> }>(
      this.baseURL + `/users/${userID}/deactivate`,
      { ...options },
    );
  }

  /**
   * deactivateUsers - Deactivate many users asynchronously
   *
   * @param {string[]} user_ids which users to deactivate
   * @param {DeactivateUsersOptions} [options]
   *
   * @return {TaskResponse} A task ID
   */
  async deactivateUsers(user_ids: string[], options?: DeactivateUsersOptions) {
    return await this.post<APIResponse & TaskResponse>(this.baseURL + `/users/deactivate`, { user_ids, ...options });
  }

  async exportUser(userID: string, options?: Record<string, string>) {
    return await this.get<
      APIResponse & {
        messages: MessageResponse<ErmisChatGenerics>[];
        reactions: ReactionResponse<ErmisChatGenerics>[];
        user: UserResponse<ErmisChatGenerics>;
      }
    >(this.baseURL + `/users/${userID}/export`, { ...options });
  }

  /** banUser - bans a user from all channels
   *
   * @param {string} targetUserID
   * @param {BanUserOptions<ErmisChatGenerics>} [options]
   * @returns {Promise<APIResponse>}
   */
  async banUser(targetUserID: string, options?: BanUserOptions<ErmisChatGenerics>) {
    return await this.post<APIResponse>(this.baseURL + '/moderation/ban', {
      target_user_id: targetUserID,
      ...options,
    });
  }

  /** unbanUser - revoke global ban for a user
   *
   * @param {string} targetUserID
   * @param {UnBanUserOptions} [options]
   * @returns {Promise<APIResponse>}
   */
  async unbanUser(targetUserID: string, options?: UnBanUserOptions) {
    return await this.delete<APIResponse>(this.baseURL + '/moderation/ban', {
      target_user_id: targetUserID,
      ...options,
    });
  }

  /** shadowBan - shadow bans a user from all channels
   *
   * @param {string} targetUserID
   * @param {BanUserOptions<ErmisChatGenerics>} [options]
   * @returns {Promise<APIResponse>}
   */
  async shadowBan(targetUserID: string, options?: BanUserOptions<ErmisChatGenerics>) {
    return await this.banUser(targetUserID, {
      shadow: true,
      ...options,
    });
  }

  /** removeShadowBan - revoke global shadow ban for a user
   *
   * @param {string} targetUserID
   * @param {UnBanUserOptions} [options]
   * @returns {Promise<APIResponse>}
   */
  async removeShadowBan(targetUserID: string, options?: UnBanUserOptions) {
    return await this.unbanUser(targetUserID, {
      shadow: true,
      ...options,
    });
  }

  /** muteUser - mutes a user
   *
   * @param {string} targetID
   * @param {string} [userID] Only used with serverside auth
   * @param {MuteUserOptions<ErmisChatGenerics>} [options]
   * @returns {Promise<MuteUserResponse<ErmisChatGenerics>>}
   */
  async muteUser(targetID: string, userID?: string, options: MuteUserOptions<ErmisChatGenerics> = {}) {
    return await this.post<MuteUserResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/mute', {
      target_id: targetID,
      ...(userID ? { user_id: userID } : {}),
      ...options,
    });
  }

  /** unmuteUser - unmutes a user
   *
   * @param {string} targetID
   * @param {string} [currentUserID] Only used with serverside auth
   * @returns {Promise<APIResponse>}
   */
  async unmuteUser(targetID: string, currentUserID?: string) {
    return await this.post<APIResponse>(this.baseURL + '/moderation/unmute', {
      target_id: targetID,
      ...(currentUserID ? { user_id: currentUserID } : {}),
    });
  }

  /** userMuteStatus - check if a user is muted or not, can be used after connectUser() is called
   *
   * @param {string} targetID
   * @returns {boolean}
   */
  userMuteStatus(targetID: string) {
    if (!this.user || !this.wsPromise) {
      throw new Error('Make sure to await connectUser() first.');
    }

    for (let i = 0; i < this.mutedUsers.length; i += 1) {
      if (this.mutedUsers[i].target.id === targetID) return true;
    }
    return false;
  }

  /**
   * flagMessage - flag a message
   * @param {string} targetMessageID
   * @param {string} [options.user_id] currentUserID, only used with serverside auth
   * @returns {Promise<APIResponse>}
   */
  async flagMessage(targetMessageID: string, options: { user_id?: string } = {}) {
    return await this.post<FlagMessageResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/flag', {
      target_message_id: targetMessageID,
      ...options,
    });
  }

  /**
   * flagUser - flag a user
   * @param {string} targetID
   * @param {string} [options.user_id] currentUserID, only used with serverside auth
   * @returns {Promise<APIResponse>}
   */
  async flagUser(targetID: string, options: { user_id?: string } = {}) {
    return await this.post<FlagUserResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/flag', {
      target_user_id: targetID,
      ...options,
    });
  }

  /**
   * unflagMessage - unflag a message
   * @param {string} targetMessageID
   * @param {string} [options.user_id] currentUserID, only used with serverside auth
   * @returns {Promise<APIResponse>}
   */
  async unflagMessage(targetMessageID: string, options: { user_id?: string } = {}) {
    return await this.post<FlagMessageResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/unflag', {
      target_message_id: targetMessageID,
      ...options,
    });
  }

  /**
   * unflagUser - unflag a user
   * @param {string} targetID
   * @param {string} [options.user_id] currentUserID, only used with serverside auth
   * @returns {Promise<APIResponse>}
   */
  async unflagUser(targetID: string, options: { user_id?: string } = {}) {
    return await this.post<FlagUserResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/unflag', {
      target_user_id: targetID,
      ...options,
    });
  }

  /**
   * getCallToken - retrieves the auth token needed to join a call
   *
   * @param {string} callID
   * @param {object} options
   * @returns {Promise<GetCallTokenResponse>}
   */
  async getCallToken(callID: string, options: { user_id?: string } = {}) {
    return await this.post<GetCallTokenResponse>(this.baseURL + `/calls/${callID}`, { ...options });
  }

  /**
   * _queryFlags - Query flags.
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {FlagsFilters} filterConditions MongoDB style filter conditions
   * @param {FlagsPaginationOptions} options Option object, {limit: 10, offset:0}
   *
   * @return {Promise<FlagsResponse<ErmisChatGenerics>>} Flags Response
   */
  async _queryFlags(filterConditions: FlagsFilters = {}, options: FlagsPaginationOptions = {}) {
    // Return a list of flags
    return await this.post<FlagsResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/flags', {
      filter_conditions: filterConditions,
      ...options,
    });
  }

  /**
   * _queryFlagReports - Query flag reports.
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {FlagReportsFilters} filterConditions MongoDB style filter conditions
   * @param {FlagReportsPaginationOptions} options Option object, {limit: 10, offset:0}
   *
   * @return {Promise<FlagReportsResponse<ErmisChatGenerics>>} Flag Reports Response
   */
  async _queryFlagReports(filterConditions: FlagReportsFilters = {}, options: FlagReportsPaginationOptions = {}) {
    // Return a list of message flags
    return await this.post<FlagReportsResponse<ErmisChatGenerics>>(this.baseURL + '/moderation/reports', {
      filter_conditions: filterConditions,
      ...options,
    });
  }

  /**
   * _reviewFlagReport - review flag report
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {string} [id] flag report to review
   * @param {string} [reviewResult] flag report review result
   * @param {string} [options.user_id] currentUserID, only used with serverside auth
   * @param {string} [options.review_details] custom information about review result
   * @returns {Promise<ReviewFlagReportResponse>>}
   */
  async _reviewFlagReport(id: string, reviewResult: string, options: ReviewFlagReportOptions = {}) {
    return await this.patch<ReviewFlagReportResponse<ErmisChatGenerics>>(this.baseURL + `/moderation/reports/${id}`, {
      review_result: reviewResult,
      ...options,
    });
  }

  /**
   * unblockMessage - unblocks message blocked by automod
   *
   *
   * @param {string} targetMessageID
   * @param {string} [options.user_id] currentUserID, only used with serverside auth
   * @returns {Promise<APIResponse>}
   */
  async unblockMessage(targetMessageID: string, options: { user_id?: string } = {}) {
    return await this.post<APIResponse>(this.baseURL + '/moderation/unblock_message', {
      target_message_id: targetMessageID,
      ...options,
    });
  }
  // alias for backwards compatibility
  _unblockMessage = this.unblockMessage;

  /**
   * @deprecated use markChannelsRead instead
   *
   * markAllRead - marks all channels for this user as read
   * @param {MarkAllReadOptions<ErmisChatGenerics>} [data]
   *
   * @return {Promise<APIResponse>}
   */
  markAllRead = this.markChannelsRead;

  /**
   * markChannelsRead - marks channels read -
   * it accepts a map of cid:messageid pairs, if messageid is empty, the whole channel will be marked as read
   *
   * @param {MarkChannelsReadOptions <ErmisChatGenerics>} [data]
   *
   * @return {Promise<APIResponse>}
   */
  async markChannelsRead(data: MarkChannelsReadOptions<ErmisChatGenerics> = {}) {
    await this.post<APIResponse>(this.baseURL + '/channels/read', { ...data });
  }

  createCommand(data: CreateCommandOptions<ErmisChatGenerics>) {
    return this.post<CreateCommandResponse<ErmisChatGenerics>>(this.baseURL + '/commands', data);
  }

  getCommand(name: string) {
    return this.get<GetCommandResponse<ErmisChatGenerics>>(this.baseURL + `/commands/${name}`);
  }

  updateCommand(name: string, data: UpdateCommandOptions<ErmisChatGenerics>) {
    return this.put<UpdateCommandResponse<ErmisChatGenerics>>(this.baseURL + `/commands/${name}`, data);
  }

  deleteCommand(name: string) {
    return this.delete<DeleteCommandResponse<ErmisChatGenerics>>(this.baseURL + `/commands/${name}`);
  }

  listCommands() {
    return this.get<ListCommandsResponse<ErmisChatGenerics>>(this.baseURL + `/commands`);
  }

  createChannelType(data: CreateChannelOptions<ErmisChatGenerics>) {
    const channelData = Object.assign({}, { commands: ['all'] }, data);
    return this.post<CreateChannelResponse<ErmisChatGenerics>>(this.baseURL + '/channeltypes', channelData);
  }

  getChannelType(channelType: string) {
    return this.get<GetChannelTypeResponse<ErmisChatGenerics>>(this.baseURL + `/channeltypes/${channelType}`);
  }

  updateChannelType(channelType: string, data: UpdateChannelOptions<ErmisChatGenerics>) {
    return this.put<UpdateChannelResponse<ErmisChatGenerics>>(this.baseURL + `/channeltypes/${channelType}`, data);
  }

  deleteChannelType(channelType: string) {
    return this.delete<APIResponse>(this.baseURL + `/channeltypes/${channelType}`);
  }

  listChannelTypes() {
    return this.get<ListChannelResponse<ErmisChatGenerics>>(this.baseURL + `/channeltypes`);
  }

  /**
   * translateMessage - adds the translation to the message
   *
   * @param {string} messageId
   * @param {string} language
   *
   * @return {MessageResponse<ErmisChatGenerics>} Response that includes the message
   */
  async translateMessage(messageId: string, language: string) {
    return await this.post<APIResponse & MessageResponse<ErmisChatGenerics>>(
      this.baseURL + `/messages/${messageId}/translate`,
      { language },
    );
  }

  /**
   * _normalizeExpiration - transforms expiration value into ISO string
   * @param {undefined|null|number|string|Date} timeoutOrExpirationDate expiration date or timeout. Use number type to set timeout in seconds, string or Date to set exact expiration date
   */
  _normalizeExpiration(timeoutOrExpirationDate?: null | number | string | Date) {
    let pinExpires: null | string = null;
    if (typeof timeoutOrExpirationDate === 'number') {
      const now = new Date();
      now.setSeconds(now.getSeconds() + timeoutOrExpirationDate);
      pinExpires = now.toISOString();
    } else if (isString(timeoutOrExpirationDate)) {
      pinExpires = timeoutOrExpirationDate;
    } else if (timeoutOrExpirationDate instanceof Date) {
      pinExpires = timeoutOrExpirationDate.toISOString();
    }
    return pinExpires;
  }

  /**
   * _messageId - extracts string message id from either message object or message id
   * @param {string | { id: string }} messageOrMessageId message object or message id
   * @param {string} errorText error message to report in case of message id absence
   */
  _validateAndGetMessageId(messageOrMessageId: string | { id: string }, errorText: string) {
    let messageId: string;
    if (typeof messageOrMessageId === 'string') {
      messageId = messageOrMessageId;
    } else {
      if (!messageOrMessageId.id) {
        throw Error(errorText);
      }
      messageId = messageOrMessageId.id;
    }
    return messageId;
  }

  /**
   * pinMessage - pins the message
   * @param {string | { id: string }} messageOrMessageId message object or message id
   * @param {undefined|null|number|string|Date} timeoutOrExpirationDate expiration date or timeout. Use number type to set timeout in seconds, string or Date to set exact expiration date
   * @param {undefined|string | { id: string }} [pinnedBy] who will appear as a user who pinned a message. Only for server-side use. Provide `undefined` when pinning message client-side
   * @param {undefined|number|string|Date} pinnedAt date when message should be pinned. It affects the order of pinned messages. Use negative number to set relative time in the past, string or Date to set exact date of pin
   */
  pinMessage(
    messageOrMessageId: string | { id: string },
    timeoutOrExpirationDate?: null | number | string | Date,
    pinnedBy?: string | { id: string },
    pinnedAt?: number | string | Date,
  ) {
    const messageId = this._validateAndGetMessageId(
      messageOrMessageId,
      'Please specify the message id when calling unpinMessage',
    );
    return this.partialUpdateMessage(
      messageId,
      ({
        set: {
          pinned: true,
          pin_expires: this._normalizeExpiration(timeoutOrExpirationDate),
          pinned_at: this._normalizeExpiration(pinnedAt),
        },
      } as unknown) as PartialMessageUpdate<ErmisChatGenerics>,
      pinnedBy,
    );
  }

  /**
   * unpinMessage - unpins the message that was previously pinned
   * @param {string | { id: string }} messageOrMessageId message object or message id
   * @param {string | { id: string }} [userId]
   */
  unpinMessage(messageOrMessageId: string | { id: string }, userId?: string | { id: string }) {
    const messageId = this._validateAndGetMessageId(
      messageOrMessageId,
      'Please specify the message id when calling unpinMessage',
    );
    return this.partialUpdateMessage(
      messageId,
      ({
        set: { pinned: false },
      } as unknown) as PartialMessageUpdate<ErmisChatGenerics>,
      userId,
    );
  }

  /**
   * updateMessage - Update the given message
   *
   * @param {Omit<MessageResponse<ErmisChatGenerics>, 'mentioned_users'> & { mentioned_users?: string[] }} message object, id needs to be specified
   * @param {string | { id: string }} [userId]
   * @param {boolean} [options.skip_enrich_url] Do not try to enrich the URLs within message
   *
   * @return {{ message: MessageResponse<ErmisChatGenerics> }} Response that includes the message
   */
  async updateMessage(
    message: UpdatedMessage<ErmisChatGenerics>,
    userId?: string | { id: string },
    options?: UpdateMessageOptions,
  ) {
    if (!message.id) {
      throw Error('Please specify the message id when calling updateMessage');
    }

    const clonedMessage: Message = Object.assign({}, message);
    delete clonedMessage.id;

    const reservedMessageFields: Array<ReservedMessageFields> = [
      'command',
      'created_at',
      'html',
      'latest_reactions',
      'own_reactions',
      'quoted_message',
      'reaction_counts',
      'reply_count',
      'type',
      'updated_at',
      'user',
      '__html',
    ];

    reservedMessageFields.forEach(function (item) {
      if (clonedMessage[item] != null) {
        delete clonedMessage[item];
      }
    });

    if (userId != null) {
      if (isString(userId)) {
        clonedMessage.user_id = userId;
      } else {
        clonedMessage.user = {
          id: userId.id,
        } as UserResponse<ErmisChatGenerics>;
      }
    }

    /**
     * Server always expects mentioned_users to be array of string. We are adding extra check, just in case
     * SDK missed this conversion.
     */
    if (Array.isArray(clonedMessage.mentioned_users) && !isString(clonedMessage.mentioned_users[0])) {
      clonedMessage.mentioned_users = clonedMessage.mentioned_users.map((mu) => ((mu as unknown) as UserResponse).id);
    }

    return await this.post<UpdateMessageAPIResponse<ErmisChatGenerics>>(this.baseURL + `/messages/${message.id}`, {
      message: clonedMessage,
      ...options,
    });
  }

  /**
   * partialUpdateMessage - Update the given message id while retaining additional properties
   *
   * @param {string} id the message id
   *
   * @param {PartialUpdateMessage<ErmisChatGenerics>}  partialMessageObject which should contain id and any of "set" or "unset" params;
   *         example: {id: "user1", set:{text: "hi"}, unset:["color"]}
   * @param {string | { id: string }} [userId]
   *
   * @param {boolean} [options.skip_enrich_url] Do not try to enrich the URLs within message
   *
   * @return {{ message: MessageResponse<ErmisChatGenerics> }} Response that includes the updated message
   */
  async partialUpdateMessage(
    id: string,
    partialMessageObject: PartialMessageUpdate<ErmisChatGenerics>,
    userId?: string | { id: string },
    options?: UpdateMessageOptions,
  ) {
    if (!id) {
      throw Error('Please specify the message id when calling partialUpdateMessage');
    }
    let user = userId;
    if (userId != null && isString(userId)) {
      user = { id: userId };
    }
    return await this.put<UpdateMessageAPIResponse<ErmisChatGenerics>>(this.baseURL + `/messages/${id}`, {
      ...partialMessageObject,
      ...options,
      user,
    });
  }

  async deleteMessage(messageID: string, hardDelete?: boolean) {
    let params = {};
    if (hardDelete) {
      params = { hard: true };
    }
    return await this.delete<APIResponse & { message: MessageResponse<ErmisChatGenerics> }>(
      this.baseURL + `/messages/${messageID}`,
      params,
    );
  }

  /**
   * undeleteMessage - Undelete a message
   *
   * undeletes a message that was previous soft deleted. Hard deleted messages
   * cannot be undeleted. This is only allowed to be called from server-side
   * clients.
   *
   * @param {string} messageID The id of the message to undelete
   * @param {string} userID The id of the user who undeleted the message
   *
   * @return {{ message: MessageResponse<ErmisChatGenerics> }} Response that includes the message
   */
  async undeleteMessage(messageID: string, userID: string) {
    return await this.post<APIResponse & { message: MessageResponse<ErmisChatGenerics> }>(
      this.baseURL + `/messages/${messageID}/undelete`,
      { undeleted_by: userID },
    );
  }

  async getMessage(messageID: string, options?: GetMessageOptions) {
    return await this.get<GetMessageAPIResponse<ErmisChatGenerics>>(
      this.baseURL + `/messages/${encodeURIComponent(messageID)}`,
      { ...options },
    );
  }

  /**
   * queryThreads - returns the list of threads of current user.
   *
   * @param {QueryThreadsOptions} options Options object for pagination and limiting the participants and replies.
   * @param {number}  options.limit Limits the number of threads to be returned.
   * @param {boolean} options.watch Subscribes the user to the channels of the threads.
   * @param {number}  options.participant_limit Limits the number of participants returned per threads.
   * @param {number}  options.reply_limit Limits the number of replies returned per threads.
   *
   * @returns {{ threads: Thread<ErmisChatGenerics>[], next: string }} Returns the list of threads and the next cursor.
   */
  async queryThreads(options?: QueryThreadsOptions) {
    const opts = {
      limit: 10,
      participant_limit: 10,
      reply_limit: 3,
      watch: true,
      ...options,
    };

    const res = await this.post<QueryThreadsAPIResponse<ErmisChatGenerics>>(this.baseURL + `/threads`, opts);

    return {
      threads: res.threads.map((thread) => new Thread(this, thread)),
      next: res.next,
    };
  }

  /**
   * getThread - returns the thread of a message by its id.
   *
   * @param {string}            messageId The message id
   * @param {GetThreadOptions}  options Options object for pagination and limiting the participants and replies.
   * @param {boolean}           options.watch Subscribes the user to the channel of the thread.
   * @param {number}            options.participant_limit Limits the number of participants returned per threads.
   * @param {number}            options.reply_limit Limits the number of replies returned per threads.
   *
   * @returns {Thread<ErmisChatGenerics>} Returns the thread.
   */
  async getThread(messageId: string, options: GetThreadOptions = {}) {
    if (!messageId) {
      throw Error('Please specify the message id when calling partialUpdateThread');
    }

    const opts = {
      participant_limit: 100,
      reply_limit: 3,
      watch: true,
      ...options,
    };

    const res = await this.get<GetThreadAPIResponse<ErmisChatGenerics>>(this.baseURL + `/threads/${messageId}`, opts);

    return new Thread<ErmisChatGenerics>(this, res.thread);
  }

  /**
   * partialUpdateThread - updates the given thread
   *
   * @param {string}              messageId The id of the thread message which needs to be updated.
   * @param {PartialThreadUpdate} partialThreadObject should contain "set" or "unset" params for any of the thread's non-reserved fields.
   *
   * @returns {GetThreadAPIResponse<ErmisChatGenerics>} Returns the updated thread.
   */
  async partialUpdateThread(messageId: string, partialThreadObject: PartialThreadUpdate) {
    if (!messageId) {
      throw Error('Please specify the message id when calling partialUpdateThread');
    }

    // check for reserved fields from ThreadResponse type within partialThreadObject's set and unset.
    // Throw error if any of the reserved field is found.
    const reservedThreadFields = [
      'created_at',
      'id',
      'last_message_at',
      'type',
      'updated_at',
      'user',
      'reply_count',
      'participants',
      'channel',
    ];

    for (const key in { ...partialThreadObject.set, ...partialThreadObject.unset }) {
      if (reservedThreadFields.includes(key)) {
        throw Error(
          `You cannot set ${key} field on Thread object. ${key} is reserved for server-side use. Please omit ${key} from your set object.`,
        );
      }
    }

    return await this.patch<GetThreadAPIResponse<ErmisChatGenerics>>(
      this.baseURL + `/threads/${messageId}`,
      partialThreadObject,
    );
  }

  getUserAgent() {
    return (
      this.userAgent || `ermis-chat-sdk-javascript-client-${this.node ? 'node' : 'browser'}-${process.env.PKG_VERSION}`
    );
  }

  setUserAgent(userAgent: string) {
    this.userAgent = userAgent;
  }

  /**
   * _isUsingServerAuth - Returns true if we're using server side auth
   */
  _isUsingServerAuth = () => !!this.secret;

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
    const { params: axiosRequestConfigParams, headers: axiosRequestConfigHeaders, ...axiosRequestConfigRest } =
      this.options.axiosRequestConfig || {};

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
    if (!this.tokenManager || this.anonymous) return null;

    return this.tokenManager.getToken();
  }

  _startCleaning() {
    const that = this;
    if (this.cleaningIntervalRef != null) {
      return;
    }
    this.cleaningIntervalRef = setInterval(() => {
      // call clean on the channel, used for calling the stop.typing event etc.
      for (const channel of Object.values(that.activeChannels)) {
        channel.clean();
      }
    }, 500);
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

  /**
   * checks signature of a request
   * @param {string | Buffer} rawBody
   * @param {string} signature from HTTP header
   * @returns {boolean}
   */
  // verifyWebhook(requestBody: string | Buffer, xSignature: string) {
  //   return !!this.secret && CheckSignature(requestBody, this.secret, xSignature);
  // }

  /** getPermission - gets the definition for a permission
   *
   * @param {string} name
   * @returns {Promise<PermissionAPIResponse>}
   */
  getPermission(name: string) {
    return this.get<PermissionAPIResponse>(`${this.baseURL}/permissions/${name}`);
  }

  /** createPermission - creates a custom permission
   *
   * @param {CustomPermissionOptions} permissionData the permission data
   * @returns {Promise<APIResponse>}
   */
  createPermission(permissionData: CustomPermissionOptions) {
    return this.post<APIResponse>(`${this.baseURL}/permissions`, {
      ...permissionData,
    });
  }

  /** updatePermission - updates an existing custom permission
   *
   * @param {string} id
   * @param {Omit<CustomPermissionOptions, 'id'>} permissionData the permission data
   * @returns {Promise<APIResponse>}
   */
  updatePermission(id: string, permissionData: Omit<CustomPermissionOptions, 'id'>) {
    return this.put<APIResponse>(`${this.baseURL}/permissions/${id}`, {
      ...permissionData,
    });
  }

  /** deletePermission - deletes a custom permission
   *
   * @param {string} name
   * @returns {Promise<APIResponse>}
   */
  deletePermission(name: string) {
    return this.delete<APIResponse>(`${this.baseURL}/permissions/${name}`);
  }

  /** listPermissions - returns the list of all permissions for this application
   *
   * @returns {Promise<APIResponse>}
   */
  listPermissions() {
    return this.get<PermissionsAPIResponse>(`${this.baseURL}/permissions`);
  }

  /** createRole - creates a custom role
   *
   * @param {string} name the new role name
   * @returns {Promise<APIResponse>}
   */
  createRole(name: string) {
    return this.post<APIResponse>(`${this.baseURL}/roles`, { name });
  }

  /** listRoles - returns the list of all roles for this application
   *
   * @returns {Promise<APIResponse>}
   */
  listRoles() {
    return this.get<APIResponse>(`${this.baseURL}/roles`);
  }

  /** deleteRole - deletes a custom role
   *
   * @param {string} name the role name
   * @returns {Promise<APIResponse>}
   */
  deleteRole(name: string) {
    return this.delete<APIResponse>(`${this.baseURL}/roles/${name}`);
  }

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
   * sendUserCustomEvent - Send a custom event to a user
   *
   * @param {string} targetUserID target user id
   * @param {UserCustomEvent} event for example {type: 'friendship-request'}
   *
   * @return {Promise<APIResponse>} The Server Response
   */
  async sendUserCustomEvent(targetUserID: string, event: UserCustomEvent) {
    return await this.post<APIResponse>(`${this.baseURL}/users/${targetUserID}/event`, {
      event,
    });
  }

  createBlockList(blockList: BlockList) {
    return this.post<APIResponse>(`${this.baseURL}/blocklists`, blockList);
  }

  listBlockLists() {
    return this.get<APIResponse & { blocklists: BlockListResponse[] }>(`${this.baseURL}/blocklists`);
  }

  getBlockList(name: string) {
    return this.get<APIResponse & { blocklist: BlockListResponse }>(`${this.baseURL}/blocklists/${name}`);
  }

  updateBlockList(name: string, data: { words: string[] }) {
    return this.put<APIResponse>(`${this.baseURL}/blocklists/${name}`, data);
  }

  deleteBlockList(name: string) {
    return this.delete<APIResponse>(`${this.baseURL}/blocklists/${name}`);
  }

  exportChannels(request: Array<ExportChannelRequest>, options: ExportChannelOptions = {}) {
    const payload = { channels: request, ...options };
    return this.post<APIResponse & ExportChannelResponse>(`${this.baseURL}/export_channels`, payload);
  }

  exportUsers(request: ExportUsersRequest) {
    return this.post<APIResponse & ExportUsersResponse>(`${this.baseURL}/export/users`, request);
  }

  exportChannel(request: ExportChannelRequest, options?: ExportChannelOptions) {
    return this.exportChannels([request], options);
  }

  getExportChannelStatus(id: string) {
    return this.get<APIResponse & ExportChannelStatusResponse>(`${this.baseURL}/export_channels/${id}`);
  }

  campaign(idOrData: string | CampaignData, data?: CampaignData) {
    if (idOrData && typeof idOrData === 'object') {
      return new Campaign(this, null, idOrData);
    }

    return new Campaign(this, idOrData, data);
  }

  segment(type: SegmentType, idOrData: string | SegmentData, data?: SegmentData) {
    if (typeof idOrData === 'string') {
      return new Segment(this, type, idOrData, data);
    }

    return new Segment(this, type, null, idOrData);
  }

  validateServerSideAuth() {
    if (!this.secret) {
      throw new Error(
        'Campaigns is a server-side only feature. Please initialize the client with a secret to use this feature.',
      );
    }
  }

  /**
   * createSegment - Creates a segment
   *
   * @private
   * @param {SegmentType} type Segment type
   * @param {string} id Segment ID
   * @param {string} name Segment name
   * @param {SegmentData} params Segment data
   *
   * @return {{segment: SegmentResponse} & APIResponse} The created Segment
   */
  async createSegment(type: SegmentType, id: string | null, data?: SegmentData) {
    this.validateServerSideAuth();
    const body = {
      id,
      type,
      ...data,
    };
    return this.post<{ segment: SegmentResponse }>(this.baseURL + `/segments`, body);
  }

  /**
   * createUserSegment - Creates a user segment
   *
   * @param {string} id Segment ID
   * @param {string} name Segment name
   * @param {SegmentData} data Segment data
   *
   * @return {Segment} The created Segment
   */
  async createUserSegment(id: string | null, data?: SegmentData) {
    this.validateServerSideAuth();
    return this.createSegment('user', id, data);
  }

  /**
   * createChannelSegment - Creates a channel segment
   *
   * @param {string} id Segment ID
   * @param {string} name Segment name
   * @param {SegmentData} data Segment data
   *
   * @return {Segment} The created Segment
   */
  async createChannelSegment(id: string | null, data?: SegmentData) {
    this.validateServerSideAuth();
    return this.createSegment('channel', id, data);
  }

  async getSegment(id: string) {
    this.validateServerSideAuth();
    return this.get<{ segment: SegmentResponse } & APIResponse>(this.baseURL + `/segments/${id}`);
  }

  /**
   * updateSegment - Update a segment
   *
   * @param {string} id Segment ID
   * @param {Partial<UpdateSegmentData>} data Data to update
   *
   * @return {Segment} Updated Segment
   */
  async updateSegment(id: string, data: Partial<UpdateSegmentData>) {
    this.validateServerSideAuth();
    return this.put<{ segment: SegmentResponse }>(this.baseURL + `/segments/${id}`, data);
  }

  /**
   * addSegmentTargets - Add targets to a segment
   *
   * @param {string} id Segment ID
   * @param {string[]} targets Targets to add to the segment
   *
   * @return {APIResponse} API response
   */
  async addSegmentTargets(id: string, targets: string[]) {
    this.validateServerSideAuth();
    const body = { target_ids: targets };
    return this.post<APIResponse>(this.baseURL + `/segments/${id}/addtargets`, body);
  }

  async querySegmentTargets(
    id: string,
    filter: QuerySegmentTargetsFilter | null = {},
    sort: SortParam[] | null | [] = [],
    options = {},
  ) {
    this.validateServerSideAuth();
    return this.post<{ targets: SegmentTargetsResponse[]; next?: string } & APIResponse>(
      this.baseURL + `/segments/${id}/targets/query`,
      {
        filter: filter || {},
        sort: sort || [],
        ...options,
      },
    );
  }
  /**
   * removeSegmentTargets - Remove targets from a segment
   *
   * @param {string} id Segment ID
   * @param {string[]} targets Targets to add to the segment
   *
   * @return {APIResponse} API response
   */
  async removeSegmentTargets(id: string, targets: string[]) {
    this.validateServerSideAuth();
    const body = { target_ids: targets };
    return this.post<APIResponse>(this.baseURL + `/segments/${id}/deletetargets`, body);
  }

  /**
   * querySegments - Query Segments
   *
   * @param {filter} filter MongoDB style filter conditions
   * @param {QuerySegmentsOptions} options Options for sorting/paginating the results
   *
   * @return {Segment[]} Segments
   */
  async querySegments(filter: {}, sort?: SortParam[], options: QuerySegmentsOptions = {}) {
    this.validateServerSideAuth();
    return this.post<
      {
        segments: SegmentResponse[];
        next?: string;
        prev?: string;
      } & APIResponse
    >(this.baseURL + `/segments/query`, {
      filter,
      sort,
      ...options,
    });
  }

  /**
   * deleteSegment - Delete a Campaign Segment
   *
   * @param {string} id Segment ID
   *
   * @return {Promise<APIResponse>} The Server Response
   */
  async deleteSegment(id: string) {
    this.validateServerSideAuth();
    return this.delete<APIResponse>(this.baseURL + `/segments/${id}`);
  }

  /**
   * segmentTargetExists - Check if a target exists in a segment
   *
   * @param {string} segmentId Segment ID
   * @param {string} targetId Target ID
   *
   * @return {Promise<APIResponse>} The Server Response
   */
  async segmentTargetExists(segmentId: string, targetId: string) {
    this.validateServerSideAuth();
    return this.get<APIResponse>(this.baseURL + `/segments/${segmentId}/target/${targetId}`);
  }

  /**
   * createCampaign - Creates a Campaign
   *
   * @param {CampaignData} params Campaign data
   *
   * @return {Campaign} The Created Campaign
   */
  async createCampaign(params: CampaignData) {
    this.validateServerSideAuth();
    return this.post<{ campaign: CampaignResponse } & APIResponse>(this.baseURL + `/campaigns`, { ...params });
  }

  async getCampaign(id: string) {
    this.validateServerSideAuth();
    return this.get<{ campaign: CampaignResponse } & APIResponse>(this.baseURL + `/campaigns/${id}`);
  }

  async startCampaign(id: string, options?: { scheduledFor?: string; stopAt?: string }) {
    this.validateServerSideAuth();
    return this.post<{ campaign: CampaignResponse } & APIResponse>(this.baseURL + `/campaigns/${id}/start`, {
      scheduled_for: options?.scheduledFor,
      stop_at: options?.stopAt,
    });
  }
  /**
   * queryCampaigns - Query Campaigns
   *
   *
   * @return {Campaign[]} Campaigns
   */
  async queryCampaigns(filter: CampaignFilters, sort?: CampaignSort, options?: CampaignQueryOptions) {
    this.validateServerSideAuth();
    return await this.post<
      {
        campaigns: CampaignResponse[];
        next?: string;
        prev?: string;
      } & APIResponse
    >(this.baseURL + `/campaigns/query`, {
      filter,
      sort,
      ...(options || {}),
    });
  }

  /**
   * updateCampaign - Update a Campaign
   *
   * @param {string} id Campaign ID
   * @param {Partial<CampaignData>} params Campaign data
   *
   * @return {Campaign} Updated Campaign
   */
  async updateCampaign(id: string, params: Partial<CampaignData>) {
    this.validateServerSideAuth();
    return this.put<{ campaign: CampaignResponse }>(this.baseURL + `/campaigns/${id}`, params);
  }

  /**
   * deleteCampaign - Delete a Campaign
   *
   * @param {string} id Campaign ID
   *
   * @return {Promise<APIResponse>} The Server Response
   */
  async deleteCampaign(id: string) {
    this.validateServerSideAuth();
    return this.delete<APIResponse>(this.baseURL + `/campaigns/${id}`);
  }

  /**
   * stopCampaign - Stop a Campaign
   *
   * @param {string} id Campaign ID
   *
   * @return {Campaign} Stopped Campaign
   */
  async stopCampaign(id: string) {
    this.validateServerSideAuth();
    return this.post<{ campaign: CampaignResponse }>(this.baseURL + `/campaigns/${id}/stop`);
  }

  /**
   * enrichURL - Get OpenGraph data of the given link
   *
   * @param {string} url link
   * @return {OGAttachment} OG Attachment
   */
  async enrichURL(url: string) {
    return this.get<APIResponse & OGAttachment>(this.baseURL + `/og`, { url });
  }

  /**
   * getTask - Gets status of a long running task
   *
   * @param {string} id Task ID
   *
   * @return {TaskStatus} The task status
   */
  async getTask(id: string) {
    return this.get<APIResponse & TaskStatus>(`${this.baseURL}/tasks/${id}`);
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

  /**
   * deleteUsers - Batch Delete Users
   *
   * @param {string[]} user_ids which users to delete
   * @param {DeleteUserOptions} options Configuration how to delete users
   *
   * @return {TaskResponse} A task ID
   */
  async deleteUsers(user_ids: string[], options: DeleteUserOptions = {}) {
    if (typeof options.user !== 'undefined' && !['soft', 'hard', 'pruning'].includes(options.user)) {
      throw new Error('Invalid delete user options. user must be one of [soft hard pruning]');
    }
    if (typeof options.conversations !== 'undefined' && !['soft', 'hard'].includes(options.conversations)) {
      throw new Error('Invalid delete user options. conversations must be one of [soft hard]');
    }
    if (typeof options.messages !== 'undefined' && !['soft', 'hard', 'pruning'].includes(options.messages)) {
      throw new Error('Invalid delete user options. messages must be one of [soft hard pruning]');
    }
    return await this.post<APIResponse & TaskResponse>(this.baseURL + `/users/delete`, {
      user_ids,
      ...options,
    });
  }

  /**
   * _createImportURL - Create an Import upload url.
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {string} filename filename of uploaded data
   * @return {APIResponse & CreateImportResponse} An ImportTask
   */
  async _createImportURL(filename: string) {
    return await this.post<APIResponse & CreateImportURLResponse>(this.baseURL + `/import_urls`, {
      filename,
    });
  }

  /**
   * _createImport - Create an Import Task.
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {string} path path of uploaded data
   * @param {CreateImportOptions} options import options
   * @return {APIResponse & CreateImportResponse} An ImportTask
   */
  async _createImport(path: string, options: CreateImportOptions = { mode: 'upsert' }) {
    return await this.post<APIResponse & CreateImportResponse>(this.baseURL + `/imports`, {
      path,
      ...options,
    });
  }

  /**
   * _getImport - Get an Import Task.
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {string} id id of Import Task
   *
   * @return {APIResponse & GetImportResponse} An ImportTask
   */
  async _getImport(id: string) {
    return await this.get<APIResponse & GetImportResponse>(this.baseURL + `/imports/${id}`);
  }

  /**
   * _listImports - Lists Import Tasks.
   *
   * Note: Do not use this.
   * It is present for internal usage only.
   * This function can, and will, break and/or be removed at any point in time.
   *
   * @private
   * @param {ListImportsPaginationOptions} options pagination options
   *
   * @return {APIResponse & ListImportsResponse} An ImportTask
   */
  async _listImports(options: ListImportsPaginationOptions) {
    return await this.get<APIResponse & ListImportsResponse>(this.baseURL + `/imports`, options);
  }

  /**
   * upsertPushProvider - Create or Update a push provider
   *
   * Note: Works only for v2 push version is enabled on app settings.
   *
   * @param {PushProviderConfig} configuration of the provider you want to create or update
   *
   * @return {APIResponse & PushProviderUpsertResponse} A push provider
   */
  async upsertPushProvider(pushProvider: PushProviderConfig) {
    return await this.post<APIResponse & PushProviderUpsertResponse>(this.baseURL + `/push_providers`, {
      push_provider: pushProvider,
    });
  }

  /**
   * deletePushProvider - Delete a push provider
   *
   * Note: Works only for v2 push version is enabled on app settings.
   *
   * @param {PushProviderID} type and foreign id of the push provider to be deleted
   *
   * @return {APIResponse} An API response
   */
  async deletePushProvider({ type, name }: PushProviderID) {
    return await this.delete<APIResponse>(this.baseURL + `/push_providers/${type}/${name}`);
  }

  /**
   * listPushProviders - Get all push providers in the app
   *
   * Note: Works only for v2 push version is enabled on app settings.
   *
   * @return {APIResponse & PushProviderListResponse} A push provider
   */
  async listPushProviders() {
    return await this.get<APIResponse & PushProviderListResponse>(this.baseURL + `/push_providers`);
  }

  /**
   * creates an abort controller that will be used by the next HTTP Request.
   */
  createAbortControllerForNextRequest() {
    return (this.nextRequestAbortController = new AbortController());
  }

  /**
   * commits a pending message, making it visible in the channel and for other users
   * @param id the message id
   *
   * @return {APIResponse & MessageResponse} The message
   */
  async commitMessage(id: string) {
    return await this.post<APIResponse & MessageResponse>(this.baseURL + `/messages/${id}/commit`);
  }

  /**
   * Creates a poll
   * @param params PollData The poll that will be created
   * @returns {APIResponse & CreatePollAPIResponse} The poll
   */
  async createPoll(poll: PollData) {
    return await this.post<APIResponse & CreatePollAPIResponse>(this.baseURL + `/polls`, poll);
  }

  /**
   * Retrieves a poll
   * @param id string The poll id
   * @returns {APIResponse & GetPollAPIResponse} The poll
   */
  async getPoll(id: string, userId?: string): Promise<APIResponse & GetPollAPIResponse> {
    return await this.get<APIResponse & GetPollAPIResponse>(this.baseURL + `/polls/${id}`, {
      ...(userId ? { user_id: userId } : {}),
    });
  }

  /**
   * Updates a poll
   * @param poll PollData The poll that will be updated
   * @returns {APIResponse & PollResponse} The poll
   */
  async updatePoll(poll: PollData) {
    return await this.put<APIResponse & UpdatePollAPIResponse>(this.baseURL + `/polls`, poll);
  }

  /**
   * Partially updates a poll
   * @param id string The poll id
   * @param {PartialPollUpdate<ErmisChatGenerics>} partialPollObject which should contain id and any of "set" or "unset" params;
   * example: {id: "44f26af5-f2be-4fa7-9dac-71cf893781de", set:{field: value}, unset:["field2"]}
   * @returns {APIResponse & UpdatePollAPIResponse} The poll
   */
  async partialUpdatePoll(
    id: string,
    partialPollObject: PartialPollUpdate,
  ): Promise<APIResponse & UpdatePollAPIResponse> {
    return await this.patch<APIResponse & UpdatePollAPIResponse>(this.baseURL + `/polls/${id}`, partialPollObject);
  }

  /**
   * Delete a poll
   * @param id string The poll id
   * @param userId string The user id (only serverside)
   * @returns
   */
  async deletePoll(id: string, userId?: string): Promise<APIResponse> {
    return await this.delete<APIResponse>(this.baseURL + `/polls/${id}`, {
      ...(userId ? { user_id: userId } : {}),
    });
  }

  /**
   * Close a poll
   * @param id string The poll id
   * @returns {APIResponse & UpdatePollAPIResponse} The poll
   */
  async closePoll(id: string): Promise<APIResponse & UpdatePollAPIResponse> {
    return this.partialUpdatePoll(id, {
      set: {
        is_closed: true,
      },
    });
  }

  /**
   * Creates a poll option
   * @param pollId string The poll id
   * @param option PollOptionData The poll option that will be created
   * @returns {APIResponse & PollOptionResponse} The poll option
   */
  async createPollOption(pollId: string, option: PollOptionData) {
    return await this.post<APIResponse & CreatePollOptionAPIResponse>(
      this.baseURL + `/polls/${pollId}/options`,
      option,
    );
  }

  /**
   * Retrieves a poll option
   * @param pollId string The poll id
   * @param optionId string The poll option id
   * @returns {APIResponse & PollOptionResponse} The poll option
   */
  async getPollOption(pollId: string, optionId: string) {
    return await this.get<APIResponse & GetPollOptionAPIResponse>(
      this.baseURL + `/polls/${pollId}/options/${optionId}`,
    );
  }

  /**
   * Updates a poll option
   * @param pollId string The poll id
   * @param option PollOptionData The poll option that will be updated
   * @returns
   */
  async updatePollOption(pollId: string, option: PollOptionData) {
    return await this.put<APIResponse & UpdatePollOptionAPIResponse>(this.baseURL + `/polls/${pollId}/options`, option);
  }

  /**
   * Delete a poll option
   * @param pollId string The poll id
   * @param optionId string The poll option id
   * @returns {APIResponse} The poll option
   */
  async deletePollOption(pollId: string, optionId: string) {
    return await this.delete<APIResponse>(this.baseURL + `/polls/${pollId}/options/${optionId}`);
  }

  /**
   * Cast vote on a poll
   * @param messageId string The message id
   * @param pollId string The poll id
   * @param vote PollVoteData The vote that will be casted
   * @returns {APIResponse & CastVoteAPIResponse} The poll vote
   */
  async castPollVote(messageId: string, pollId: string, vote: PollVoteData, options = {}) {
    return await this.post<APIResponse & CastVoteAPIResponse>(
      this.baseURL + `/messages/${messageId}/polls/${pollId}/vote`,
      { vote, ...options },
    );
  }

  /**
   * Add a poll answer
   * @param messageId string The message id
   * @param pollId string The poll id
   * @param answerText string The answer text
   */
  async addPollAnswer(messageId: string, pollId: string, answerText: string) {
    return this.castPollVote(messageId, pollId, {
      answer_text: answerText,
    });
  }

  async removePollVote(messageId: string, pollId: string, voteId: string) {
    return await this.delete<APIResponse & { vote: PollVote }>(
      this.baseURL + `/messages/${messageId}/polls/${pollId}/vote/${voteId}`,
    );
  }

  /**
   * Queries polls
   * @param filter
   * @param sort
   * @param options Option object, {limit: 10, offset:0}
   * @returns {APIResponse & QueryPollsResponse} The polls
   */
  async queryPolls(
    filter: QueryPollsFilters = {},
    sort: PollSort = [],
    options: QueryPollsOptions = {},
  ): Promise<APIResponse & QueryPollsResponse> {
    return await this.post<APIResponse & QueryPollsResponse>(this.baseURL + '/polls/query', {
      filter,
      sort: normalizeQuerySort(sort),
      ...options,
    });
  }

  /**
   * Queries poll votes
   * @param pollId
   * @param filter
   * @param sort
   * @param options Option object, {limit: 10, offset:0}

   * @returns {APIResponse & PollVotesAPIResponse} The poll votes
   */
  async queryPollVotes(
    pollId: string,
    filter: QueryVotesFilters = {},
    sort: VoteSort = [],
    options: QueryVotesOptions = {},
  ): Promise<APIResponse & PollVotesAPIResponse> {
    return await this.post<APIResponse & PollVotesAPIResponse>(this.baseURL + `/polls/${pollId}/votes`, {
      filter,
      sort: normalizeQuerySort(sort),
      ...options,
    });
  }
}
