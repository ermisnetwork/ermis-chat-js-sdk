/**
 * MLS Manager — Manages MLS (E2EE) state for Ermis Chat
 *
 * Handles:
 * - WASM initialization (openmls-wasm)
 * - Identity creation/restore
 * - MLS group cache + persistence via storage adapter
 * - E2eeClient wrapper for API calls
 * - Encrypt/decrypt operations
 * - Protocol event processing (commits, welcomes)
 * - Offline sync
 */

import { E2eeClient } from './e2ee';
import type { MlsStorageAdapter, E2eeStoredMessage } from './mls_storage';
import { IndexedDBMlsStorage } from './mls_storage';
import type { ErmisChat } from './client';
import type { ExtendableGenerics, DefaultGenerics } from './types';

// ============================================================
// Types
// ============================================================

export interface MlsManagerOptions {
  /** Custom storage adapter. Defaults to IndexedDBMlsStorage. */
  storage?: MlsStorageAdapter;
  /** Path to the openmls WASM binary. Defaults to '/openmls_wasm_bg.wasm'. */
  wasmPath?: string;
  /**
   * Pre-loaded WASM module. If provided, skips dynamic import.
   * Consumer should do: `import * as wasm from 'ermis-chat-js-sdk/src/wasm/openmls_wasm.js'`
   * then `await wasm.default('/openmls_wasm_bg.wasm'); wasm.init();`
   * and pass `wasmModule: wasm`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wasmModule?: any;
}

export interface DecryptResult {
  text: string;
  messageType: number;
  senderIndex: number;
  epoch: number;
}

export interface WaterfallResult {
  decrypted: E2eeStoredMessage[];
  buffered: unknown[];
}

// WASM module — loaded dynamically
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasmModule: any = null;

// ============================================================
// MLS Manager Class
// ============================================================

/**
 * MLS Manager — instantiate and call `initialize()` to set up E2EE.
 *
 * @example
 * ```ts
 * import { MlsManager } from 'ermis-chat-js-sdk';
 *
 * const mlsManager = new MlsManager();
 * await mlsManager.initialize(client, userId, {
 *   wasmPath: '/openmls_wasm_bg.wasm',
 * });
 * ```
 */
export class MlsManager<ErmisChatGenerics extends ExtendableGenerics = DefaultGenerics> {
  initialized = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  provider: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  identity: any = null;
  userId: string | null = null;
  deviceId: string | null = null;
  e2eeClient: E2eeClient<ErmisChatGenerics> | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: ErmisChat<ErmisChatGenerics> | null = null;
  storage: MlsStorageAdapter;

  /** cid → Group (WASM object) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groups: Map<string, any> = new Map();

  /** Whether Provider was restored from storage (vs newly created) */
  private _providerRestored = false;
  private _wasmPath = '/openmls_wasm_bg.wasm';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _injectedWasm: any = null;

  constructor() {
    this.storage = new IndexedDBMlsStorage();
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize the MLS manager
   * @param client - SDK client instance
   * @param userId - Current user ID
   * @param options - Optional storage adapter and WASM path
   */
  async initialize(
    client: ErmisChat<ErmisChatGenerics>,
    userId: string,
    options?: MlsManagerOptions,
  ): Promise<void> {
    if (this.initialized) return;

    this.client = client;
    this.userId = userId;

    if (options?.storage) {
      this.storage = options.storage;
    }
    if (options?.wasmPath) {
      this._wasmPath = options.wasmPath;
    }
    if (options?.wasmModule) {
      this._injectedWasm = options.wasmModule;
    }

    this.deviceId = await this.storage.getDeviceId();

    // 1. Load WASM + restore or create Provider
    await this._initWasm();

    // 2. Create or restore Identity
    await this._initIdentity();

    // 3. Create E2eeClient
    this.e2eeClient = new E2eeClient<ErmisChatGenerics>(client);

    // 4. Force upload key packages ONLY if Provider is new (old KPs are useless for new Provider)
    //    Restored Provider relies on health.check event for top-up.
    if (!this._providerRestored) {
      await this._uploadKeyPackages(50);
    }

    // 5. Sync MLS events for E2EE channels (restore groups from server)
    await this._syncAndRestoreGroups();

    // 6. Persist Provider state after sync (groups modify the key store)
    await this._persistProvider();

    // 7. Register this manager on the client so event handlers can access it
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.client as any).mlsManager = this;

    this.initialized = true;
    console.log('[MLS] Manager initialized', {
      userId: this.userId,
      deviceId: this.deviceId,
      groups: this.groups.size,
    });
  }

