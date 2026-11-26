import { electroview } from '.';
import type { InventoryDelta, InventoryDeltaResult } from '../../types/inventory-delta';

type NewInventoryDelta = InventoryDelta extends infer Delta
    ? Delta extends InventoryDelta
        ? Omit<Delta, 'id' | 'timestamp'>
        : never
    : never;

const queueStorageKey = 'playpen.store.inventory-deltas.v1';
const timestampStorageKey = 'playpen.store.inventory-delta-timestamp.v1';
let flushOperation: Promise<Map<string, InventoryDeltaResult>> | null = null;

function decodeBigInts(_key: string, value: unknown): unknown {
    if (
        typeof value === 'object' &&
        value !== null &&
        '__inventoryBigInt' in value &&
        typeof value.__inventoryBigInt === 'string'
    ) {
        return BigInt(value.__inventoryBigInt);
    }
    return value;
}

function encodeBigInts(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? { __inventoryBigInt: value.toString() } : value;
}

function readQueue(): InventoryDelta[] {
    const stored = window.localStorage.getItem(queueStorageKey);
    if (!stored) return [];
    const parsed: unknown = JSON.parse(stored, decodeBigInts);
    if (
        !Array.isArray(parsed) ||
        parsed.some(delta =>
            typeof delta !== 'object' ||
            delta === null ||
            typeof delta.id !== 'string' ||
            !Number.isSafeInteger(delta.timestamp)
        )
    ) {
        throw new Error('The saved inventory delta queue is invalid.');
    }
    return parsed as InventoryDelta[];
}

function writeQueue(queue: InventoryDelta[]): void {
    window.localStorage.setItem(queueStorageKey, JSON.stringify(queue, encodeBigInts));
}

function nextTimestamp(queue: InventoryDelta[]): number {
    const storedPrevious = window.localStorage.getItem(timestampStorageKey);
    const previous = storedPrevious === null ? 0 : Number(storedPrevious);
    if (!Number.isSafeInteger(previous) || previous < 0) {
        throw new Error('The saved inventory delta timestamp is invalid.');
    }
    const timestamp = Math.max(Date.now(), previous + 1, ...queue.map(delta => delta.timestamp + 1));
    if (!Number.isSafeInteger(timestamp)) throw new Error('An inventory delta timestamp could not be generated.');
    window.localStorage.setItem(timestampStorageKey, String(timestamp));
    return timestamp;
}

export async function enqueueInventoryDelta(delta: NewInventoryDelta): Promise<InventoryDeltaResult> {
    const queue = readQueue();
    const timestamp = nextTimestamp(queue);
    const completeDelta = {
        ...delta,
        id: crypto.randomUUID(),
        timestamp
    } as InventoryDelta;
    writeQueue([...queue, completeDelta]);

    try {
        const results = await flushQueuedDeltas();
        const result = results.get(completeDelta.id);
        if (!result) throw new Error('The database is not ready to apply the change.');
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`The change is saved in the local queue and will retry when the database is available: ${message}`);
    }
}

function flushQueuedDeltas(): Promise<Map<string, InventoryDeltaResult>> {
    if (flushOperation) return flushOperation;

    const applyDelta = electroview.rpc?.request?.applyInventoryDelta;
    if (!applyDelta) {
        return Promise.resolve(new Map<string, InventoryDeltaResult>());
    }

    flushOperation = (async () => {
        const results = new Map<string, InventoryDeltaResult>();
        while (true) {
            const queue = readQueue();
            const delta = queue[0];
            if (!delta) break;

            const currentApplyDelta = electroview.rpc?.request?.applyInventoryDelta;
            if (!currentApplyDelta) break;

            const result = await currentApplyDelta(delta);
            if (!result || !['applied', 'stale', 'duplicate'].includes(result.status)) {
                throw new Error('The database returned an invalid inventory delta result.');
            }
            results.set(delta.id, result);
            const latestQueue = readQueue();
            writeQueue(latestQueue.filter(pending => pending.id !== delta.id));
        }
        return results;
    })().finally(() => {
        flushOperation = null;
    });

    return flushOperation;
}

export async function flushInventoryDeltas(): Promise<void> {
    await flushQueuedDeltas();
}

export function clearInventoryDeltas(): void {
    window.localStorage.removeItem(queueStorageKey);
    window.localStorage.removeItem(timestampStorageKey);
}

window.addEventListener('online', () => {
    void flushInventoryDeltas().catch(error => console.error('Failed to flush inventory deltas:', error));
});
window.addEventListener('storeLoaded', () => {
    void flushInventoryDeltas().catch(error => console.error('Failed to flush inventory deltas:', error));
});
window.setInterval(() => {
    void flushInventoryDeltas().catch(error => console.error('Failed to flush inventory deltas:', error));
}, 15000);
