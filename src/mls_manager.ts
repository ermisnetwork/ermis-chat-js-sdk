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
 * - Epoch-stale retry (server rejects stale commits → clear + sync + retry)
 */

import { E2eeClient } from './e2ee';
import type { MlsStorageAdapter, E2eeStoredMessage } from './mls_storage';
import { IndexedDBMlsStorage } from './mls_storage';
import type { ErmisChat } from './client';
import type { ExtendableGenerics, DefaultGenerics } from './types';

// ============================================================
// Epoch-stale error detection
// ============================================================

/** Check if an API error is an epoch_stale rejection from bellboy. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isEpochStaleError(err: any): boolean {
  const msg = err?.message || err?.response?.data?.message || String(err);
  return msg.includes('epoch_stale');
}

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

/**
 * Structured payload encrypted inside mls_ciphertext.
 * Mirrors bellboy's MessageContent::Standard — the ENTIRE Standard
 * content variant is serialized to JSON, encrypted, and stored as
 * the opaque ciphertext blob. Server only sees envelope metadata.
 */
export interface E2eePayload {
  /** Message text */
  text: string;
  /** File/image/video attachments metadata */
  attachments?: unknown[];
  /** Sticker URL */
  sticker_url?: string;
  /** Poll type: 'single' | 'multiple' */
  poll_type?: string;
  /** Poll choices vote counts */
  poll_choice_counts?: Record<string, number>;
  /** Latest poll choices */
  latest_poll_choices?: unknown[];
}

export interface DecryptResult {
  /** Parsed E2EE payload — full MessageContent::Standard */
  payload: E2eePayload;
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

  /** Sync state tracking — used to gate WS decryption during reconnect sync */
  private _syncing = false;
  private _syncPromise: Promise<void> | null = null;

  /**
   * In-memory dedup: message IDs already decrypted in this session.
   * Prevents race condition where waterfall decrypt (sync) consumes ratchet
   * secrets but IndexedDB write hasn't flushed before WS message.new event
   * triggers processE2eeMessage(). Without this, processE2eeMessage would
   * attempt re-decryption → SecretReuseError (forward secrecy).
   */
  private _decryptedMsgIds = new Set<string>();

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
   * Convert a timestamp value to milliseconds.
   * Handles: ISO 8601 string, numeric string, or number.
   * Backward compatible with legacy storage that saved ISO strings.
   */
  /**
   * Extract `created_at` from a sync event.
   * Both variants now store it at `event.data.created_at`:
   * - `application`: `event.data` is a Message (always had `created_at` there)
   * - `protocol`:    `event.data` is ProtocolData (now also has `created_at`)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _getEventCreatedAt(event: any): string | undefined {
    return event?.data?.created_at;
  }

  private _toMillis(value: string | number): number {
    if (typeof value === 'number') return value;
    // If it's a numeric string (e.g. "1741176000000"), parse directly
    const num = Number(value);
    if (!isNaN(num) && num > 1_000_000_000_000) return num;
    // Otherwise treat as ISO 8601 date string
    const ms = new Date(value).getTime();
    return isNaN(ms) ? 0 : ms;
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
   *
   * Tracks syncing state so that WS event handlers can detect when sync
   * is in progress and retry failed decryptions after sync completes.
   */
  async sync(): Promise<void> {
    this._syncing = true;
    this._syncPromise = this._syncAndRestoreGroups().finally(() => {
      this._syncing = false;
      this._syncPromise = null;
    });
    return this._syncPromise;
  }

  /** Whether an MLS sync is currently in progress (reconnect catch-up). */
  isSyncing(): boolean {
    return this._syncing;
  }

  /** Returns a promise that resolves when the current sync completes (or immediately if not syncing). */
  waitForSync(): Promise<void> {
    return this._syncPromise || Promise.resolve();
  }