  /**
   * Load WASM module and restore or create Provider.
   *
   * The Provider holds the key store (private keys for KPs, groups, etc).
   * If previously saved to storage, restore it to preserve existing KPs.
   */
  private async _initWasm(): Promise<void> {
    if (wasmModule) {
      // WASM already loaded, just restore Provider
      await this._restoreOrCreateProvider();
      return;
    }

    if (this._injectedWasm) {
      wasmModule = this._injectedWasm;
    } else {
      throw new Error(
        '[MLS] wasmModule is required. Pass the loaded openmls WASM module via options.wasmModule in initialize().',
      );
    }

    await this._restoreOrCreateProvider();
  }

  /**
   * Try to restore Provider from storage, or create a new one.
   */
  private async _restoreOrCreateProvider(): Promise<void> {
    const savedProvider = await this.storage.loadProviderState(this.userId!, this.deviceId!);
    if (savedProvider) {
      try {
        this.provider = wasmModule.Provider.from_bytes(new Uint8Array(savedProvider));
        this._providerRestored = true;
        console.log('[MLS] Provider restored from storage');
        return;
      } catch (err) {
        console.warn('[MLS] Failed to restore Provider, creating new one:', err);
      }
    }

    this.provider = new wasmModule.Provider();
    console.log('[MLS] New Provider created');
  }

  /**
   * Create or restore MLS identity from storage.
   */
  private async _initIdentity(): Promise<void> {
    const savedBytes = await this.storage.loadIdentity(this.userId!, this.deviceId!);

    if (savedBytes) {
      this.identity = wasmModule.Identity.from_bytes(
        this.provider,
        new Uint8Array(savedBytes),
      );
      console.log('[MLS] Identity restored from storage');
    } else {
      this.identity = new wasmModule.Identity(this.provider, this.userId);
      const bytes = this.identity.to_bytes();
      await this.storage.saveIdentity(this.userId!, this.deviceId!, bytes);
      console.log('[MLS] New identity created and saved');
    }
  }

  /**
   * Upload N key packages to the server.
   * Called internally during init (fresh provider) or from ensureKeyPackages (health.check top-up).
   */
  private async _uploadKeyPackages(count: number): Promise<void> {
    try {
      const kps = this.identity.key_packages(this.provider, count);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serialized = kps.map((kp: any) => Array.from(kp.to_bytes()));
      await this.e2eeClient!.uploadKeyPackages({ key_packages: serialized });
      await this._persistProvider();
      console.log(`[MLS] Uploaded ${count} key packages`);
    } catch (err) {
      console.warn('[MLS] Failed to upload key packages:', err);
    }
  }

  /**
   * Public method to top up key packages.
   * Called from health.check event in _handleClientEvent with the server-reported remaining count.
   * @param knownRemaining - remaining count from health.check event's me.key_packages_remaining
   */
  async ensureKeyPackages(knownRemaining: number): Promise<void> {
    const target = 50;
    const toUpload = target - knownRemaining;
    if (toUpload > 0) {
      console.log(`[MLS] Key packages low (${knownRemaining}), topping up ${toUpload}...`);
      await this._uploadKeyPackages(toUpload);
    }
  }

  /**
   * Persist Provider key store to storage.
   */
  private async _persistProvider(): Promise<void> {
    try {
      const bytes = this.provider.to_bytes();
      await this.storage.saveProviderState(this.userId!, this.deviceId!, bytes);
    } catch (err) {
      console.warn('[MLS] Failed to persist Provider:', err);
    }
  }

  /**
   * Sync MLS protocol events for all E2EE channels and restore groups.
   *
   * On page reload, WASM groups are lost (in-memory only).
   * 1. Restore groups from Provider storage.
   * 2. For each restored group, call server sync API to catch up on
   *    missed protocol events (commits, welcomes) since last sync.
   */
  /**
   * Public sync — catch up on missed protocol + application events.
   * Called on reconnect (recoverState) and can be called manually.
   */
  async sync(): Promise<void> {
    return this._syncAndRestoreGroups();
  }

