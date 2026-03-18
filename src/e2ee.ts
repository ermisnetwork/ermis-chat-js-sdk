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

export interface AddMembersRequest {
  target_user_ids: string[];
  /** TLS-serialized commit bytes from WASM `commitBundle.commit` */
  commit: number[];
  /** TLS-serialized welcome bytes from WASM `commitBundle.welcome` */
  welcome: number[];
  /** Exported ratchet tree bytes */
  ratchet_tree: number[];
  epoch: number;
}

export interface RemoveMemberRequest {
  target_user_id: string;
  commit: number[];
  epoch: number;
}

export interface KeyRotationRequest {
  commit: number[];
  epoch: number;
}

export interface EnableE2eeRequest {
  /** TLS-serialized commit bytes from WASM */
  commit: number[];
  /** TLS-serialized welcome bytes from WASM */
  welcome: number[];
  /** Exported ratchet tree bytes */
  ratchet_tree: number[];
  epoch: number;
}

export interface MlsOperationResponse extends APIResponse {
  status: string;
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

  // ---- Group Member Operations ----

  /** Add members: send commit + welcome (Direct Commit pattern). */
  async addMembers(
    channelType: string,
    channelId: string,
    data: AddMembersRequest,
  ): Promise<MlsOperationResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/add_members`,
      data,
    );
  }

  /** Remove a member: send commit (Direct Commit pattern). */
  async removeMember(
    channelType: string,
    channelId: string,
    data: RemoveMemberRequest,
  ): Promise<MlsOperationResponse> {
    return await this._post(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/remove_member`,
      data,
    );
  }

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
   * @param since ISO 8601 timestamp
   * @param limit Max events to return (default 100, server caps at 200)
   */
  async syncChannel(
    channelType: string,
    channelId: string,
    since: string,
    limit: number = 100,
  ): Promise<ChannelSyncResult> {
    return await this._get(
      this.baseURL + `/v1/e2ee/channels/${channelType}/${channelId}/sync`,
      { since, limit },
    );
  }

  /**
   * Unified sync: fetch all protocol + application events across multiple E2EE channels.
   * @param cursors Map of CID → last sync timestamp (ISO 8601)
   * @param limit Max events per channel (default 100, server caps at 200)
   */
  async syncAll(
    cursors: Record<string, string>,
    limit: number = 100,
  ): Promise<UnifiedSyncResponse> {
    return await this._post(this.baseURL + '/v1/e2ee/sync', { cursors, limit });
  }
}

// ============================================================
// Sync Types
// ============================================================

/** Protocol event types */
export type ProtocolType = 'commit' | 'welcome' | 'proposal';

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
  | { type: 'message'; [key: string]: unknown }
  | { type: 'protocol'; epoch: number; user: { id: string }; type_field: ProtocolType; commit?: number[]; welcome?: number[]; ratchet_tree?: number[]; proposal?: number[]; target_user_ids?: string[] };

/** Per-channel sync result (used by both syncChannel and syncAll) */
export interface ChannelSyncResult {
  events: E2eeSyncEvent[];
  has_more: boolean;
}

/** Response from POST /v1/e2ee/sync */
export interface UnifiedSyncResponse extends APIResponse {
  [cid: string]: ChannelSyncResult | unknown;
}