  /**
   * Mark sync as started EARLY — before queryChannels or any other async work.
   * This prevents WS message.new events from consuming ratchet secrets during
   * the window between _connect() and sync().
   */
  markSyncStart(): void {
    this._syncing = true;
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
      const savedCursors = await this.storage.loadAllSyncTimestamps();
      const groupCids = Array.from(this.groups.keys());

      // Build cursor map — use saved timestamp or mls_enabled_at as fallback
      // Server expects milliseconds (i64), storage may have ISO strings (legacy) or millis
      const syncCursors: Record<string, number> = {};
      for (const cid of groupCids) {
        if (savedCursors[cid]) {
          syncCursors[cid] = this._toMillis(savedCursors[cid]);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const channel = (this.client as any)?.activeChannels?.[cid];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mlsEnabledAt = (channel?.data as any)?.mls_enabled_at;
          // Use mls_enabled_at if available, otherwise Date.now().
          // NEVER fall back to epoch 0 (1970) — that would fetch the entire message history.
          syncCursors[cid] = mlsEnabledAt ? this._toMillis(mlsEnabledAt) : Date.now();
        }
      }

      if (Object.keys(syncCursors).length === 0) {
        console.log('[MLS] No existing channels to sync — will check for external join');
      } else {
        // Paginated sync loop
        let hasMore = true;
        while (hasMore) {
          hasMore = false;
          const response = await this.e2eeClient!.syncAll(syncCursors, 100);

          for (const [cid, result] of Object.entries(response)) {
            // Skip non-ChannelSyncResult entries (e.g. "duration" from APIResponse)
            if (!result || typeof result !== 'object' || !('events' in result)) continue;

            const channelResult = result as { events: any[]; has_more: boolean; next_cursor?: number };
            if (!channelResult.events || channelResult.events.length === 0) continue;

            // Process events for this channel
            await this._processChannelEvents(cid, channelResult.events);

            // Update cursor for next page — prefer server-provided next_cursor
            if (channelResult.next_cursor) {
              syncCursors[cid] = channelResult.next_cursor;
            } else {
              const lastEventCreatedAt = this._getEventCreatedAt(channelResult.events[channelResult.events.length - 1]);
              if (lastEventCreatedAt) {
                syncCursors[cid] = this._toMillis(lastEventCreatedAt);
              }
            }

            if (channelResult.has_more) {
              hasMore = true;
            }
          }
        }

        // Save all cursors as strings for storage compatibility
        const cursorsToSave: Record<string, string> = {};
        for (const [cid, ms] of Object.entries(syncCursors)) {
          cursorsToSave[cid] = String(ms);
        }
        await this.storage.saveAllSyncTimestamps(cursorsToSave);
        await this._persistProvider();

        console.log(`[MLS] Sync complete. Groups: ${this.groups.size}`);
      }

      // Step 3: Multi-device — external join for E2EE channels without local group
      // On a new device, no groups are restored from storage.
      // Scan all activeChannels and external join any E2EE channel missing a local group.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const activeChannels = (this.client as any)?.activeChannels as Record<string, any> | undefined;
      if (activeChannels) {
        const missingCids: Array<{ cid: string; type: string; id: string }> = [];
        for (const [cid, channel] of Object.entries(activeChannels)) {
          if (channel?.data?.mls_enabled && !this.groups.has(cid)) {
            missingCids.push({ cid, type: channel.type, id: channel.id });
          }
        }

        if (missingCids.length > 0) {
          console.log(`[MLS] Multi-device: ${missingCids.length} E2EE channel(s) need external join`);
          // External join sequentially to avoid race conditions on Provider state
          for (const { cid, type, id } of missingCids) {
            try {
              await this.joinExternal(type, id, cid);
              console.log('[MLS] Multi-device external join completed:', cid);
            } catch (err) {
              console.warn('[MLS] Multi-device external join failed:', cid, err);
            }
          }
        }
      }
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
      // Sync response uses event.type as sole discriminator: "protocol" | "application"
      // Data is always nested in event.data
      const eventType = event.type;

      if (eventType === 'protocol') {
        const protoMsg = event.data || event.message || event;
        const typeField = protoMsg.type || protoMsg.type_field;

        switch (typeField) {
          case 'welcome': {
            const targetUserIds = (protoMsg.target_user_ids) as string[] || [];
            if (targetUserIds.includes(this.userId!) && !this.groups.has(cid)) {
              await this.joinGroup(protoMsg.welcome as Uint8Array, protoMsg.ratchet_tree as Uint8Array | undefined);
            }
            break;
          }
          case 'commit':
          case 'external_commit': {
            // Pre-check: if group epoch already advanced past this commit's epoch,
            // the commit was already applied (e.g. we merged it before last reload).
            // Do NOT call group.process_message() — for ExternalCommit, OpenMLS
            // returns an AEAD error (not epoch mismatch) which corrupts ratchet state.
            const commitEventEpoch: number = protoMsg.epoch ?? -1;
            const currentGroup = this.groups.get(cid);
            if (currentGroup && commitEventEpoch >= 0) {
              const groupEpoch = Number(currentGroup.epoch());
              if (groupEpoch >= commitEventEpoch) {
                console.log(
                  `[MLS] processCommit: commit at epoch ${commitEventEpoch} already applied (group at ${groupEpoch}), skipping:`,
                  cid,
                );
                break;
              }
            }
            const commit = protoMsg.commit;
            await this.processCommit(cid, commit as Uint8Array, commitEventEpoch);
            break;
          }
        }
      } else if (eventType === 'application') {
        // Application message — data nested in event.data
        const msg = event.data || event.message;
        const contentType = msg.content_type;

        if (contentType === 'mls') {
          // MLS encrypted message — buffer for waterfall decryption
          // NOTE: read epoch INSIDE loop — commits above may have advanced it
          const group = this.groups.get(cid);
          const msgEpoch = msg.mls_epoch || 0;
          const groupEpoch = group ? Number(group.epoch()) : 0;
          if (group && msgEpoch < groupEpoch) {
            console.log(
              `[MLS] Skipping pre-join message (msg epoch ${msgEpoch} < group epoch ${groupEpoch}):`,
              msg.id,
            );
            continue;
          }
          mlsMessages.push(msg);
        } else {
          // Standard/system message — save directly, no decryption needed
          await this.storage.saveE2eeMessage({
            id: msg.id,
            cid,
            content_type: 'standard',
            text: msg.text || '',
            user_id: msg.user?.id || '',
            user: msg.user ? { ...msg.user } : undefined,
            created_at: msg.created_at || new Date().toISOString(),
            type: msg.message_type || msg.type || 'system',
            parent_id: msg.parent_id,
            quoted_message_id: msg.quoted_message_id,
            mentioned_users: msg.mentioned_users,
          });
        }
      } else if (eventType === 'reaction') {
        // Reaction metadata event — update reaction state for the target message
        const reactionData = event.data;
        const messageId = reactionData?.message_id;
        if (!messageId) continue;

        // 1. Update in-memory channel state (if channel is active and has the message)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const activeChannel = (this.client as any)?.activeChannels?.[cid];
        if (activeChannel?.state?.messageSets) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          activeChannel.state.messageSets.forEach((messageSet: any) => {
            for (let i = 0; i < messageSet.messages.length; i++) {
              if (messageSet.messages[i].id === messageId) {
                messageSet.messages[i] = {
                  ...messageSet.messages[i],
                  latest_reactions: reactionData.latest_reactions ?? messageSet.messages[i].latest_reactions,
                  reaction_counts: reactionData.reaction_counts ?? messageSet.messages[i].reaction_counts,
                };
                break;
              }
            }
          });
        }

        // 2. Update local storage — merge reaction fields only
        try {
          const existingMsg = await this.storage.loadE2eeMessage(messageId);
          if (existingMsg) {
            await this.storage.saveE2eeMessage({
              ...existingMsg,
              latest_reactions: reactionData.latest_reactions ?? existingMsg.latest_reactions,
              reaction_counts: reactionData.reaction_counts ?? existingMsg.reaction_counts,
            });
          }
        } catch (err) {
          console.warn('[MLS] Failed to update reactions in storage:', messageId, err);
        }
      }
    }

    // Waterfall decrypt buffered MLS messages (protocol events already processed above)
    if (mlsMessages.length > 0) {
      const { decrypted } = await this.decryptApplicationMessages(cid, mlsMessages);

      // Patch channel.state.messages in-memory: replace encrypted MLS messages
      // with their decrypted content so the UI can re-render without refetching.
      if (decrypted.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const activeChannel = (this.client as any)?.activeChannels?.[cid];
        if (activeChannel?.state?.messages) {
          const decryptedById = new Map(decrypted.map((d) => [d.id, d]));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          activeChannel.state.messageSets?.forEach((messageSet: any) => {
            for (let i = 0; i < messageSet.messages.length; i++) {
              const msg = messageSet.messages[i];
              const dec = decryptedById.get(msg.id);
              if (dec) {
                messageSet.messages[i] = {
                  ...msg,
                  content_type: 'standard',
                  text: dec.text ?? '',
                  attachments: dec.attachments ?? msg.attachments,
                  sticker_url: dec.sticker_url ?? msg.sticker_url,
                };
              }
            }
          });
        }
      }
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
    const mlsEnabledAt = (channel?.data as any)?.mls_enabled_at;
    const savedTs = await this.storage.loadSyncTimestamp(cid);
    // Prefer saved cursor; else mls_enabled_at; else now.
    // NEVER use epoch 0 — that would fetch the entire message history.
    const since = savedTs
      ? this._toMillis(savedTs)
      : mlsEnabledAt
        ? this._toMillis(mlsEnabledAt)
        : Date.now();

    const response = await this.e2eeClient!.syncAll({ [cid]: since }, 100);
    const result = response[cid] as { events: any[]; has_more: boolean } | undefined;
    if (result?.events && result.events.length > 0) {
      await this._processChannelEvents(cid, result.events);
      const lastEventCreatedAt = this._getEventCreatedAt(result.events[result.events.length - 1]);
      if (lastEventCreatedAt) {
        await this.storage.saveSyncTimestamp(cid, String(this._toMillis(lastEventCreatedAt)));
      }
      await this._persistProvider();
    }

    if (!this.groups.has(cid)) {
      // Multi-device fallback: no welcome found (consumed by another device) → external join
      console.log('[MLS] No welcome found for:', cid, '→ attempting external join');
      try {
        await this.joinExternal(channelType, channelId, cid);
        console.log('[MLS] External join fallback succeeded:', cid);
      } catch (err) {
        console.warn('[MLS] External join fallback failed:', cid, err);
      }
    }
  }

  /**
   * Sync MLS events for a channel that was just joined via external commit.
   *
   * Unlike syncNewChannel, this method does NOT have the early-return guard
   * (`if (this.groups.has(cid)) return`) so it works correctly when called
   * immediately after joinExternal (when the group IS already in `this.groups`).
   *
   * After decrypting buffered messages it dispatches `e2ee.post_join_sync` on
   * the client so the UI layer can refresh the message list.
   */
  async syncAfterExternalJoin(channelType: string, channelId: string, cid: string): Promise<void> {
    if (!this.groups.has(cid)) {
      console.warn('[MLS] syncAfterExternalJoin: no group for', cid, '— skipping');
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const channel = (this.client as any)?.activeChannels?.[cid];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mlsEnabledAt = (channel?.data as any)?.mls_enabled_at;
    const savedTs = await this.storage.loadSyncTimestamp(cid);
    // Prefer saved cursor; else mls_enabled_at; else now.
    // NEVER use epoch 0 — that would fetch the entire message history.
    const since = savedTs
      ? this._toMillis(savedTs)
      : mlsEnabledAt
        ? this._toMillis(mlsEnabledAt)
        : Date.now();

    const response = await this.e2eeClient!.syncAll({ [cid]: since }, 100);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = response[cid] as { events: any[]; has_more: boolean } | undefined;
    if (result?.events && result.events.length > 0) {
      await this._processChannelEvents(cid, result.events);
      const lastEventCreatedAt = this._getEventCreatedAt(result.events[result.events.length - 1]);
      if (lastEventCreatedAt) {
        await this.storage.saveSyncTimestamp(cid, String(this._toMillis(lastEventCreatedAt)));
      }
      await this._persistProvider();
    }

    // Notify UI: E2EE messages for this channel have been decrypted, please refresh.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.client as any)?.dispatchEvent?.({ type: 'e2ee.post_join_sync', cid });
    console.log('[MLS] syncAfterExternalJoin complete for:', cid);
  }


  // ============================================================

  /**
   * Get a cached group or null
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getGroup(cid: string): any | null {
    return this.groups.get(cid) || null;
  }

  /**
   * Get the current epoch for a channel.
   * Returns -1 if no local group exists.
   */
  getEpoch(cid: string): number {
    const group = this.groups.get(cid);
    return group ? Number(group.epoch()) : -1;
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

    // 2. Fetch key packages for all members via channel-based API
    //    Server auto-excludes sender and returns all devices per member.
    const { members } = await this.e2eeClient!.getKeyPackagesByCid(
      channelType,
      channelId,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allKeyPackages: any[] = [];
    for (const member of members) {
      for (const kpData of member.key_packages) {
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

    // 5. Get group_info from commitBundle (post-commit epoch N+1 state)
    const exportedGIEnable = commitBundle.group_info;
    if (!exportedGIEnable || exportedGIEnable.length === 0) {
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw new Error('[MLS] enableE2ee: commitBundle.group_info is empty — cannot proceed');
    }

    // 6. Call enable API
    let result;
    try {
      result = await this.e2eeClient!.enableE2ee(channelType, channelId, {
        commit: Array.from(commitBundle.commit),
        welcome: Array.from(commitBundle.welcome),
        ratchet_tree: Array.from(ratchetTree.to_bytes()),
        // Send current pre-merge epoch. Server will store epoch+1 (post-commit).
        epoch: Number(group.epoch()),
        group_info: Array.from(exportedGIEnable),
      });
    } catch (err) {
      // Server rejected (e.g. concurrent enable, epoch_stale) → clear pending commit
      console.error('[MLS] enableE2ee failed, clearing pending commit:', err);
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw err;
    }

    // 6. Merge pending commit locally (only after server OK)
    group.merge_pending_commit(this.provider);
    await this._persistProvider();

    console.log('[MLS] E2EE enabled for channel:', cid, 'epoch:', Number(group.epoch()));
    return result;
  }

  // ============================================================
  // Create E2EE Channel (Optimistic Inclusion)
  // ============================================================

  /**
   * Prepare the MLS bundle for creating a new E2EE channel.
   *
   * Creates a new MLS group, adds all target members (Optimistic Inclusion),
   * and returns the commit + welcome + ratchet_tree + group_info bundle.
   * The caller passes this bundle to `channel.create({ mls_enabled: true, ...bundle })`.
   *
   * This mirrors `enableE2ee` but is used at channel creation time.
   *
   * @param channelType - e.g. "messaging" or "team"
   * @param channelId - new channel ID (must be known before calling, e.g. UUID)
   * @param cid - e.g. "team:proj-uuid"
   * @param allMemberUserIds - all member user IDs to add (including sender if desired — server KP API auto-excludes sender's KPs)
   */
  async createE2eeChannel(
    channelType: string,
    channelId: string,
    cid: string,
    allMemberUserIds: string[],
  ): Promise<{ commit: number[]; welcome: number[]; ratchet_tree: number[]; group_info: number[]; epoch: number }> {
    // 1. Create MLS group (solo — just creator, epoch 0)
    const group = this.createGroup(cid);

    // 2. Fetch key packages for all members via batch API (no channel needed)
    //    Server auto-excludes sender; members without KPs are silently omitted.
    const { members } = await this.e2eeClient!.getKeyPackagesByUserIds(allMemberUserIds);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allKeyPackages: any[] = [];
    for (const member of members) {
      for (const kpData of member.key_packages) {
        const kp = wasmModule.KeyPackage.from_bytes(new Uint8Array(kpData.key_package));
        allKeyPackages.push(kp);
      }
    }

    if (allKeyPackages.length === 0) {
      // Channel has only the creator — solo group is fine (DM where B hasn't uploaded KPs yet,
      // or team channel where creator is the only member). Proceed with solo commit.
      console.log('[MLS] createE2eeChannel: no other member KPs found, creating solo group for:', cid);
    }

    // 3. Add members → commit + welcome (or solo commit if no KPs)
    const commitBundle = allKeyPackages.length > 0
      ? group.add_members(this.provider, this.identity, allKeyPackages)
      : group.commit_pending_proposals(this.provider, this.identity);

    // 4. Export ratchet tree (needed for welcome recipients)
    const ratchetTree = group.export_ratchet_tree();

    // 5. Get group_info from commitBundle (post-commit epoch N+1 state)
    const exportedGI = commitBundle.group_info;
    if (!exportedGI || exportedGI.length === 0) {
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw new Error('[MLS] createE2eeChannel: commitBundle.group_info is empty — cannot proceed');
    }

    // 6. Capture pre-merge epoch
    const premergeEpoch = Number(group.epoch());

    // 7. Merge commit locally (group advances to epoch N+1)
    group.merge_pending_commit(this.provider);
    await this._persistProvider();

    console.log('[MLS] createE2eeChannel: bundle ready for cid:', cid, 'epoch:', Number(group.epoch()));

    return {
      commit: Array.from(commitBundle.commit as Uint8Array),
      welcome: allKeyPackages.length > 0 ? Array.from(commitBundle.welcome as Uint8Array) : [],
      ratchet_tree: Array.from(ratchetTree.to_bytes() as Uint8Array),
      group_info: Array.from(exportedGI as Uint8Array),
      epoch: premergeEpoch,
    };
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
    isRetry = false,
  ): Promise<{ epoch: number }> {
    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    // 1. Fetch KPs via channel-based API (single call, sender auto-excluded)
    const { members } = await this.e2eeClient!.getKeyPackagesByUserIds(newUserIds);
    // 2. Flatten and deserialize all KPs
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allKeyPackages: any[] = [];
    for (const member of members) {
      for (const kpData of member.key_packages) {
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

    // 4. Export ratchet tree BEFORE merge (need pre-merge state for welcome)
    const ratchetTree = group.export_ratchet_tree();

    // 5. Get group_info from commitBundle (post-commit epoch N+1 state)
    const exportedGIAdd = commitBundle.group_info;
    if (!exportedGIAdd || exportedGIAdd.length === 0) {
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw new Error('[MLS] addMembers: commitBundle.group_info is empty — cannot proceed');
    }

    // 6. Send to server FIRST — only merge if server accepts
    //    Uses the channel's addMembersE2ee() which calls the standard edit_channel
    //    endpoint with MLS fields + X-Device-ID header.
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channel = (this.client as any)?.activeChannels?.[cid];
      if (!channel) {
        throw new Error(`[MLS] No active channel found for cid: ${cid}`);
      }
      await channel.addMembersE2ee(newUserIds, {
        commit: Array.from(commitBundle.commit),
        welcome: Array.from(commitBundle.welcome),
        ratchet_tree: Array.from(ratchetTree.to_bytes()),
        epoch: Number(group.epoch()),
        group_info: Array.from(exportedGIAdd),
      });
    } catch (err) {
      if (isEpochStaleError(err) && !isRetry) {
        console.warn('[MLS] addMembers: epoch_stale, clearing + syncing + retrying');
        group.clear_pending_commit(this.provider);
        await this._persistProvider();
        await this.sync();
        return this.addMembers(channelType, channelId, cid, newUserIds, true);
      }
      // Any other error → clear pending commit + rethrow
      console.error('[MLS] addMembers failed, clearing pending commit:', err);
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw err;
    }

    // 6. Server OK → merge pending commit locally
    group.merge_pending_commit(this.provider);
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
  // Eviction (Reject / Skip handling)
  // ============================================================

  /**
   * Determine if this client is the designated evictor for a given channel.
   * We use a deterministic rule so that exactly ONE online admin triggers eviction:
   *   1. Owner (created_by.id) → always evictor
   *   2. Otherwise → admin with lexicographically lowest user_id among owners+admins
   *
   * This prevents the race condition where multiple admins all try to evict simultaneously.
   */
  isDesignatedEvictor(channel: { data?: Record<string, unknown> }): boolean {
    if (!this.userId) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = channel.data as any;
    // Owner check
    const createdById = data?.created_by?.id || data?.channel?.created_by?.id;
    if (createdById && createdById === this.userId) return true;

    // Find lowest-sorted admin
    const members: Array<{ user_id: string; channel_role?: string }> = data?.members || [];
    const adminIds = members
      .filter((m) => ['owner', 'admin'].includes(m.channel_role || ''))
      .map((m) => m.user_id)
      .sort();
    return adminIds.length > 0 && adminIds[0] === this.userId;
  }

  /**
   * Remove a member from the MLS group (eviction after reject/skip).
   * Uses WASM remove_members, sends commit to server, then merges.
   * Race condition handled by server epoch CAS: only first evictor wins,
   * second gets epoch_stale → clears + syncs (the eviction is already done).
   *
   * @param channelType - e.g. "team"
   * @param channelId   - channel ID
   * @param cid         - full CID e.g. "team:xxx:yyy"
   * @param targetUserId - user to evict
   * @param isRetry     - internal: true on second attempt after epoch_stale
   */
  async evictMember(
    channelType: string,
    channelId: string,
    cid: string,
    targetUserId: string,
    isRetry = false,
  ): Promise<void> {
    if (!this.initialized) throw new Error('[MLS] Not initialized');

    const group = this.groups.get(cid);
    if (!group) {
      console.warn('[MLS] evictMember: no local group for', cid, '— skipping');
      return;
    }

    console.log('[MLS] Evicting member:', targetUserId, 'from:', cid);

    // 1. WASM: remove_users → commitBundle (includes commit + group_info)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let commitBundle: any;
    try {
      commitBundle = group.remove_users(this.provider, this.identity, [targetUserId]);
    } catch (err) {
      console.error('[MLS] evictMember: WASM remove_users failed:', err);
      throw err;
    }

    // 2. Get GroupInfo from commitBundle (must be present — post-commit epoch N+1 state)
    const groupInfoBytes = commitBundle.group_info;
    if (!groupInfoBytes || groupInfoBytes.length === 0) {
      console.error('[MLS] evictMember: commitBundle has no group_info');
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw new Error('[MLS] evictMember: commitBundle.group_info is empty — cannot proceed');
    }

    // 3. Send commit to server via standard edit_channel endpoint
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channel = (this.client as any)?.activeChannels?.[cid];
      if (!channel) {
        throw new Error(`[MLS] No active channel found for cid: ${cid}`);
      }
      await channel.removeMembersE2ee([targetUserId], {
        commit: Array.from(commitBundle.commit),
        epoch: Number(group.epoch()),
        group_info: Array.from(groupInfoBytes),
      });
    } catch (err) {
      if (isEpochStaleError(err) && !isRetry) {
        // Another admin already evicted → clear + sync + done (no retry needed, member already out)
        console.warn('[MLS] evictMember: epoch_stale — another admin already evicted', targetUserId);
        group.clear_pending_commit(this.provider);
        await this._persistProvider();
        await this.sync();
        return;
      }
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw err;
    }

    // 4. Server OK → merge
    group.merge_pending_commit(this.provider);
    await this._persistProvider();
    console.log('[MLS] Evicted', targetUserId, 'from:', cid, 'epoch:', Number(group.epoch()));
  }

  // ============================================================
  // External Join
  // ============================================================

  /**
   * Join an existing E2EE group via External Commit.
   * Use cases: multi-device (same user, new device) or public channel join.
   *
   * Flow: GET GroupInfo → WASM join_external → POST external_join → merge commit
   */
  async joinExternal(
    channelType: string,
    channelId: string,
    cid: string,
  ): Promise<{ epoch: number }> {
    if (!this.initialized) throw new Error('[MLS] Not initialized');

    // 1. Get GroupInfo from server
    const { group_info } = await this.e2eeClient!.getGroupInfo(channelType, channelId);

    // 2. WASM: External join → produces group + commit
    const result = wasmModule.Group.join_external(
      this.provider,
      this.identity,
      new Uint8Array(group_info),
      null, // ratchet_tree is included in group_info (with_ratchet_tree=true)
    );

    const group = result.group;
    if (!group) throw new Error('[MLS] External join failed: no group returned');

    // 3. Send external join commit to server FIRST.
    // NOTE: group_info CANNOT be inlined here — export_group_info() is only valid
    // AFTER merge_pending_commit(). For external commits, the merged epoch state
    // is required before GroupInfo can be correctly exported.
    try {
      await this.e2eeClient!.externalJoin(channelType, channelId, {
        commit: Array.from(result.commit),
        // group.epoch() = N+1 (OpenMLS auto-stages the pending commit).
        // Server external_join_handler expects post-merge epoch and handles CAS internally.
        epoch: Number(group.epoch()),
        // No group_info here — will upload separately after merge below.
      });
    } catch (err) {
      // Server rejected → clear pending commit + discard group
      console.error('[MLS] External join failed, clearing pending commit:', err);
      group.clear_pending_commit(this.provider);
      throw err;
    }

    // 4. Server OK → merge pending commit locally
    group.merge_pending_commit(this.provider);

    // 5. Cache group + persist
    this.groups.set(cid, group);
    await this._saveGroup(cid);
    await this._persistProvider();

    // 6. Upload GroupInfo AFTER merge — this is the only correct timing for external join.
    //    The joiner's N+1 state is now fully committed, so export_group_info() is valid.
    await this._uploadGroupInfo(channelType, channelId, group);

    // 7. Save cursor = now so next sync only fetches events from this point forward.
    //    Without this, the next sync would use mls_enabled_at (or worse, epoch 0)
    //    and re-process every historical event, including commits we already applied.
    await this.storage.saveSyncTimestamp(cid, String(Date.now()));

    console.log('[MLS] External join completed for:', cid, 'epoch:', Number(group.epoch()));
    return { epoch: Number(group.epoch()) };
  }

  /**
   * Key rotation: rotate own key material for forward secrecy.
   *
   * Calls WASM self_update() → sends commit to server → merges pending commit.
   * All other members receive the commit via WS and advance their epoch.
   */
  async keyRotation(cid: string, isRetry = false): Promise<{ epoch: number }> {
    if (!this.initialized) throw new Error('[MLS] Not initialized');

    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    // Extract channelType / channelId from cid
    const colonIdx = cid.indexOf(':');
    if (colonIdx < 0) throw new Error(`[MLS] Invalid cid format: ${cid}`);
    const channelType = cid.substring(0, colonIdx);
    const channelId = cid.substring(colonIdx + 1);

    // 1. WASM: self_update → produces CommitBundle (commit + optional welcome)
    const bundle = group.self_update(this.provider, this.identity);

    // 2. Get group_info from bundle (post-commit epoch N+1 state)
    const groupInfoBytes = bundle.group_info;
    if (!groupInfoBytes || groupInfoBytes.length === 0) {
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw new Error('[MLS] keyRotation: bundle.group_info is empty — cannot proceed');
    }
    const groupInfoForRequest = Array.from(groupInfoBytes as Uint8Array);

    // 3. Send commit to server FIRST
    try {
      await this.e2eeClient!.keyRotation(channelType, channelId, {
        commit: Array.from(bundle.commit),
        epoch: Number(group.epoch()),
        group_info: groupInfoForRequest,
      });
    } catch (err) {
      if (isEpochStaleError(err) && !isRetry) {
        console.warn('[MLS] keyRotation: epoch_stale, clearing + syncing + retrying');
        group.clear_pending_commit(this.provider);
        await this._persistProvider();
        await this.sync();
        return this.keyRotation(cid, true);
      }
      // Any other error → clear pending commit + rethrow
      console.error('[MLS] keyRotation failed, clearing pending commit:', err);
      group.clear_pending_commit(this.provider);
      await this._persistProvider();
      throw err;
    }

    // 4. Server OK → merge pending commit locally → advances epoch
    group.merge_pending_commit(this.provider);

    // 5. Persist state
    await this._saveGroup(cid);
    await this._persistProvider();

    console.log('[MLS] Key rotation completed for:', cid, 'epoch:', Number(group.epoch()));
    return { epoch: Number(group.epoch()) };
  }

  // ============================================================
  // GroupInfo Upload Helper
  // ============================================================

  /**
   * Upload GroupInfo via separate API after merge.
   *
   * Used ONLY for externalJoin (no CommitBundle available, must export after merge)
   * and as a recovery fallback for old clients.
   *
   * For all other commit operations (enableE2ee, addMembers, keyRotation,
   * removeMember) use commitBundle.group_info instead — it is generated
   * by OpenMLS for the new epoch (N+1) and can be sent inline with the commit.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async _uploadGroupInfo(channelType: string, channelId: string, group: any): Promise<void> {
    try {
      const groupInfoBytes = group.export_group_info(this.provider, this.identity, true);
      console.log('[MLS] Exported group_info for:', channelType, channelId, 'epoch:', Number(group.epoch()));
      if (!channelType || !channelId) {
        console.warn('[MLS] Invalid CID format for GroupInfo upload:', channelType, channelId);
        return;
      }
      await this.e2eeClient!.uploadGroupInfo(channelType, channelId, {
        group_info: Array.from(groupInfoBytes),
        epoch: Number(group.epoch()),
      });
      console.log('[MLS] GroupInfo uploaded for:', channelType, channelId, 'epoch:', Number(group.epoch()));
    } catch (err) {
      // Non-fatal: GroupInfo upload failure shouldn't block the commit flow
      console.error('[MLS] Failed to upload GroupInfo for:', channelType, channelId, err);
    }
  }

  // ============================================================
  // Message Encryption/Decryption
  // ============================================================

  /**
   * Encrypt a structured payload for an E2EE channel.
   *
   * The payload is JSON-serialized before encryption so that
   * text, attachments, sticker_url, etc. are all inside the
   * opaque ciphertext — matching bellboy's MessageContent::Standard.
   */
  encryptMessage(cid: string, payload: E2eePayload): Uint8Array {
    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    const encoder = new TextEncoder();
    const payloadJson = JSON.stringify(payload);
    const ciphertext = group.create_message(
      this.provider,
      this.identity,
      encoder.encode(payloadJson),
    );

    // CRITICAL: Persist encryption ratchet state after create_message().
    // create_message() advances the sender's secret tree generation in-memory.
    // Without save_state(), a page reload restores the old generation → sender
    // re-encrypts at already-consumed generations → receiver gets forward
    // secrecy error ("message already consumed, cannot re-decrypt").
    try {
      group.save_state(this.provider);
    } catch (e) {
      console.warn('[MLS] Failed to save group state after encrypt:', e);
    }

    return ciphertext;
  }

  /**
   * Decrypt an incoming E2EE message.
   *
   * Handles both the new structured JSON payload and legacy
   * plain-text format (backward compatible).
   */
  decryptMessage(cid: string, ciphertext: Uint8Array): DecryptResult {
    const group = this.groups.get(cid);
    if (!group) throw new Error(`[MLS] No group for cid: ${cid}`);

    // NOTE: No Provider snapshot/rollback for application messages.
    // process_message passes Provider as read-only (as_ref) for PrivateMessage,
    // so the Provider is NOT modified. Group.process_message(&mut self) may
    // advance the decryption ratchet in-memory, but:
    //
    // - SecretReuseError: thrown BEFORE any state mutation → Group is fine
    // - Successful ratchet advancement + decrypt failure: correct MLS behavior
    //   (forward secrecy — can't go back)
    //
    // DO NOT reload Group from Provider — this reverts BOTH decryption AND
    // encryption ratchets, causing the other side to miss our next message.
    const processed = group.process_message(
      this.provider,
      new Uint8Array(ciphertext),
    );

    // CRITICAL: Persist updated ratchet state to Provider storage.
    // process_message advances the decryption ratchet (secret tree) in the
    // Group's in-memory state, but does NOT write it to Provider storage.
    // Without this, a Provider restore (page reload, reconnect) loads stale
    // ratchet state → SecretReuseError for previously-decrypted messages.
    try {
      group.save_state(this.provider);
    } catch (e) {
      console.warn('[MLS] Failed to save group state after decrypt:', e);
    }

    const decoder = new TextDecoder();
    const raw = processed.content ? decoder.decode(processed.content) : '';

    // Parse structured JSON payload; fall back to plain text for
    // messages encrypted before the structured-payload migration.
    let payload: E2eePayload;
    try {
      const parsed = JSON.parse(raw);
      // Validate: a structured payload MUST have a 'text' field
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        payload = parsed as E2eePayload;
      } else {
        payload = { text: raw };
      }
    } catch {
      // Not JSON → legacy plain-text message
      payload = { text: raw };
    }

    console.log('[MLS] Decrypted message:', payload.text);
    return {
      payload,
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
  async processCommit(cid: string, commitBytes: Uint8Array, eventEpoch?: number): Promise<any | null> {
    const group = this.groups.get(cid);
    if (!group) {
      console.warn('[MLS] processCommit: no group for', cid);
      return null;
    }

    // Pre-check: if group epoch already surpassed the commit's epoch,
    // the commit was already applied. Skip process_message entirely —
    // for ExternalCommit, OpenMLS returns AEAD errors (not epoch mismatch)
    // which can corrupt ratchet state.
    if (eventEpoch !== undefined && eventEpoch >= 0) {
      const groupEpoch = Number(group.epoch());
      console.log('[MLS] processCommit: group epoch:', groupEpoch, 'event epoch:', eventEpoch);
      if (groupEpoch >= eventEpoch) {
        console.log(
          `[MLS] processCommit: commit at epoch ${eventEpoch} already applied (group at ${groupEpoch}), skipping:`,
          cid,
        );
        return null;
      }
    }

    // Snapshot Provider state before process_message — commits advance
    // the epoch (irreversible). If processing fails mid-way, rollback.
    const snapshot = this.provider.to_bytes();

    try {
      const processed = group.process_message(
        this.provider,
        new Uint8Array(commitBytes),
      );

      console.log('[MLS] Commit processed for:', cid, 'epoch:', Number(group.epoch()));
      await this._persistProvider();
      return processed;
    } catch (err) {
      const errMsg = (err as Error).message || '';
      if (errMsg.includes('epoch differs')) {
        // Likely a duplicate commit already processed during sync — safe to ignore
        console.warn('[MLS] processCommit: commit already applied (epoch mismatch), skipping:', cid);
        return null;
      }
      // ROLLBACK: restore Provider from snapshot (commits modify Provider via as_mut)
      console.warn('[MLS] processCommit failed, rolling back Provider state:', errMsg);
      this.provider = wasmModule.Provider.from_bytes(new Uint8Array(snapshot));
      throw err;
    }
  }

  /**
   * Process an incoming E2EE application message.
   * Decrypts, persists to local storage, and returns a full Message object
   * that can be directly merged into channel messages state.
   *
   * The returned object combines:
   * - Decrypted E2eePayload (MessageContent::Standard) — text, attachments, sticker_url, polls
   * - Envelope metadata from WS event — id, cid, user, created_at, parent_id, etc.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async processE2eeMessage(
    cid: string,
    message: { id: string; mls_ciphertext?: Uint8Array; user?: { id: string }; created_at?: string;[key: string]: unknown },
  ): Promise<Record<string, unknown> | null> {
    const ciphertext = message.mls_ciphertext;
    if (!ciphertext) return null;

    // CRITICAL: If MLS sync is in progress (reconnecting from background),
    // do NOT attempt decryption — it would race with the waterfall decrypt
    // and consume ratchet secrets out of order. Instead, WAIT for sync to
    // finish, then check dedup: if sync already decrypted this message, return
    // the cached result; otherwise decrypt normally (message arrived after the
    // sync window).
    if (this._syncing) {
      console.log('[MLS] processE2eeMessage: sync in progress, waiting for completion:', message.id);
      try {
        await this.waitForSync();
      } catch {
        // Sync failed — fall through to normal decrypt
      }
      // Re-check dedup after sync: sync may have already decrypted this message
      if (this._decryptedMsgIds.has(message.id)) {
        console.log('[MLS] processE2eeMessage: decrypted by sync (post-wait), returning cached:', message.id);
        const cached = await this.storage.loadE2eeMessage(message.id);
        if (cached) return this._buildFullMessage(cached, message);
        return null;
      }
      const existing = await this.storage.loadE2eeMessage(message.id);
      if (existing) {
        this._decryptedMsgIds.add(message.id);
        return this._buildFullMessage(existing, message);
      }
      // Message not in sync window — fall through to normal decrypt below
    }

    // CRITICAL: Check if already decrypted (sync waterfall may have processed
    // this message before the WS message.new event arrived). MLS forward secrecy
    // deletes ratchet keys after first decrypt — re-decrypting would fail with
    // "The requested secret was deleted to preserve forward secrecy."
    //
    // Two-tier dedup:
    // 1. In-memory Set (instant, no async) — catches the race where waterfall
    //    decrypt consumed the ratchet but IndexedDB hasn't flushed yet.
    // 2. IndexedDB lookup — catches messages decrypted in a previous session.
    if (this._decryptedMsgIds.has(message.id)) {
      console.log('[MLS] processE2eeMessage: already decrypted (in-memory), skipping:', message.id);
      const cached = await this.storage.loadE2eeMessage(message.id);
      if (cached) return this._buildFullMessage(cached, message);
      // IndexedDB hasn't flushed yet — return null, UI will show "Encrypted message"
      // but the plaintext IS saved and will appear on next channel load.
      return null;
    }
    const existing = await this.storage.loadE2eeMessage(message.id);
    if (existing) {
      console.log('[MLS] processE2eeMessage: already decrypted (IndexedDB), skipping:', message.id);
      this._decryptedMsgIds.add(message.id);
      return this._buildFullMessage(existing, message);
    }

    const group = this.groups.get(cid);
    if (!group) {
      console.warn('[MLS] processE2eeMessage: no group for', cid);
      return null;
    }

    console.log('[MLS] processE2eeMessage:', {
      msgId: message.id,
      cid,
      groupEpoch: Number(group.epoch()),
      msgEpoch: message.mls_epoch,
      senderId: message.user?.id,
    });

    try {
      // Ensure ciphertext is Uint8Array (WS may deliver as regular array)
      const ctBytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext as any);
      const { payload, messageType } = this.decryptMessage(cid, ctBytes);

      // Mark as decrypted IMMEDIATELY after process_message succeeds —
      // before any async IndexedDB writes. This is the in-memory dedup
      // that prevents the race with waterfall decrypt.
      this._decryptedMsgIds.add(message.id);

      if (messageType === 0) {
        // ApplicationMessage — save decrypted Standard content to local DB
        const storedMsg: E2eeStoredMessage = {
          id: message.id,
          cid,
          content_type: 'mls',
          // Decrypted Standard content
          text: payload.text,
          attachments: payload.attachments,
          sticker_url: payload.sticker_url,
          poll_type: payload.poll_type,
          poll_choice_counts: payload.poll_choice_counts,
          latest_poll_choices: payload.latest_poll_choices,
          // Envelope metadata
          user_id: message.user?.id || '',
          user: message.user ? { ...message.user } : undefined,
          created_at: message.created_at || new Date().toISOString(),
          type: (message as any).type || 'regular',
          parent_id: (message as any).parent_id,
          quoted_message_id: (message as any).quoted_message_id,
          mentioned_users: (message as any).mentioned_users,
          mentioned_all: (message as any).mentioned_all,
        };
        await this.storage.saveE2eeMessage(storedMsg);

        // CRITICAL: persist provider state after decrypt — the ratchet key was
        // consumed during process_message. Without persisting, a reload would
        // restore stale state where the key appears consumed but no plaintext
        // exists → all future decrypts from this sender would fail.
        await this._persistProvider();

        // Return full Message object for channel state
        return this._buildFullMessage(storedMsg, message);
      }
    } catch (err) {
      const errMsg = (err as Error).message || '';
      // Forward secrecy error: the ratchet secret for this message's generation
      // was already consumed (e.g. decrypted in a previous session but IndexedDB
      // save didn't complete before tab suspension). This message is lost, but
      // future messages at higher generations will still work — the ratchet has
      // already advanced past this point.
      if (errMsg.includes('forward secrecy') || errMsg.includes('SecretReuseError')) {
        console.warn('[MLS] Forward secrecy: message already consumed, cannot re-decrypt:', message.id, {
          groupEpoch: Number(group.epoch()),
          msgEpoch: message.mls_epoch,
        });
        // Return null — the message will remain as "Encrypted message" in the UI
        // but won't block future decryptions.
        return null;
      }

      // Epoch mismatch or other recoverable error — log and return null.
      // channel.ts will dispatch 'failed' → UI shows "Encrypted message".
      console.error('[MLS] Failed to decrypt message:', cid, {
        msgId: message.id,
        groupEpoch: Number(group.epoch()),
        msgEpoch: message.mls_epoch,
        error: errMsg,
      });
    }

    return null;
  }

  /**
   * Build a full Message object from decrypted E2eeStoredMessage + envelope metadata.
   *
   * The result has `content_type: 'standard'` and contains all Standard fields,
   * so it can be directly merged into channel messages state like a normal message.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _buildFullMessage(stored: E2eeStoredMessage, envelope: Record<string, any>): Record<string, any> {
    return {
      // Core identity (from envelope)
      id: stored.id,
      cid: stored.cid,
      user: stored.user || envelope.user,
      type: stored.type || envelope.type || 'regular',
      created_at: stored.created_at,
      // Decrypted Standard content
      content_type: 'standard',
      text: stored.text,
      attachments: stored.attachments || [],
      sticker_url: stored.sticker_url,
      poll_type: stored.poll_type,
      poll_choice_counts: stored.poll_choice_counts,
      latest_poll_choices: stored.latest_poll_choices,
      // E2EE status (only present during deferred decryption)
      e2ee_status: (stored as any).e2ee_status || null,
      // Envelope metadata (routing + notifications)
      parent_id: stored.parent_id || envelope.parent_id,
      quoted_message_id: stored.quoted_message_id || envelope.quoted_message_id,
      quoted_message: envelope.quoted_message,
      forward_cid: envelope.forward_cid,
      mentioned_users: stored.mentioned_users || envelope.mentioned_users,
      mentioned_all: stored.mentioned_all || envelope.mentioned_all,
      // State (from envelope, server-managed)
      latest_reactions: envelope.latest_reactions || [],
      reaction_counts: envelope.reaction_counts,
      pinned_by: envelope.pinned_by,
      pinned_at: envelope.pinned_at,
      updated_at: envelope.updated_at,
    };
  }

  /**
   * Send an encrypted E2EE message.
   *
   * Encrypts the full MessageContent::Standard (text + attachments + sticker_url +
   * polls) inside the MLS ciphertext. Server only sees envelope metadata.
   *
   * Returns a full Message object for the sender's local channel state.
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
      /** Attachment metadata — encrypted inside E2EE payload */
      attachments?: unknown[];
      /** Sticker URL — encrypted inside E2EE payload */
      sticker_url?: string;
      /** Poll type — encrypted inside E2EE payload */
      poll_type?: string;
      /** Poll choices — encrypted inside E2EE payload */
      poll_choice_counts?: Record<string, number>;
    } = {},
  ): Promise<any> {
    // Build structured payload — everything inside is encrypted
    const payload: E2eePayload = { text };
    if (options.attachments && options.attachments.length > 0) {
      payload.attachments = options.attachments;
    }
    if (options.sticker_url) {
      payload.sticker_url = options.sticker_url;
    }
    if (options.poll_type) {
      payload.poll_type = options.poll_type;
    }
    if (options.poll_choice_counts) {
      payload.poll_choice_counts = options.poll_choice_counts;
    }

    // Strip encrypted fields — only envelope metadata goes to server
    const {
      attachments: _a, sticker_url: _s,
      poll_type: _pt, poll_choice_counts: _pc,
      ...envelopeOptions
    } = options;

    // Encrypt and send with epoch-stale retry:
    // After enableE2ee or when offline, other members may commit (external_join,
    // key rotation) advancing the server epoch. Sync group state and retry once.
    let ciphertext = this.encryptMessage(cid, payload);
    let group = this.getGroup(cid)!;
    let response: any;
    try {
      response = await this.e2eeClient!.sendMessage(channelType, channelId, {
        message: {
          id: messageId,
          mls_ciphertext: Array.from(ciphertext),
          mls_epoch: Number(group.epoch()),
          ...envelopeOptions,
        },
      });
    } catch (err) {
      if (isEpochStaleError(err)) {
        console.warn('[MLS] sendMessage: epoch_stale — syncing group and retrying...');
        await this.sync();
        // Re-encrypt with updated epoch after sync
        ciphertext = this.encryptMessage(cid, payload);
        group = this.getGroup(cid)!;
        response = await this.e2eeClient!.sendMessage(channelType, channelId, {
          message: {
            id: messageId,
            mls_ciphertext: Array.from(ciphertext),
            mls_epoch: Number(group.epoch()),
            ...envelopeOptions,
          },
        });
      } else {
        throw err;
      }
    }

    // Save to local DB with full decrypted Standard content
    const now = new Date().toISOString();
    const storedMsg: E2eeStoredMessage = {
      id: messageId,
      cid,
      content_type: 'mls',
      text,
      attachments: payload.attachments,
      sticker_url: payload.sticker_url,
      poll_type: payload.poll_type,
      poll_choice_counts: payload.poll_choice_counts,
      user_id: this.userId!,
      created_at: now,
      type: options.sticker_url ? 'sticker' : 'regular',
      parent_id: options.parent_id,
      quoted_message_id: options.quoted_message_id,
      mentioned_users: options.mentioned_users,
      mentioned_all: options.mentioned_all,
    };
    await this.storage.saveE2eeMessage(storedMsg);

    // CRITICAL: Persist Provider to IndexedDB after successful send.
    // create_message() advanced the encryption ratchet generation in-memory
    // and save_state() wrote it to Provider. Without this flush, a tab reload
    // before the next _persistProvider() call would revert the generation
    // counter → next send re-uses consumed generations → forward secrecy error
    // on the receiver side.
    await this._persistProvider();

    // Return full message for channel state + server response
    return {
      ...response,
      message: this._buildFullMessage(storedMsg, { forward_cid: options.forward_cid }),
    };
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

      // Skip messages already decrypted & stored (MLS forward secrecy:
      // keys are consumed after first use, re-decrypting would fail)
      const existing = await this.storage.loadE2eeMessage(msg.id);
      if (existing) {
        decrypted.push(existing);
        continue;
      }

      try {
        const { payload, messageType } = this.decryptMessage(cid, msg.mls_ciphertext);

        // Mark as decrypted IMMEDIATELY after process_message succeeds —
        // before async IndexedDB write. This prevents the race where WS
        // message.new arrives before saveE2eeMessage() flushes to IndexedDB.
        this._decryptedMsgIds.add(msg.id);

        if (messageType === 0) {
          const decryptedMsg: E2eeStoredMessage = {
            id: msg.id,
            cid,
            content_type: 'mls',
            // Decrypted Standard content
            text: payload.text,
            attachments: payload.attachments,
            sticker_url: payload.sticker_url,
            poll_type: payload.poll_type,
            poll_choice_counts: payload.poll_choice_counts,
            latest_poll_choices: payload.latest_poll_choices,
            // Envelope metadata
            user_id: msg.user?.id || '',
            user: msg.user ? { ...msg.user } : undefined,
            created_at: msg.created_at,
            type: (msg as any).type || 'regular',
            parent_id: (msg as any).parent_id,
            quoted_message_id: (msg as any).quoted_message_id,
            mentioned_users: (msg as any).mentioned_users,
            mentioned_all: (msg as any).mentioned_all,
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
