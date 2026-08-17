// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CAN_BINARY_MAGIC, computeCrc32 } from '../common/can-protocol';

/** Numeric interpretations of a CAN payload field that can be plotted over time. */
export type ValueFieldType =
    | 'UINT' | 'INT'
    | 'UINT8' | 'INT8'
    | 'UINT16' | 'INT16'
    | 'UINT32' | 'INT32'
    | 'FLOAT32' | 'FLOAT64';

export const VALUE_FIELD_TYPES: readonly ValueFieldType[] = Object.freeze([
    'UINT', 'INT', 'UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32', 'FLOAT32', 'FLOAT64'
]);

/** How a byte range inside a CAN payload is interpreted as one numeric value. */
export interface ValueFieldConfig {
    /** First byte of the field inside the payload. */
    readonly startByte: number;
    /** Field length in bytes (1-8). */
    readonly byteLength: number;
    /** Numeric interpretation of the selected bytes. */
    readonly type: ValueFieldType;
    /** Byte order for multi-byte fields. */
    readonly littleEndian: boolean;
    /** The decoded value is divided by this factor before plotting. */
    readonly divisor: number;
}

/**
 * Complete description of a tracked signal: which CAN message carries it and
 * how its payload field is decoded. `interfaces` restricts the accepted source
 * interfaces; an empty list accepts every interface.
 */
export interface ValueSignalConfig extends ValueFieldConfig {
    /** CAN identifier to track. */
    readonly id: number;
    /** Extended (29-bit) identifier. */
    readonly extended: boolean;
    /** Interface names accepted; empty array accepts every interface. */
    readonly interfaces: readonly string[];
}

/** A single plotted point: capture timestamp (ms) and decoded value. */
export interface ValueSample {
    readonly t: number;
    readonly v: number;
}

/** Required selection length in bytes for fixed-size types, undefined for flexible UINT/INT. */
export function requiredBytesForType(type: ValueFieldType): number | undefined {
    switch (type) {
        case 'UINT8': case 'INT8': return 1;
        case 'UINT16': case 'INT16': return 2;
        case 'UINT32': case 'INT32': case 'FLOAT32': return 4;
        case 'FLOAT64': return 8;
        case 'UINT': case 'INT': return undefined;
    }
}

/** Returns a human-readable validation error, or undefined when the field config is usable. */
export function validateFieldConfig(config: ValueFieldConfig): string | undefined {
    if (!Number.isInteger(config.startByte) || config.startByte < 0) {
        return 'Start byte must be a non-negative integer';
    }
    if (!Number.isInteger(config.byteLength) || config.byteLength < 1 || config.byteLength > 8) {
        return 'Field length must be between 1 and 8 bytes';
    }
    if (!Number.isFinite(config.divisor) || config.divisor <= 0) {
        return 'Divisor must be a positive number';
    }
    const required = requiredBytesForType(config.type);
    if (required !== undefined && config.byteLength !== required) {
        return `${config.type} requires a selection of exactly ${required} bytes`;
    }
    return undefined;
}

/**
 * Decodes one numeric value from a CAN payload according to the field config.
 * Returns undefined when the range is outside the payload or the config is invalid.
 */
export function extractSignalValue(
    data: readonly number[] | Uint8Array,
    config: ValueFieldConfig
): number | undefined {
    const { startByte, byteLength, type, littleEndian, divisor } = config;
    if (!Number.isInteger(startByte) || startByte < 0) { return undefined; }
    if (!Number.isInteger(byteLength) || byteLength < 1) { return undefined; }
    if (!Number.isFinite(divisor) || divisor <= 0) { return undefined; }
    if (startByte + byteLength > data.length) { return undefined; }

    if (type === 'UINT' || type === 'INT') {
        if (byteLength > 8) { return undefined; }
        let value = 0n;
        for (let i = 0; i < byteLength; i++) {
            const byte = data[startByte + (littleEndian ? byteLength - 1 - i : i)] & 0xFF;
            value = (value << 8n) | BigInt(byte);
        }
        if (type === 'INT' && (value & (1n << BigInt(byteLength * 8 - 1))) !== 0n) {
            value -= 1n << BigInt(byteLength * 8);
        }
        return Number(value) / divisor;
    }

    const required = requiredBytesForType(type);
    if (required === undefined || byteLength !== required) { return undefined; }
    const bytes = new Uint8Array(required);
    for (let i = 0; i < required; i++) {
        bytes[i] = data[startByte + i] & 0xFF;
    }
    const view = new DataView(bytes.buffer);
    switch (type) {
        case 'UINT8': return view.getUint8(0) / divisor;
        case 'INT8': return view.getInt8(0) / divisor;
        case 'UINT16': return view.getUint16(0, littleEndian) / divisor;
        case 'INT16': return view.getInt16(0, littleEndian) / divisor;
        case 'UINT32': return view.getUint32(0, littleEndian) / divisor;
        case 'INT32': return view.getInt32(0, littleEndian) / divisor;
        case 'FLOAT32': return view.getFloat32(0, littleEndian) / divisor;
        case 'FLOAT64': return view.getFloat64(0, littleEndian) / divisor;
        default: return undefined;
    }
}

