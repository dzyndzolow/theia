// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

/** Standard CAN frame (11-bit or 29-bit ID) */
export interface CanFrame {
    /** CAN identifier */
    id: number;
    /** true = extended 29-bit ID, false = standard 11-bit ID */
    extended: boolean;
    /** true = remote transmission request */
    rtr: boolean;
    /** Data payload (0-8 bytes for classical CAN, up to 64 for CAN FD) */
    data: number[];
    /** Data Length Code */
    dlc: number;
    /** Timestamp in milliseconds since capture start */
    timestamp: number;
    /** Interface name (e.g. 'can0', 'vcan0') */
    interface: string;
}

import { ProtocolAnnotation } from '@theia/signal-core';

export function canFrameToAnnotation(frame: CanFrame): ProtocolAnnotation {
    return {
        id: `can-${frame.interface}-${frame.id}-${frame.timestamp}`,
        parentId: null,
        level: 0,
        startTimeNs: BigInt(Math.floor(frame.timestamp * 1000000)),
        endTimeNs: BigInt(Math.floor(frame.timestamp * 1000000)),
        type: 'annotation:can',
        summary: `ID=0x${frame.id.toString(16).toUpperCase()} DLC=${frame.dlc}`,
        payload: {
            id: frame.id,
            extended: frame.extended,
            rtr: frame.rtr,
            dlc: frame.dlc,
            data: frame.data,
            interface: frame.interface
        }
    };
}

export function annotationToCanFrame(annotation: ProtocolAnnotation): CanFrame {
    const payload = annotation.payload || {};
    return {
        id: typeof payload.id === 'number' ? payload.id : 0,
        extended: payload.extended === true,
        rtr: payload.rtr === true,
        dlc: typeof payload.dlc === 'number' ? payload.dlc : 0,
        data: Array.isArray(payload.data) ? (payload.data as number[]) : [],
        timestamp: Number(annotation.startTimeNs) / 1000000,
        interface: typeof payload.interface === 'string' ? payload.interface : 'sim0'
    };
}

/** CAN bus interface configuration */
export interface CanInterfaceConfig {
    /** Interface name, e.g. 'can0', 'vcan0' */
    name: string;
    /** Bitrate in bps, e.g. 500000 */
    bitrate: number;
    /** Enable CAN FD */
    fd?: boolean;
    /** Simulator frame rate in frames per second (10-5000) */
    frameRate?: number;
}

/** Filter for CAN frames */
export interface CanFilter {
    /** CAN ID to match */
    id?: number;
    /** Mask applied to ID before comparison (default 0x7FF for 11-bit) */
    mask?: number;
    /** Include only extended frames */
    extended?: boolean;
    /** Include only standard frames */
    standard?: boolean;
    /** Include only data frames (not RTR) */
    dataOnly?: boolean;
}

/** Statistics for the CAN capture session */
export interface CanStatistics {
    totalFrames: number;
    framesPerSecond: number;
    errors: number;
    busLoad: number;
    startTime: number;
    droppedFrames?: number;
}

/** Events emitted by the CAN service */
export const CanServiceEvents = {
    FRAME_RECEIVED: 'frame-received',
    STATISTICS_UPDATED: 'statistics-updated',
    ERROR: 'can-error',
    STATUS_CHANGED: 'status-changed'
} as const;

export type CanServiceEvent = typeof CanServiceEvents[keyof typeof CanServiceEvents];

export const CanBusWidget = {
    ID: 'can-bus-widget',
    LABEL: 'CAN Bus Analyzer'
} as const;

export const canServicePath = '/can-bus/service';

export interface CanRpcClient {
    onDidCloseConnection?(): void;
    onBinaryFrames?(chunk: ArrayBuffer): void;
}

export interface CanRpc {
    startCapture(config: CanInterfaceConfig): Promise<void>;
    stopCapture(interfaceName?: string): Promise<void>;
    getStatistics(): Promise<CanStatistics>;
}

export const CAN_BINARY_MAGIC = 0x43414E30;

// IEEE 802.3 CRC32 lookup table
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    CRC32_TABLE[i] = c >>> 0;
}

