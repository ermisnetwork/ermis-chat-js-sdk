/**
 * E2EE (MLS) API methods for Ermis Chat
 *
 * All endpoints are under `/v1/e2ee/` and require JWT auth.
 * WASM module (openmls-wasm) handles the cryptographic operations client-side.
 */

import type { ErmisChat } from './client';
import type { APIResponse, ExtendableGenerics, DefaultGenerics } from './types';

// ============================================================
// Request / Response Types
// ============================================================

export interface UploadKeyPackagesRequest {
  /** TLS-serialized KeyPackage bytes from WASM `keyPackage.to_bytes()` */
  key_packages: number[][];
}

export interface UploadKeyPackagesResponse extends APIResponse {
  stored: number;
  total_remaining: number;
}

export interface KeyPackageCountResponse extends APIResponse {
  remaining: number;
}

export interface DeviceKeyPackage {
  /** TLS-serialized KeyPackage bytes */
  key_package: number[];
  device_id: string;
}

export interface GetKeyPackagesResponse extends APIResponse {
  key_packages: DeviceKeyPackage[];
  user_id: string;
}

export interface MemberKeyPackages {
  user_id: string;
  key_packages: DeviceKeyPackage[];
}

export interface GetKeyPackagesByCidResponse extends APIResponse {
  members: MemberKeyPackages[];
}

// NOTE: AddMembersRequest has been removed — add_members is now handled
// through the standard edit_channel endpoint (POST /channels/{type}/{id})
// with MLS fields (commit, welcome, ratchet_tree, epoch, group_info)
// embedded alongside add_members in the request body.

// RemoveMemberRequest — REMOVED
// Merged into edit_channel_handler. Use channel.removeMembersE2ee() instead.
// See MlsManager.evictMember() in mls_manager.ts for the updated flow.

export interface KeyRotationRequest {
  commit: number[];
  epoch: number;
  /** TLS-serialized GroupInfo bytes — required so server stores alongside epoch advance. */
  group_info: number[];
}

export interface EnableE2eeRequest {
  /** TLS-serialized commit bytes from WASM */
  commit: number[];
  /** TLS-serialized welcome bytes from WASM */
  welcome: number[];
  /** Exported ratchet tree bytes */
  ratchet_tree: number[];
  epoch: number;
  /**
   * TLS-serialized GroupInfo bytes — required so external join is possible
   * from the very first epoch without a separate upload.
   */
  group_info: number[];
}

export interface MlsOperationResponse extends APIResponse {
  status: string;
}

// GroupInfo & External Join types

export interface UploadGroupInfoRequest {
  /** TLS-serialized GroupInfo bytes from WASM export_group_info */
  group_info: number[];
  epoch: number;
}

export interface GetGroupInfoResponse extends APIResponse {
  group_info: number[];
  epoch: number;
}

export interface ExternalJoinRequest {
  /** External commit bytes from WASM Group.join_external */
  commit: number[];
  epoch: number;
  /**
   * GroupInfo bytes from joiner — optional because export_group_info() is
   * only valid AFTER merge_pending_commit(). The joiner uploads GroupInfo
   * via a separate POST /group_info call after merging.
   */
  group_info?: number[];
  project_id?: string;
  members?: string[];
}

export interface SendE2eeMessageRequest {
  message: {
    id: string;
    /** Encrypted MLS ciphertext from WASM `group.create_message()` */
    mls_ciphertext: number[];
    mls_epoch: number;
    mentioned_all?: boolean;
    mentioned_users?: string[];
    parent_id?: string;
    quoted_message_id?: string;
    forward_cid?: string;
  };
}

// ============================================================
// E2EE API Client
// ============================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * E2EE API wrapper — instantiate via `new E2eeClient(ermisChatClient)`
 *
 * @example
 * ```ts
 * const e2ee = new E2eeClient(chatClient);
 * await e2ee.uploadKeyPackages({ key_packages: [kpBytes1, kpBytes2] });
 * ```
 */
