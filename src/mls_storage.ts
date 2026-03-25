/**
 * MLS Storage — Persistence layer for MLS (E2EE) state
 *
 * Defines the `MlsStorageAdapter` interface for platform abstraction
 * and provides `IndexedDBMlsStorage` as the default browser implementation.
 *
 * Stores:
 * - Device ID (per browser)
 * - Identity bytes (per user+device)
 * - E2EE messages (per channel)
 * - Group CID markers
 * - Provider key store
 * - Sync timestamps
 */

import { randomId } from './utils';

// ============================================================
// Storage Adapter Interface
// ============================================================

export interface E2eeStoredMessage {
  // Core identity
  id: string;
  cid: string;
  /** 'mls' for encrypted E2EE messages, 'standard' for plaintext (system messages, etc.) */
  content_type: 'mls' | 'standard';
  /** Message type: 'regular' | 'reply' | 'system' etc. */
  type: string;
  created_at: string;

  // Sender
  user_id: string;
  user?: { id: string; name?: string; image?: string; [key: string]: unknown };

  // Decrypted content (MessageContent::Standard)
  text: string;
  attachments?: unknown[];
  sticker_url?: string;
  poll_type?: string;
  poll_choice_counts?: Record<string, number>;
  latest_poll_choices?: unknown[];

  // Thread / reply routing
  parent_id?: string;
  quoted_message_id?: string;
  quoted_message?: unknown;

  // Notification metadata
  mentioned_users?: string[];
  mentioned_all?: boolean;

  // State
  pinned?: boolean;
  pinned_at?: string;
  reaction_counts?: Record<string, number>;
  latest_reactions?: unknown[];

  // Catch-all for future fields
  [key: string]: unknown;
}

/**
 * Platform-agnostic storage adapter for MLS state.
 *
 * Implement this interface to provide custom storage (e.g., SQLite for React Native).
 * The default `IndexedDBMlsStorage` uses browser IndexedDB.
 */
export interface MlsStorageAdapter {
  // ---- Device ID ----
  getDeviceId(): Promise<string>;

  // ---- Identity ----
  saveIdentity(userId: string, deviceId: string, identityBytes: Uint8Array): Promise<void>;
  loadIdentity(userId: string, deviceId: string): Promise<Uint8Array | null>;

  // ---- E2EE Messages ----
  saveE2eeMessage(message: E2eeStoredMessage): Promise<void>;
  loadE2eeMessage(messageId: string): Promise<E2eeStoredMessage | null>;
  getE2eeMessages(cid: string, limit?: number): Promise<E2eeStoredMessage[]>;
  clearE2eeMessages(cid: string): Promise<void>;

  // ---- Group State ----
  saveGroupState(cid: string, marker: unknown): Promise<void>;
  loadGroupState(cid: string): Promise<unknown | null>;
  listGroupCids(): Promise<string[]>;

  // ---- Provider State ----
  saveProviderState(userId: string, deviceId: string, providerBytes: Uint8Array): Promise<void>;
  loadProviderState(userId: string, deviceId: string): Promise<Uint8Array | null>;

  // ---- Sync Timestamps ----
  saveSyncTimestamp(cid: string, timestamp: string): Promise<void>;
  loadSyncTimestamp(cid: string): Promise<string | null>;

  // ---- Batch Sync Cursors (for unified sync API) ----
  loadAllSyncTimestamps(): Promise<Record<string, string>>;
  saveAllSyncTimestamps(cursors: Record<string, string>): Promise<void>;
}

// ============================================================
// IndexedDB Implementation (Browser Default)
// ============================================================

const DB_NAME = 'ermis_mls';
const DB_VERSION = 2;

const STORE_IDENTITY = 'identity';
const STORE_MESSAGES = 'messages';
const STORE_META = 'meta';
const STORE_GROUPS = 'groups';

/**
 * Default MLS storage adapter using browser IndexedDB.
 *
 * @example
 * ```ts
 * const storage = new IndexedDBMlsStorage();
 * const deviceId = await storage.getDeviceId();
 * ```
 */
