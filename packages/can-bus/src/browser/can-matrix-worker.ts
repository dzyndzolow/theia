// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CAN_MATRIX_MAX_ROWS } from '../common/can-retention-policy';

/** Re-exported shared maximum number of rows retained by the CAN Matrix. */
export { CAN_MATRIX_MAX_ROWS };

/** A compact matrix update produced off the UI thread. */
export interface CanMatrixWorkerUpdate {
    readonly key: string;
    readonly id: number;
    readonly extended: boolean;
    readonly rtr: boolean;
    readonly dlc: number;
    readonly data: number[];
    readonly prevData: number[];
    readonly changedMask: boolean[];
    readonly changeCounts: number[];  // per-byte change counters
    readonly lastChangedMs: number[]; // per-byte last-change timestamps
    readonly count: number;
    readonly lastTimestamp: number;
    readonly deltaMs: number;
    readonly freqHz: number;
    readonly interface: string;
    readonly rowLastChangedMs: number; // row-level last change time (for row fade)
}

export interface CanMatrixWorkerResponse {
    readonly type: 'UPDATES';
    readonly updates: CanMatrixWorkerUpdate[];
    readonly evictedKeys?: string[];
}

/*
 * This worker is kept self-contained because a Theia frontend extension is
 * bundled as CommonJS, whereas a Blob worker has no module loader. It receives
 * an owned binary batch, validates and decodes it, then posts only changed
 * matrix rows back to the renderer.
 */