export class E2eeClient<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  private client: AnyClient;

  constructor(client: ErmisChat<ErmisChatGenerics>) {
    this.client = client;
  }

  private get baseURL(): string {
    return this.client.baseURL;
  }

  /** Build headers with X-Device-ID if available */
  private get deviceHeaders(): Record<string, string> {
    const deviceId = (this.client as any).deviceId;
    return deviceId ? { 'X-Device-ID': deviceId } : {};
  }

  /** POST with X-Device-ID header */
  private async _post<T>(url: string, data?: unknown): Promise<T> {
    return await (this.client as any).doAxiosRequest('post', url, data, {
      headers: this.deviceHeaders,
    });
  }

  /** GET with X-Device-ID header */
  private async _get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
    return await (this.client as any).doAxiosRequest('get', url, null, {
      params: params || {},
      headers: this.deviceHeaders,
    });
  }

  // ---- KeyPackage Management ----

  /** Upload TLS-serialized KeyPackages for the current device. Requires `X-Device-ID` header. */
  async uploadKeyPackages(data: UploadKeyPackagesRequest): Promise<UploadKeyPackagesResponse> {
    return await this._post(this.baseURL + '/v1/e2ee/key_packages', data);
  }

  /** Check remaining KeyPackage count for the current user. */
  async getKeyPackageCount(): Promise<KeyPackageCountResponse> {
    return await this._get(this.baseURL + '/v1/e2ee/key_packages/count');
  }

  /** Consume one KeyPackage per device of the target user. */
  async getKeyPackages(targetUserId: string): Promise<GetKeyPackagesResponse> {
    return await this._get(this.baseURL + `/v1/e2ee/key_packages/${targetUserId}`);
  }

  /**
   * Consume one KeyPackage per device for channel members.
   * Always excludes the sender (caller). Optionally filter by specific user IDs.
   *
   * @param channelType - e.g. "messaging"
   * @param channelId - channel ID
   * @param targetUserIds - optional: only fetch KPs for these users (for add_members).
   *                        If omitted, returns KPs for ALL members except sender (for enable E2EE).
   */
  async getKeyPackagesByCid(
    channelType: string,
    channelId: string,
    targetUserIds?: string[],
  ): Promise<GetKeyPackagesByCidResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/key_packages`,
      { target_user_ids: targetUserIds },
    );
  }

  /**
   * Fetch and consume one KeyPackage per device for a list of user IDs.
   * Does NOT require a channel to exist — use this when creating a new E2EE channel.
   * Sender is auto-excluded server-side (also skipped if listed explicitly).
   *
   * @param userIds - List of user IDs to fetch KPs for (sender will be excluded server-side)
   */
  async getKeyPackagesByUserIds(
    userIds: string[],
  ): Promise<GetKeyPackagesByCidResponse> {
    return await this._post(
      this.baseURL + '/v1/e2ee/key_packages/batch',
      { user_ids: userIds },
    );
  }

  // ---- Enable E2EE ----

  /** Upgrade a standard channel to E2EE. Admin or channel Owner only. All members must have accepted their invites. */
  async enableE2ee(
    channelType: string,
    channelId: string,
    data: EnableE2eeRequest,
  ): Promise<MlsOperationResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/enable`,
      data,
    );
  }

  // NOTE: addMembers has been removed — add_members is now handled through
  // the standard edit_channel endpoint (POST /channels/{type}/{id}).
  // See MlsManager.addMembers() in mls_manager.ts for the updated flow.

  // removeMember — REMOVED
  // Merged into edit_channel_handler (RemoveMembers branch).
  // Use channel.removeMembersE2ee() which calls the standard POST /channels/{type}/{id} endpoint.
  // See MlsManager.evictMember() in mls_manager.ts for the updated flow.

  /** Key rotation (self update): rotate own key material for forward secrecy. */
  async keyRotation(
    channelType: string,
    channelId: string,
    data: KeyRotationRequest,
  ): Promise<MlsOperationResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/key_rotation`,
      data,
    );
  }

  // ---- E2EE Messaging & Sync ----

  /** Send an encrypted E2EE message. */
  async sendMessage(
    channelType: string,
    channelId: string,
    data: SendE2eeMessageRequest,
  ): Promise<APIResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/message`,
      data,
    );
  }

  /**
   * Per-channel sync: fetch protocol + application events for a single channel.
   * @param since Millisecond timestamp (ms since epoch)
   * @param limit Max events to return (default 100, server caps at 200)
   */
  async syncChannel(
    channelType: string,
    channelId: string,
    since: number,
    limit: number = 100,
  ): Promise<ChannelSyncResult> {
    return await this._get(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/sync`,
      { since, limit },
    );
  }

  /**
   * Unified sync: fetch all protocol + application events across multiple E2EE channels.
   * @param cursors Map of CID → last sync timestamp (milliseconds since epoch)
   * @param limit Max events per channel (default 100, server caps at 200)
   */
  async syncAll(
    cursors: Record<string, number>,
    limit: number = 100,
  ): Promise<UnifiedSyncResponse> {
    return await this._post(this.baseURL + '/v1/e2ee/sync', { cursors, limit });
  }

  // ============================================================
  // GroupInfo & External Join
  // ============================================================

  /**
   * Upload GroupInfo for a channel (UPSERT — overwrites old)
   * Called after every successful commit to enable External Join
   */
  async uploadGroupInfo(
    channelType: string,
    channelId: string,
    data: UploadGroupInfoRequest,
  ): Promise<MlsOperationResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/group_info`,
      data,
    );
  }

  /**
   * Get GroupInfo for a channel (for External Join)
   * Multi-device: must be member. Public channel: anyone.
   */
  async getGroupInfo(
    channelType: string,
    channelId: string,
  ): Promise<GetGroupInfoResponse> {
    return await this._get(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/group_info`,
    );
  }

  /**
   * Submit external join commit to server
   * Multi-device: only broadcast commit. Public channel: insert member + system msg + commit.
   */
  async externalJoin(
    channelType: string,
    channelId: string,
    data: ExternalJoinRequest,
  ): Promise<MlsOperationResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/external_join`,
      data,
    );
  }
}