export class IndexedDBMlsStorage implements MlsStorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  /**
   * Open (or create) the IndexedDB database.
   * Caches the connection promise for reuse.
   */
  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Identity store: key = "userId:deviceId"
        if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
          db.createObjectStore(STORE_IDENTITY);
        }

        // Messages store: key = message id, indexes by cid
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const msgStore = db.createObjectStore(STORE_MESSAGES, {
            keyPath: 'id',
          });
          msgStore.createIndex('cid', 'cid', { unique: false });
          msgStore.createIndex('cid_created', ['cid', 'created_at'], { unique: false });
        }

        // Meta store: key-value for device_id, provider state, sync timestamps
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META);
        }

        // Groups store: key = cid → marker
        if (!db.objectStoreNames.contains(STORE_GROUPS)) {
          db.createObjectStore(STORE_GROUPS);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error);
      };
    });

    return this.dbPromise;
  }

  // ---- Device ID ----

  async getDeviceId(): Promise<string> {
    const db = await this.openDB();
    return new Promise<string>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get('device_id');

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as string);
        } else {
          // Generate new device ID using SDK's randomId utility
          const deviceId = `web-${randomId()}`;
          const writeTx = db.transaction(STORE_META, 'readwrite');
          const writeStore = writeTx.objectStore(STORE_META);
          writeStore.put(deviceId, 'device_id');
          writeTx.oncomplete = () => resolve(deviceId);
          writeTx.onerror = () => reject(writeTx.error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Identity ----

  async saveIdentity(userId: string, deviceId: string, identityBytes: Uint8Array): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_IDENTITY, 'readwrite');
      const store = tx.objectStore(STORE_IDENTITY);
      store.put(identityBytes, `${userId}:${deviceId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadIdentity(userId: string, deviceId: string): Promise<Uint8Array | null> {
    const db = await this.openDB();
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE_IDENTITY, 'readonly');
      const store = tx.objectStore(STORE_IDENTITY);
      const request = store.get(`${userId}:${deviceId}`);
      request.onsuccess = () => resolve((request.result as Uint8Array) || null);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- E2EE Messages ----

  async saveE2eeMessage(message: E2eeStoredMessage): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = tx.objectStore(STORE_MESSAGES);
      store.put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadE2eeMessage(messageId: string): Promise<E2eeStoredMessage | null> {
    const db = await this.openDB();
    return new Promise<E2eeStoredMessage | null>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const store = tx.objectStore(STORE_MESSAGES);
      const request = store.get(messageId);
      request.onsuccess = () => resolve((request.result as E2eeStoredMessage) || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getE2eeMessages(cid: string, limit = 50): Promise<E2eeStoredMessage[]> {
    const db = await this.openDB();
    return new Promise<E2eeStoredMessage[]>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const store = tx.objectStore(STORE_MESSAGES);
      const index = store.index('cid');
      const request = index.getAll(cid);
      request.onsuccess = () => {
        const msgs = (request.result as E2eeStoredMessage[]) || [];
        // Sort by created_at descending, take limit
        msgs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        resolve(msgs.slice(0, limit));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async clearE2eeMessages(cid: string): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = tx.objectStore(STORE_MESSAGES);
      const index = store.index('cid');
      const request = index.openCursor(cid);
      request.onsuccess = (event: Event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ---- Group State ----

  async saveGroupState(cid: string, marker: unknown): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_GROUPS, 'readwrite');
      const store = tx.objectStore(STORE_GROUPS);
      store.put(marker, cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadGroupState(cid: string): Promise<unknown | null> {
    const db = await this.openDB();
    return new Promise<unknown | null>((resolve, reject) => {
      const tx = db.transaction(STORE_GROUPS, 'readonly');
      const store = tx.objectStore(STORE_GROUPS);
      const request = store.get(cid);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async listGroupCids(): Promise<string[]> {
    const db = await this.openDB();
    return new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_GROUPS, 'readonly');
      const store = tx.objectStore(STORE_GROUPS);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve((request.result as string[]) || []);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Provider State ----

  async saveProviderState(userId: string, deviceId: string, providerBytes: Uint8Array): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      store.put(providerBytes, `provider:${userId}:${deviceId}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadProviderState(userId: string, deviceId: string): Promise<Uint8Array | null> {
    const db = await this.openDB();
    return new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get(`provider:${userId}:${deviceId}`);
      request.onsuccess = () => resolve((request.result as Uint8Array) || null);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Sync Timestamps ----

  async saveSyncTimestamp(cid: string, timestamp: string): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      store.put(timestamp, `sync:${cid}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async loadSyncTimestamp(cid: string): Promise<string | null> {
    const db = await this.openDB();
    return new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get(`sync:${cid}`);
      request.onsuccess = () => resolve((request.result as string) || null);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- Batch Sync Cursors ----

  async loadAllSyncTimestamps(): Promise<Record<string, string>> {
    const db = await this.openDB();
    return new Promise<Record<string, string>>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const cursors: Record<string, string> = {};
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const key = cursor.key as string;
          if (key.startsWith('sync:')) {
            const cid = key.slice(5); // Remove 'sync:' prefix
            cursors[cid] = cursor.value as string;
          }
          cursor.continue();
        } else {
          resolve(cursors);
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  async saveAllSyncTimestamps(timestamps: Record<string, string>): Promise<void> {
    const db = await this.openDB();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      const store = tx.objectStore(STORE_META);
      for (const [cid, ts] of Object.entries(timestamps)) {
        store.put(ts, `sync:${cid}`);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