  private async _syncAndRestoreGroups(): Promise<void> {
    try {
      // Step 1: Restore groups from Provider storage using saved CID list
      const savedCids = await this.storage.listGroupCids();
      if (savedCids.length > 0) {
        console.log(`[MLS] Restoring ${savedCids.length} group(s) from Provider...`);
        for (const cid of savedCids) {
          if (this.groups.has(cid)) continue;
          try {
            const group = wasmModule.Group.load(this.provider, cid);
            this.groups.set(cid, group);
            console.log('[MLS] Restored group:', cid);
          } catch (err) {
            console.warn('[MLS] Failed to restore group:', cid, err);
          }
        }
      }

      // Step 2: Sync all groups via unified API
      const cursors = await this.storage.loadAllSyncTimestamps();
      const groupCids = Array.from(this.groups.keys());

      // Build cursor map — use saved timestamp or mls_enabled_at as fallback
      const syncCursors: Record<string, string> = {};
      for (const cid of groupCids) {
        if (cursors[cid]) {
          syncCursors[cid] = cursors[cid];
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const channel = (this.client as any)?.activeChannels?.[cid];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mlsEnabledAt = (channel?.data as any)?.mls_enabled_at || '1970-01-01T00:00:00Z';
          syncCursors[cid] = mlsEnabledAt;
        }
      }

      if (Object.keys(syncCursors).length === 0) {
        console.log('[MLS] No channels to sync');
        return;
      }

      // Paginated sync loop
      let hasMore = true;
      while (hasMore) {
        hasMore = false;
        const response = await this.e2eeClient!.syncAll(syncCursors, 100);

        for (const [cid, result] of Object.entries(response)) {
          // Skip non-ChannelSyncResult entries (e.g. "duration" from APIResponse)
          if (!result || typeof result !== 'object' || !('events' in result)) continue;

          const channelResult = result as { events: any[]; has_more: boolean };
          if (!channelResult.events || channelResult.events.length === 0) continue;

          // Process events for this channel
          await this._processChannelEvents(cid, channelResult.events);

          // Update cursor for next page
          const lastEvent = channelResult.events[channelResult.events.length - 1] as { created_at?: string };
          if (lastEvent.created_at) {
            syncCursors[cid] = lastEvent.created_at;
          }

          if (channelResult.has_more) {
            hasMore = true;
          }
        }
      }

      // Save all cursors at once
      await this.storage.saveAllSyncTimestamps(syncCursors);
      await this._persistProvider();

      console.log(`[MLS] Sync complete. Groups: ${this.groups.size}`);
    } catch (err) {
      console.warn('[MLS] Failed to sync and restore groups:', err);
    }
  }

  /**
   * Process sync events for a single channel (protocol + application messages).
   * Events are already sorted by the server.
   */
  private async _processChannelEvents(cid: string, events: any[]): Promise<void> {
    // Collect MLS messages for waterfall decryption after protocol events
    const mlsMessages: any[] = [];

    for (const event of events) {
      switch (event.type) {
        case 'protocol': {
          const typeField = event.type_field || event.message?.type;
          switch (typeField) {
            case 'welcome': {
              const targetUserIds = (event.target_user_ids || event.message?.target_user_ids) as string[] || [];
              if (targetUserIds.includes(this.userId!)) {
                const welcome = event.welcome || event.message?.welcome;
                const ratchetTree = event.ratchet_tree || event.message?.ratchet_tree;
                await this.joinGroup(welcome as Uint8Array, ratchetTree as Uint8Array | undefined);
              }
              break;
            }
            case 'commit': {
              const user = (event.user || event.message?.user) as { id?: string } | undefined;
              if (user?.id !== this.userId) {
                const commit = event.commit || event.message?.commit;
                await this.processCommit(cid, commit as Uint8Array);
              }
              break;
            }
          }
          break;
        }
        case 'message': {
          const contentType = event.content_type;
          if (contentType !== 'mls') {
            // Standard/system message — save directly, no decryption needed
            await this.storage.saveE2eeMessage({
              id: event.id,
              cid,
              content_type: 'standard',
              text: event.text || '',
              user_id: event.user?.id || '',
              user: event.user ? { ...event.user } : undefined,
              created_at: event.created_at || new Date().toISOString(),
              type: event.message_type || event.type_field || 'system',
              parent_id: event.parent_id,
              quoted_message_id: event.quoted_message_id,
              mentioned_users: event.mentioned_users,
            });
          } else {
            // MLS encrypted message — buffer for waterfall decryption
            mlsMessages.push(event);
          }
          break;
        }
      }
    }

    // Waterfall decrypt buffered MLS messages (protocol events already processed above)
    if (mlsMessages.length > 0) {
      await this.decryptApplicationMessages(cid, mlsMessages);
    }

    console.log('[MLS] Processed', events.length, 'events for:', cid);
  }