export const CAN_MATRIX_WORKER_SOURCE = `
(() => {
    const MAGIC_0 = 0x43414E30;
    const MAGIC_1 = 0x43414E31;
    const MAX_ROWS = ${CAN_MATRIX_MAX_ROWS};
    const rows = new Map();
    const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined;

    function crc32(bytes, offset) {
        let crc = 0xFFFFFFFF;
        for (let index = offset; index < bytes.length; index++) {
            crc ^= bytes[index];
            for (let bit = 0; bit < 8; bit++) {
                crc = (crc >>> 1) ^ ((crc & 1) ? 0xEDB88320 : 0);
            }
        }
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function decodeInterface(bytes, offset, length) {
        if (length === 0) return '';
        if (decoder) return decoder.decode(bytes.subarray(offset, offset + length));
        let result = '';
        for (let index = 0; index < length; index++) result += String.fromCharCode(bytes[offset + index]);
        return result;
    }

    function updateRow(frame, evictedKeysSet) {
        const key = frame.interface + ':' + (frame.extended ? 'extended' : 'standard') + ':' + frame.id + ':' + frame.dlc;
        const receivedAt = Date.now();
        const frameTime = typeof frame.timestamp === 'number' && Number.isFinite(frame.timestamp) ? frame.timestamp : receivedAt;
        const existing = rows.get(key);
        if (!existing) {
            while (rows.size >= MAX_ROWS) {
                const oldestKey = rows.keys().next().value;
                if (oldestKey === undefined) break;
                rows.delete(oldestKey);
                evictedKeysSet.add(oldestKey);
            }
            evictedKeysSet.delete(key);
            // First frame: no change highlighting
            const created = {
                key: key,
                id: frame.id,
                extended: frame.extended,
                rtr: frame.rtr,
                dlc: frame.dlc,
                data: frame.data,
                prevData: frame.data.slice(),
                changedMask: frame.data.map(() => false),
                changeCounts: frame.data.map(() => 0),
                lastChangedMs: frame.data.map(() => 0),
                count: 1,
                lastTimestamp: frameTime,
                deltaMs: 0,
                freqHz: 0,
                interface: frame.interface,
                rowLastChangedMs: 0
            };
            rows.set(key, created);
            return created;
        }

        // LRU refresh
        rows.delete(key);
        evictedKeysSet.delete(key);
        const previous = existing.data;
        const changedMask = frame.data.map((byte, index) => previous[index] !== byte);
        const changed = changedMask.some(Boolean);
        const deltaMs = Number(Math.max(0, frameTime - existing.lastTimestamp).toFixed(3));
        const freqHz = deltaMs > 0 ? Number((1000 / deltaMs).toFixed(3)) : 0;
        
        // Update per-byte change counts and timestamps
        const newChangeCounts = existing.changeCounts.map((count, index) =>
            changedMask[index] ? count + 1 : count
        );
        const newLastChangedMs = existing.lastChangedMs.map((ts, index) =>
            changedMask[index] ? receivedAt : ts
        );
        
        existing.prevData = previous;
        existing.data = frame.data;
        existing.changedMask = changedMask;
        existing.changeCounts = newChangeCounts;
        existing.lastChangedMs = newLastChangedMs;
        existing.count++;
        existing.deltaMs = deltaMs;
        existing.freqHz = freqHz;
        existing.lastTimestamp = frameTime;
        existing.rowLastChangedMs = changed ? receivedAt : existing.rowLastChangedMs;
        rows.set(key, existing);
        return existing;
    }

    function validateBatch(view, bytesLength, count, version) {
        let offset = 12;
        for (let i = 0; i < count; i++) {
            if (offset + 15 > bytesLength) return false;
            const dlc = view.getUint8(offset + 12);
            const ifaceLen = view.getUint16(offset + 13, true);
            offset += 15;
            if (offset + ifaceLen + dlc > bytesLength) return false;
            offset += ifaceLen + dlc;
        }
        if (version === 1) {
            for (let i = 0; i < count; i++) {
                if (offset + 6 > bytesLength) return false;
                const sLen = view.getUint16(offset, true);
                const cLen = view.getUint16(offset + 2, true);
                const srcLen = view.getUint16(offset + 4, true);
                offset += 6 + sLen + cLen + srcLen;
                if (offset > bytesLength) return false;
            }
        }
        return offset === bytesLength;
    }

    function processBatch(buffer) {
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength < 12) return { updates: [], evictedKeys: [] };
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const magic = view.getUint32(0, true);
        if (magic !== MAGIC_0 && magic !== MAGIC_1) return { updates: [], evictedKeys: [] };
        const version = magic === MAGIC_1 ? 1 : 0;
        if (view.getUint32(8, true) !== crc32(bytes, 12)) return { updates: [], evictedKeys: [] };
        const count = view.getUint32(4, true);
        if (!validateBatch(view, bytes.byteLength, count, version)) return { updates: [], evictedKeys: [] };

        const updateByKey = new Map();
        const evictedKeysSet = new Set();
        let offset = 12;
        for (let index = 0; index < count; index++) {
            const timestamp = view.getFloat64(offset, true);
            offset += 8;
            const idFlags = view.getUint32(offset, true);
            offset += 4;
            const dlc = view.getUint8(offset++);
            const interfaceLength = view.getUint16(offset, true);
            offset += 2;
            const iface = decodeInterface(bytes, offset, interfaceLength);
            offset += interfaceLength;
            const data = Array.from(bytes.subarray(offset, offset + dlc));
            offset += dlc;
            const row = updateRow({
                id: idFlags & 0x1FFFFFFF,
                extended: (idFlags & 0x80000000) !== 0,
                rtr: (idFlags & 0x40000000) !== 0,
                dlc: dlc,
                data: data,
                interface: iface,
                timestamp: timestamp
            }, evictedKeysSet);
            updateByKey.set(row.key, row);
        }
        for (const evictedKey of evictedKeysSet) {
            updateByKey.delete(evictedKey);
        }
        return { updates: Array.from(updateByKey.values()), evictedKeys: Array.from(evictedKeysSet) };
    }

    self.onmessage = event => {
        const message = event.data;
        if (message.type === 'RESET') {
            rows.clear();
            return;
        }
        if (message.type === 'PROCESS_BATCH' && message.chunk instanceof ArrayBuffer) {
            const batchResult = processBatch(message.chunk);
            self.postMessage({
                type: 'UPDATES',
                updates: batchResult.updates,
                evictedKeys: batchResult.evictedKeys
            });
        }
    };
})();
`;