export function computeCrc32(buffer: Uint8Array, offset = 0, length = buffer.length - offset): number {
    let crc = 0xFFFFFFFF;
    for (let i = offset; i < offset + length; i++) {
        crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xFF];
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const encoderText = typeof TextEncoder !== 'undefined' ? new TextEncoder() : undefined;
const decoderText = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : undefined;

const ifaceEncodeCache = new Map<string, Uint8Array>();
function getEncodedIface(ifaceStr: string): Uint8Array {
    let cached = ifaceEncodeCache.get(ifaceStr);
    if (!cached) {
        cached = encoderText ? encoderText.encode(ifaceStr) : new Uint8Array(0);
        if (ifaceEncodeCache.size < 64) {
            ifaceEncodeCache.set(ifaceStr, cached);
        }
    }
    return cached;
}

const ifaceDecodeCache = new Map<string, string>();
function getDecodedIface(bytes: Uint8Array, offset: number, len: number): string {
    if (len === 0 || !decoderText) { return 'sim0'; }
    let key = '';
    for (let i = 0; i < len; i++) {
        key += String.fromCharCode(bytes[offset + i]);
    }
    let cached = ifaceDecodeCache.get(key);
    if (!cached) {
        cached = key;
        if (ifaceDecodeCache.size < 64) {
            ifaceDecodeCache.set(key, cached);
        }
    }
    return cached;
}

export class CanBinaryEncoder {
    static encodeBatch(frames: CanFrame[]): ArrayBuffer {
        let payloadSize = 0;
        const encodedIfaces: Uint8Array[] = new Array(frames.length);

        for (let i = 0; i < frames.length; i++) {
            const f = frames[i];
            const ifaceStr = f.interface || 'sim0';
            const ifaceBytes = getEncodedIface(ifaceStr);
            encodedIfaces[i] = ifaceBytes;
            const dlcClamped = Math.min(64, Math.max(0, f.dlc));
            payloadSize += 14 + ifaceBytes.byteLength + dlcClamped;
        }

        const totalSize = 12 + payloadSize;
        const buffer = new ArrayBuffer(totalSize);
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        view.setUint32(0, CAN_BINARY_MAGIC, true);
        view.setUint32(4, frames.length, true);

        let offset = 12;
        for (let i = 0; i < frames.length; i++) {
            const f = frames[i];
            const ifaceBytes = encodedIfaces[i];
            const dlc = Math.min(64, Math.max(0, f.dlc));

            view.setFloat64(offset, f.timestamp, true);
            offset += 8;

            let idFlags = f.id & 0x1FFFFFFF;
            if (f.extended) { idFlags = (idFlags | (1 << 31)) >>> 0; }
            if (f.rtr) { idFlags = (idFlags | (1 << 30)) >>> 0; }
            view.setUint32(offset, idFlags, true);
            offset += 4;

            view.setUint8(offset, dlc);
            offset += 1;

            const ifaceLen = Math.min(255, ifaceBytes.byteLength);
            view.setUint8(offset, ifaceLen);
            offset += 1;

            if (ifaceLen > 0) {
                bytes.set(ifaceBytes.subarray(0, ifaceLen), offset);
                offset += ifaceLen;
            }

            const dataBytes = f.data;
            for (let j = 0; j < dlc; j++) {
                bytes[offset + j] = dataBytes[j] || 0;
            }
            offset += dlc;
        }

        const crc = computeCrc32(bytes, 12, payloadSize);
        view.setUint32(8, crc, true);

        return buffer;
    }
}

export class CanBinaryDecoder {
    static decodeBatch(buffer: ArrayBuffer | Uint8Array, onFrame: (frame: CanFrame) => void): number {
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        if (bytes.byteLength < 12) { return 0; }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        const magic = view.getUint32(0, true);
        if (magic !== CAN_BINARY_MAGIC) { return 0; }

        const count = view.getUint32(4, true);
        const expectedCrc = view.getUint32(8, true);

        const actualCrc = computeCrc32(bytes, 12, bytes.byteLength - 12);
        if (expectedCrc !== actualCrc) { return 0; }

        let offset = 12;
        let actualDecoded = 0;

        for (let i = 0; i < count; i++) {
            if (offset + 14 > bytes.byteLength) { break; }

            const timestamp = view.getFloat64(offset, true);
            offset += 8;

            const idFlags = view.getUint32(offset, true);
            offset += 4;

            const extended = (idFlags & (1 << 31)) !== 0;
            const rtr = (idFlags & (1 << 30)) !== 0;
            const id = idFlags & 0x1FFFFFFF;

            const dlc = view.getUint8(offset);
            offset += 1;

            const ifaceLen = view.getUint8(offset);
            offset += 1;

            if (offset + ifaceLen + dlc > bytes.byteLength) { break; }

            const ifaceStr = getDecodedIface(bytes, offset, ifaceLen);
            offset += ifaceLen;

            const data: number[] = new Array(dlc);
            for (let j = 0; j < dlc; j++) {
                data[j] = bytes[offset + j];
            }
            offset += dlc;

            onFrame({
                id,
                extended,
                rtr,
                dlc,
                data,
                timestamp,
                interface: ifaceStr
            });
            actualDecoded++;
        }

        return actualDecoded;
    }
}