  /**
   * Sync a new E2EE channel that doesn't have a local group yet.
   * Uses unified sync API with a single-channel cursor.
   */
  async syncNewChannel(channelType: string, channelId: string, cid: string): Promise<void> {
    if (this.groups.has(cid)) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (this.client as any)?.activeChannels?.[cid];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mlsEnabledAt = (channel?.data as any)?.mls_enabled_at || '1970-01-01T00:00:00Z';
    const since = (await this.storage.loadSyncTimestamp(cid)) || mlsEnabledAt;

    const response = await this.e2eeClient!.syncAll({ [cid]: since }, 100);
    const result = response[cid] as { events: any[]; has_more: boolean } | undefined;
    if (result?.events && result.events.length > 0) {
      await this._processChannelEvents(cid, result.events);
      const lastEvent = result.events[result.events.length - 1] as { created_at?: string };
      if (lastEvent.created_at) {
        await this.storage.saveSyncTimestamp(cid, lastEvent.created_at);
      }
      await this._persistProvider();
    }

    if (!this.groups.has(cid)) {
      console.warn('[MLS] No welcome found for new channel:', cid);
    }
  }

  // ============================================================
  // Group Management
  // ============================================================

  /**
   * Get a cached group or null
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getGroup(cid: string): any | null {
    return this.groups.get(cid) || null;
  }

  /**
   * Create a new MLS group for a channel
   * @param cid - e.g. "messaging:channel_abc"
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createGroup(cid: string): any {
    const group = wasmModule.Group.create_with_cid(
      this.provider,
      this.identity,
      cid,
    );
    this.groups.set(cid, group);
    // Persist group CID marker to storage
    this._saveGroup(cid);
    console.log('[MLS] Group created:', cid);
    return group;
  }

  /**
   * Join a group via Welcome message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async joinGroup(welcomeBytes: Uint8Array, ratchetTreeBytes?: Uint8Array): Promise<any> {
    const ratchetTree = ratchetTreeBytes
      ? wasmModule.RatchetTree.from_bytes(new Uint8Array(ratchetTreeBytes))
      : null;

    const group = wasmModule.Group.join_with_welcome(
      this.provider,
      new Uint8Array(welcomeBytes),
      ratchetTree,
    );

    const cid = group.cid();

    // Skip if we already have this group (e.g. we're the creator)
    if (this.groups.has(cid)) {
      console.log('[MLS] Already have group, skipping join:', cid);
      group.free();
      return this.groups.get(cid);
    }

    this.groups.set(cid, group);
    await this._saveGroup(cid);
    await this._persistProvider();
    console.log('[MLS] Joined group via Welcome:', cid);
    return group;
  }

  /**
   * Save group CID marker to storage.
   * Group state lives inside Provider storage, not serialized separately.
   */
  private async _saveGroup(cid: string): Promise<void> {
    try {
      await this.storage.saveGroupState(cid, true);
    } catch (err) {
      console.warn('[MLS] Failed to save group CID:', cid, err);
    }
  }

  // ============================================================
  // Enable E2EE Flow
  // ============================================================