import { validateCanBinaryBatch, decodeInterfaceName } from '../common/can-protocol';

/**
 * Direct evaluation helper for Node/unit-test environments where Web Worker
 * threads are not available. Applies the identical batch validation and matrix grouping.
 */
export function processMatrixBatchDirect(
    buffer: ArrayBuffer | Uint8Array,
    existingRows: Map<string, CanMatrixWorkerUpdate> = new Map(),
    maxRows = CAN_MATRIX_MAX_ROWS
): CanMatrixWorkerUpdate[] {
    if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > CAN_MATRIX_MAX_ROWS) {
        throw new RangeError(`maxRows must be a safe integer between 1 and ${CAN_MATRIX_MAX_ROWS}. Received: ${maxRows}`);
    }

    const validation = validateCanBinaryBatch(buffer);
    if (!validation.valid) {
        return [];
    }
    const count = validation.advertisedCount;
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const updateByKey = new Map<string, CanMatrixWorkerUpdate>();

    let offset = 12;
    for (let index = 0; index < count; index++) {
        const timestamp = view.getFloat64(offset, true);
        offset += 8;
        const idFlags = view.getUint32(offset, true);
        offset += 4;
        const dlc = view.getUint8(offset++);
        const interfaceLength = view.getUint16(offset, true);
        offset += 2;
        const iface = decodeInterfaceName(bytes, offset, interfaceLength);
        offset += interfaceLength;
        const data = Array.from(bytes.subarray(offset, offset + dlc));
        offset += dlc;

        const extended = (idFlags & (1 << 31)) !== 0;
        const rtr = (idFlags & (1 << 30)) !== 0;
        const id = idFlags & 0x1FFFFFFF;
        const key = `${iface}:${extended ? 'extended' : 'standard'}:${id}:${dlc}`;
        const receivedAt = Date.now();
        const frameTime = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : receivedAt;

        let row = existingRows.get(key);
        if (!row) {
            while (existingRows.size >= maxRows) {
                const oldest = existingRows.keys().next().value;
                if (oldest === undefined) {
                    break;
                }
                existingRows.delete(oldest);
                updateByKey.delete(oldest);
            }
            row = {
                key,
                id,
                extended,
                rtr,
                dlc,
                data,
                prevData: data.slice(),
                changedMask: data.map(() => false),
                changeCounts: data.map(() => 0),
                lastChangedMs: data.map(() => 0),
                count: 1,
                lastTimestamp: frameTime,
                deltaMs: 0,
                freqHz: 0,
                interface: iface,
                rowLastChangedMs: 0
            };
            existingRows.set(key, row);
        } else {
            existingRows.delete(key);
            const previous = row.data;
            const changedMask = data.map((byte, i) => previous[i] !== byte);
            const changed = changedMask.some(Boolean);
            const deltaMs = Number(Math.max(0, frameTime - row.lastTimestamp).toFixed(3));
            const freqHz = deltaMs > 0 ? Number((1000 / deltaMs).toFixed(3)) : 0;
            const newChangeCounts = row.changeCounts.map((c, i) => changedMask[i] ? c + 1 : c);
            const newLastChangedMs = row.lastChangedMs.map((ts, i) => changedMask[i] ? receivedAt : ts);

            row = {
                ...row,
                prevData: previous,
                data,
                changedMask,
                changeCounts: newChangeCounts,
                lastChangedMs: newLastChangedMs,
                count: row.count + 1,
                deltaMs,
                freqHz,
                lastTimestamp: frameTime,
                rowLastChangedMs: changed ? receivedAt : row.rowLastChangedMs
            };
            existingRows.set(key, row);
        }
        updateByKey.set(key, row);
    }
    return Array.from(updateByKey.values());
}
