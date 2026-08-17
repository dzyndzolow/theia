// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

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
}

/*
 * This worker is kept self-contained because a Theia frontend extension is
 * bundled as CommonJS, whereas a Blob worker has no module loader. It receives
 * an owned binary batch, validates and decodes it, then posts only changed
 * matrix rows back to the renderer.
 */
export const CAN_MATRIX_WORKER_SOURCE = `
(() => {
    const MAGIC = 0x43414E30;
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

    function updateRow(frame) {
        const key = frame.interface + ':' + (frame.extended ? 'extended' : 'standard') + ':' + frame.id + ':' + frame.dlc;
        const receivedAt = Date.now();
        const existing = rows.get(key);
        if (!existing) {
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
                lastTimestamp: receivedAt,
                deltaMs: 0,
                freqHz: 0,
                interface: frame.interface,
                rowLastChangedMs: 0
            };
            rows.set(key, created);
            return created;
        }
        const previous = existing.data;
        const changedMask = frame.data.map((byte, index) => previous[index] !== byte);
        const changed = changedMask.some(Boolean);
        const deltaMs = Math.max(0, receivedAt - existing.lastTimestamp);
        
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
        existing.freqHz = deltaMs > 0 ? Math.round(1000 / deltaMs) : 0;
        existing.lastTimestamp = receivedAt;
        existing.rowLastChangedMs = changed ? receivedAt : existing.rowLastChangedMs;
        return existing;
    }

    function processBatch(buffer) {
        const bytes = new Uint8Array(buffer);
        if (bytes.byteLength < 12) return [];
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint32(0, true) !== MAGIC || view.getUint32(8, true) !== crc32(bytes, 12)) return [];
        const updateByKey = new Map();
        const count = view.getUint32(4, true);
        let offset = 12;
        for (let index = 0; index < count; index++) {
            if (offset + 14 > bytes.byteLength) break;
            offset += 8; // timestamp
            const idFlags = view.getUint32(offset, true);
            offset += 4;
            const dlc = view.getUint8(offset++);
            const interfaceLength = view.getUint8(offset++);
            if (offset + interfaceLength + dlc > bytes.byteLength) break;
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
                interface: iface
            });
            updateByKey.set(row.key, row);
        }
        return Array.from(updateByKey.values());
    }

    self.onmessage = event => {
        const message = event.data;
        if (message.type === 'RESET') {
            rows.clear();
            return;
        }
        if (message.type === 'PROCESS_BATCH' && message.chunk instanceof ArrayBuffer) {
            self.postMessage({ type: 'UPDATES', updates: processBatch(message.chunk) });
        }
    };
})();
`;