  /**
   * Full enable E2EE flow for a channel.
   *
   * @param channelType - e.g. "messaging"
   * @param channelId
   * @param cid - e.g. "messaging:channel_abc"
   * @param memberUserIds - all member user IDs to add
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async enableE2ee(
    channelType: string,
    channelId: string,
    cid: string,
    memberUserIds: string[],
  ): Promise<any> {
    // 1. Create MLS group
    const group = this.createGroup(cid);

    // 2. Fetch key packages for all members (except self)
    const otherMembers = memberUserIds.filter((id) => id !== this.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allKeyPackages: any[] = [];

    for (const memberId of otherMembers) {
      const { key_packages } = await this.e2eeClient!.getKeyPackages(memberId);
      for (const kpData of key_packages) {
        const kp = wasmModule.KeyPackage.from_bytes(
          new Uint8Array(kpData.key_package),
        );
        allKeyPackages.push(kp);
      }
    }

    // 3. Add members to group → get commit + welcome
    const commitBundle = group.add_members(
      this.provider,
      this.identity,
      allKeyPackages,
    );

    // 4. Export ratchet tree for new members
    const ratchetTree = group.export_ratchet_tree();

    // 5. Call enable API
    const result = await this.e2eeClient!.enableE2ee(channelType, channelId, {
      commit: Array.from(commitBundle.commit),
      welcome: Array.from(commitBundle.welcome),
      ratchet_tree: Array.from(ratchetTree.to_bytes()),
      epoch: Number(group.epoch()),
    });

    // 6. Merge pending commit locally
    group.merge_pending_commit(this.provider);
    await this._persistProvider();

    console.log('[MLS] E2EE enabled for channel:', cid, 'epoch:', Number(group.epoch()));
    return result;
  }

  // ============================================================
  // Add Members (Batch)
  // ============================================================

  /**
   * Batch add multiple users to an E2EE channel.
   */
  async addMembers(
    channelType: string,
    channelId: string,
    cid: string,
    newUserIds: string[],
  ): Promise<{ epoch: number }> {
    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    // 1. Fetch KPs for all users (parallel)
    const kpResponses = await Promise.all(
      newUserIds.map((uid) => this.e2eeClient!.getKeyPackages(uid)),
    );

    // 2. Flatten and deserialize all KPs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allKeyPackages: any[] = [];
    for (const resp of kpResponses) {
      for (const kpData of resp.key_packages) {
        const kp = wasmModule.KeyPackage.from_bytes(
          new Uint8Array(kpData.key_package),
        );
        allKeyPackages.push(kp);
      }
    }

    if (allKeyPackages.length === 0) {
      throw new Error('[MLS] No key packages available for any target user');
    }

    // 3. Batch add → 1 commit + 1 welcome
    const commitBundle = group.add_members(
      this.provider,
      this.identity,
      allKeyPackages,
    );

    // 4. Merge pending commit + export ratchet tree
    group.merge_pending_commit(this.provider);
    const ratchetTree = group.export_ratchet_tree();

    // 5. Send to server
    await this.e2eeClient!.addMembers(channelType, channelId, {
      target_user_ids: newUserIds,
      commit: Array.from(commitBundle.commit),
      welcome: Array.from(commitBundle.welcome),
      ratchet_tree: Array.from(ratchetTree.to_bytes()),
      epoch: Number(group.epoch()),
    });

    await this._persistProvider();
    console.log(
      '[MLS] Added',
      newUserIds.length,
      'users to:',
      cid,
      'epoch:',
      Number(group.epoch()),
    );
    return { epoch: Number(group.epoch()) };
  }

  // ============================================================
  // Message Encryption/Decryption
  // ============================================================

  /**
   * Encrypt a message for an E2EE channel
   */
  encryptMessage(cid: string, plaintext: string): Uint8Array {
    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    const encoder = new TextEncoder();
    const ciphertext = group.create_message(
      this.provider,
      this.identity,
      encoder.encode(plaintext),
    );
    return ciphertext;
  }

  /**
   * Decrypt an incoming E2EE message
   */
  decryptMessage(cid: string, ciphertext: Uint8Array): DecryptResult {
    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    const processed = group.process_message(
      this.provider,
      new Uint8Array(ciphertext),
    );

    const decoder = new TextDecoder();
    return {
      text: processed.content ? decoder.decode(processed.content) : '',
      messageType: processed.message_type,
      senderIndex: processed.sender_index,
      epoch: Number(processed.epoch),
    };
  }

  // ============================================================
  // Protocol Event Processing
  // ============================================================

  /**
   * Process an MLS commit message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processCommit(cid: string, commitBytes: Uint8Array): Promise<any | null> {
    const group = this.groups.get(cid);
    if (!group) {
      console.warn('[MLS] processCommit: no group for', cid);
      return null;
    }

    const processed = group.process_message(
      this.provider,
      new Uint8Array(commitBytes),
    );

    console.log('[MLS] Commit processed for:', cid, 'epoch:', Number(group.epoch()));
    await this._persistProvider();
    return processed;
  }

  /**
   * Process an incoming E2EE application message.
   * Decrypts and persists to local storage.
   */
  async processE2eeMessage(
    cid: string,
    message: { id: string; mls_ciphertext?: Uint8Array; user?: { id: string }; created_at?: string; [key: string]: unknown },
  ): Promise<{ text: string } | null> {
    const ciphertext = message.mls_ciphertext;
    if (!ciphertext) return null;

    const group = this.groups.get(cid);
    if (!group) {
      console.warn('[MLS] processE2eeMessage: no group for', cid);
      return null;
    }

    try {
      const { text, messageType } = this.decryptMessage(cid, ciphertext);

      if (messageType === 0) {
        // ApplicationMessage — save decrypted text to local DB
        await this.storage.saveE2eeMessage({
          id: message.id,
          cid,
          content_type: 'mls',
          text,
          user_id: message.user?.id || '',
          user: message.user ? { ...message.user } : undefined,
          created_at: message.created_at || new Date().toISOString(),
          type: (message as any).type || 'regular',
          attachments: (message as any).attachments,
          parent_id: (message as any).parent_id,
          quoted_message_id: (message as any).quoted_message_id,
          mentioned_users: (message as any).mentioned_users,
        });

        return { text };
      }
    } catch (err) {
      console.error('[MLS] Failed to decrypt message:', cid, err);
    }

    return null;
  }