/**
 * Pre-allocated ring of (time, value) pairs backed by typed arrays.
 * Zero allocation after construction; overwrites the oldest samples when full.
 */
export class ValueSampleStore {
    protected readonly times: Float64Array;
    protected readonly values: Float64Array;
    protected head = 0;
    protected count = 0;

    constructor(protected readonly capacity: number = 8192) {
        this.times = new Float64Array(this.capacity);
        this.values = new Float64Array(this.capacity);
    }

    /** Append a sample, overwriting the oldest one when full. */
    push(time: number, value: number): void {
        const idx = (this.head + this.count) % this.capacity;
        this.times[idx] = time;
        this.values[idx] = value;
        if (this.count < this.capacity) {
            this.count++;
        } else {
            this.head = (this.head + 1) % this.capacity;
        }
    }

    get size(): number {
        return this.count;
    }

    /** Timestamp of the i-th sample in chronological order (0 = oldest). */
    timeAt(index: number): number {
        return this.times[(this.head + index) % this.capacity];
    }

    /** Value of the i-th sample in chronological order (0 = oldest). */
    valueAt(index: number): number {
        return this.values[(this.head + index) % this.capacity];
    }

    /** Timestamp of the most recent sample, or undefined when empty. */
    lastTime(): number | undefined {
        return this.count > 0 ? this.timeAt(this.count - 1) : undefined;
    }

    /** Remove all samples without deallocating the backing arrays. */
    clear(): void {
        this.head = 0;
        this.count = 0;
    }
}

const valueInterfaceDecoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : undefined;

/**
 * Scans a binary CAN batch (lossless envelope format, see `can-protocol.ts`)
 * for frames matching the signal identity and extracts their decoded value.
 * Allocation-free on the scan path; invokes `onSample` with (timestamp ms, value)
 * for every matching frame. Returns the number of samples extracted.
 */
export function extractSamplesFromChunk(
    chunk: ArrayBuffer | Uint8Array,
    config: ValueSignalConfig,
    onSample: (timeMs: number, value: number) => void
): number {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    if (bytes.byteLength < 12) { return 0; }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== CAN_BINARY_MAGIC) { return 0; }
    const expectedCrc = view.getUint32(8, true);
    if (expectedCrc !== computeCrc32(bytes, 12)) { return 0; }

    const count = view.getUint32(4, true);
    let extracted = 0;
    let offset = 12;
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
        const ifaceOffset = offset;
        offset += ifaceLen;

        if (!rtr && id === config.id && extended === config.extended) {
            if (config.interfaces.length === 0 || interfaceNameMatches(bytes, ifaceOffset, ifaceLen, config.interfaces)) {
                const payload = bytes.subarray(offset, offset + dlc);
                const value = extractSignalValue(payload, config);
                if (value !== undefined && Number.isFinite(value)) {
                    onSample(timestamp, value);
                    extracted++;
                }
            }
        }
        offset += dlc;
    }
    return extracted;
}

function interfaceNameMatches(
    bytes: Uint8Array,
    offset: number,
    length: number,
    interfaces: readonly string[]
): boolean {
    if (interfaces.length === 1) {
        const expected = interfaces[0];
        if (expected.length !== length) { return false; }
        for (let i = 0; i < length; i++) {
            if (bytes[offset + i] !== expected.charCodeAt(i)) { return false; }
        }
        return true;
    }
    if (!valueInterfaceDecoder) { return false; }
    const name = valueInterfaceDecoder.decode(bytes.subarray(offset, offset + length));
    return interfaces.includes(name);
}