// ============================================================
// Sync Types
// ============================================================

/** Protocol event types */
export type ProtocolType = 'commit' | 'welcome' | 'proposal' | 'external_commit';

/** Protocol message (commit, welcome, or proposal) */
export interface ProtocolMessage {
  epoch: number;
  user: { id: string; [key: string]: unknown };
  type: ProtocolType;
  commit?: number[];
  welcome?: number[];
  ratchet_tree?: number[];
  proposal?: number[];
  target_user_ids?: string[];
}

/** A single item in a sync response — either a protocol event or an app message */
export type E2eeSyncEvent =
  | {
      type: 'application';
      /** Full Message object — `created_at` is at `data.created_at` */
      data: { id: string; created_at: string; content_type: string; mls_ciphertext?: number[]; mls_epoch?: number; [key: string]: unknown };
    }
  | {
      type: 'protocol';
      /** MLS protocol payload — `created_at` is at `data.created_at` (consistent with application variant) */
      data: {
        epoch: number;
        user: { id: string; [key: string]: unknown };
        /** `commit` | `welcome` | `proposal` | `external_commit` */
        type: ProtocolType;
        commit?: number[];
        welcome?: number[];
        ratchet_tree?: number[];
        proposal?: number[];
        target_user_ids?: string[];
        /** Timestamp when this event was stored — same location as Application.data.created_at */
        created_at: string;
      };
    }
  | {
      type: 'reaction';
      /** Reaction metadata — snapshot of current reaction state for a message */
      data: {
        /** "reaction.new" or "reaction.deleted" */
        action: 'reaction.new' | 'reaction.deleted';
        /** ID of the message that was reacted to */
        message_id: string;
        /** Current full list of reactions on the message (snapshot) */
        latest_reactions?: Array<{ type: string; user_id: string; user?: { id: string; [key: string]: unknown }; message_id: string; created_at: string; updated_at: string; [key: string]: unknown }>;
        /** Current reaction counts (snapshot) */
        reaction_counts?: Record<string, number>;
        /** The specific reaction that triggered this event */
        reaction?: { type: string; user_id: string; user?: { id: string; [key: string]: unknown }; message_id: string; created_at: string; updated_at: string; [key: string]: unknown };
        /** Timestamp for timeline sorting */
        created_at: string;
      };
    };

/** Per-channel sync result (used by both syncChannel and syncAll) */
export interface ChannelSyncResult {
  events: E2eeSyncEvent[];
  has_more: boolean;
  /** Millisecond timestamp of the last event — use this for the next sync cursor */
  next_cursor?: number;
}

/** Response from POST /v1/e2ee/sync */
export interface UnifiedSyncResponse extends APIResponse {
  [cid: string]: ChannelSyncResult | unknown;
}