  /**
   * Send an encrypted E2EE message
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async sendMessage(
    channelType: string,
    channelId: string,
    cid: string,
    text: string,
    messageId: string,
    options: {
      parent_id?: string;
      quoted_message_id?: string;
      mentioned_users?: string[];
      mentioned_all?: boolean;
      forward_cid?: string;
    } = {},
  ): Promise<any> {
    const ciphertext = this.encryptMessage(cid, text);
    const group = this.getGroup(cid);

    const response = await this.e2eeClient!.sendMessage(channelType, channelId, {
      message: {
        id: messageId,
        mls_ciphertext: Array.from(ciphertext),
        mls_epoch: Number(group.epoch()),
        ...options,
      },
    });

    // Save to local DB with full envelope
    await this.storage.saveE2eeMessage({
      id: messageId,
      cid,
      content_type: 'mls',
      text,
      user_id: this.userId!,
      created_at: new Date().toISOString(),
      type: 'regular',
      parent_id: options.parent_id,
      quoted_message_id: options.quoted_message_id,
      mentioned_users: options.mentioned_users,
    });

    return response;
  }

  // ============================================================
  // Waterfall Decryption
  // ============================================================

  /**
   * Decrypt application messages in epoch order (waterfall).
   *
   * Protocol events (commits/welcomes) must be processed BEFORE calling this.
   * Messages are sorted by created_at and decrypted sequentially.
   */
  async decryptApplicationMessages(
    cid: string,
    encryptedMessages: Array<{
      id: string;
      mls_ciphertext?: Uint8Array;
      user?: { id: string };
      created_at: string;
      [key: string]: unknown;
    }>,
  ): Promise<WaterfallResult> {
    const group = this.groups.get(cid);
    if (!group) return { decrypted: [], buffered: [] };

    const decrypted: E2eeStoredMessage[] = [];
    const buffered: unknown[] = [];

    // Sort by created_at ascending for correct epoch processing
    const sorted = [...encryptedMessages].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    for (const msg of sorted) {
      if (!msg.mls_ciphertext) continue;

      try {
        const { text, messageType } = this.decryptMessage(cid, msg.mls_ciphertext);
        if (messageType === 0) {
          const decryptedMsg: E2eeStoredMessage = {
            id: msg.id,
            cid,
            content_type: 'mls',
            text,
            user_id: msg.user?.id || '',
            user: msg.user ? { ...msg.user } : undefined,
            created_at: msg.created_at,
            type: (msg as any).type || 'regular',
            attachments: (msg as any).attachments,
            parent_id: (msg as any).parent_id,
            quoted_message_id: (msg as any).quoted_message_id,
            mentioned_users: (msg as any).mentioned_users,
          };
          await this.storage.saveE2eeMessage(decryptedMsg);
          decrypted.push(decryptedMsg);
        }
      } catch (err) {
        buffered.push(msg);
        console.warn('[MLS] Buffered message (decrypt failed):', msg.id, (err as Error).message);
      }
    }

    if (decrypted.length > 0) {
      await this._persistProvider();
    }

    console.log(
      '[MLS] Waterfall decrypt:',
      cid,
      'decrypted:',
      decrypted.length,
      'buffered:',
      buffered.length,
    );
    return { decrypted, buffered };
  }

  // ============================================================
  // Cleanup
  // ============================================================

  /**
   * Clean up all groups and state
   */
  destroy(): void {
    const groups = Array.from(this.groups.values());
    for (let i = 0; i < groups.length; i++) {
      try {
        groups[i].free();
      } catch (e) {
        // ignore
      }
    }
    this.groups.clear();

    if (this.identity) {
      try {
        this.identity.free();
      } catch (e) {
        // ignore
      }
    }

    if (this.provider) {
      try {
        this.provider.free();
      } catch (e) {
        // ignore
      }
    }

    this.initialized = false;
    this.provider = null;
    this.identity = null;
    this.e2eeClient = null;
    this.client = null;
    console.log('[MLS] Manager destroyed');
  }
}
