// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from './can-protocol';

export const TCAN_MAGIC = 0x4E414354; // ASCII "TCAN" in Little Endian
export const TCAN_VERSION_MAJOR = 1;
export const TCAN_VERSION_MINOR = 0;
export const TCAN_HEADER_LENGTH = 32;
export const TCAN_MAX_PAYLOAD_LENGTH = 65535;

export enum TcanMessageType {
    HELLO = 0x01,
    AUTH = 0x02,
    GET_CAPABILITIES = 0x03,
    CONFIGURE_CAN = 0x04,
    START_CAPTURE = 0x05,
    STOP_CAPTURE = 0x06,
    SET_TX_POLICY = 0x08,
    ARM_TX = 0x09,
    DISARM_TX = 0x0A,
    EMERGENCY_STOP = 0x0B,
    TX_BATCH = 0x0C,
    CANCEL_TX = 0x0D,
    GET_STATUS = 0x0E,
    CREDIT = 0x0F,
    TIME_SYNC = 0x10,
    PING = 0x11,
    HEARTBEAT = 0x12,
    OPEN_UDP_RX = 0x13,
    CLOSE_UDP_RX = 0x14,
    RX_BATCH = 0x40,
    TX_RESULT_BATCH = 0x41,
    BUS_STATE = 0x42,
    GAP_EVENT = 0x43,
    DEVICE_EVENT = 0x44
}

export const TCAN_FLAG_RESPONSE = 0x01;
export const TCAN_FLAG_EVENT = 0x02;
export const TCAN_FLAG_ACK_REQUIRED = 0x04;
export const TCAN_FLAG_URGENT = 0x08;
export const TCAN_FLAG_MORE = 0x10;
export const TCAN_FLAG_RETRANSMIT = 0x20;
const TCAN_ALLOWED_FLAGS = 0x3F;

export interface TcanEnvelopeHeader {
    readonly magic: number;
    readonly versionMajor: number;
    readonly versionMinor: number;
    readonly messageType: TcanMessageType;
    readonly flags: number;
    readonly headerLength: number;
    readonly status: number;
    readonly sessionId: number;
    readonly sequence: number;
    readonly requestId: number;
    readonly payloadLength: number;
    readonly headerCrc32c: number;
}

export interface TcanMessage {
    readonly header: TcanEnvelopeHeader;
    readonly payload: Uint8Array;
}

/**
 * Precomputed Castagnoli CRC32C lookup table (polynomial 0x82F63B78).
 */
const CRC32C_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
        crc = (crc & 1) ? (0x82F63B78 ^ (crc >>> 1)) : (crc >>> 1);
    }
    CRC32C_TABLE[i] = crc;
}

export function crc32c(data: Uint8Array, offset = 0, length = data.length): number {
    let crc = 0xFFFFFFFF;
    const end = offset + length;
    for (let i = offset; i < end; i++) {
        crc = CRC32C_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Consistent Overhead Byte Stuffing (COBS) encoder.
 * Encodes data bytes so that 0x00 never appears in the output payload.
 */
export function cobsEncode(src: Uint8Array): Uint8Array {
    const dest = new Uint8Array(src.length + Math.ceil(src.length / 254) + 1);
    let readIdx = 0;
    let writeIdx = 1;
    let codeIdx = 0;
    let code = 1;

    while (readIdx < src.length) {
        const byte = src[readIdx++];
        if (byte === 0) {
            dest[codeIdx] = code;
            codeIdx = writeIdx++;
            code = 1;
        } else {
            dest[writeIdx++] = byte;
            code++;
            if (code === 0xFF) {
                dest[codeIdx] = code;
                codeIdx = writeIdx++;
                code = 1;
            }
        }
    }
    dest[codeIdx] = code;
    return dest.subarray(0, writeIdx);
}

/**
 * Consistent Overhead Byte Stuffing (COBS) decoder.
 */
export function cobsDecode(src: Uint8Array): Uint8Array {
    if (src.length === 0) {
        return new Uint8Array(0);
    }
    const dest = new Uint8Array(src.length);
    let readIdx = 0;
    let writeIdx = 0;

    while (readIdx < src.length) {
        const code = src[readIdx++];
        if (code === 0) {
            throw new Error('Zero byte encountered inside COBS payload');
        }
        for (let i = 1; i < code; i++) {
            if (readIdx >= src.length) {
                throw new Error('Unexpected end of COBS buffer');
            }
            dest[writeIdx++] = src[readIdx++];
        }
        if (code < 0xFF && readIdx < src.length) {
            dest[writeIdx++] = 0;
        }
    }
    return dest.subarray(0, writeIdx);
}

export class TcanCodec {
    /**
     * Serializes a TCAN message to raw bytes including 32-byte header, payload and CRC.
     */
    static encodeMessage(
        messageType: TcanMessageType,
        payload: Uint8Array,
        options: {
            sessionId?: number;
            sequence?: number;
            requestId?: number;
            status?: number;
            flags?: number;
        } = {}
    ): Uint8Array {
        if (payload.length > TCAN_MAX_PAYLOAD_LENGTH) {
            throw new Error(`Payload exceeds maximum length (${payload.length} > ${TCAN_MAX_PAYLOAD_LENGTH})`);
        }
        const flags = options.flags ?? 0;
        if ((flags & ~TCAN_ALLOWED_FLAGS) !== 0
            || (flags & TCAN_FLAG_RESPONSE) !== 0 && (flags & TCAN_FLAG_EVENT) !== 0) {
            throw new Error(`Invalid TCAN envelope flags 0x${flags.toString(16)}`);
        }

        const payloadLength = payload.length;
        const totalLength = TCAN_HEADER_LENGTH + payloadLength + 4;
        const buffer = new Uint8Array(totalLength);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        // 1. Fill Header Fields (Offset 0..27)
        view.setUint32(0, TCAN_MAGIC, true);
        view.setUint8(4, TCAN_VERSION_MAJOR);
        view.setUint8(5, TCAN_VERSION_MINOR);
        view.setUint8(6, messageType);
        view.setUint8(7, flags);
        view.setUint16(8, TCAN_HEADER_LENGTH, true);
        view.setUint16(10, options.status ?? 0, true);
        view.setUint32(12, options.sessionId ?? 0, true);
        view.setUint32(16, options.sequence ?? 0, true);
        view.setUint32(20, options.requestId ?? 0, true);
        view.setUint32(24, payloadLength, true);
        view.setUint32(28, 0, true); // Header CRC field set to 0 during calculation

        // 2. Compute and set Header CRC32C
        const headerCrc = crc32c(buffer, 0, TCAN_HEADER_LENGTH);
        view.setUint32(28, headerCrc, true);

        // 3. Copy Payload
        if (payloadLength > 0) {
            buffer.set(payload, TCAN_HEADER_LENGTH);
        }

        // 4. Compute and set Payload CRC32C
        const payloadCrc = payloadLength > 0 ? crc32c(payload) : 0;
        view.setUint32(TCAN_HEADER_LENGTH + payloadLength, payloadCrc, true);

        return buffer;
    }

    /**
     * Decodes and validates a raw TCAN message buffer.
     * Enforces fail-closed order: Header CRC check BEFORE trusting payloadLength,
     * max payload limit, and exact buffer length matching.
     */
    static decodeMessage(buffer: Uint8Array): TcanMessage {
        if (buffer.length < TCAN_HEADER_LENGTH + 4) {
            throw new Error(`Buffer too short for TCAN envelope (${buffer.length} < 36 bytes)`);
        }

        // 1. Verify Header CRC32C before trusting any header fields
        const headerCopy = new Uint8Array(buffer.subarray(0, TCAN_HEADER_LENGTH));
        const viewCopy = new DataView(headerCopy.buffer, headerCopy.byteOffset);
        const storedHeaderCrc = viewCopy.getUint32(28, true);
        viewCopy.setUint32(28, 0, true);
        const computedHeaderCrc = crc32c(headerCopy);

        if (storedHeaderCrc !== computedHeaderCrc) {
            throw new Error(`Header CRC32C mismatch: expected 0x${storedHeaderCrc.toString(16)}, computed 0x${computedHeaderCrc.toString(16)}`);
        }

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        // 2. Verify magic & version
        const magic = view.getUint32(0, true);
        if (magic !== TCAN_MAGIC) {
            throw new Error(`Invalid TCAN magic: 0x${magic.toString(16)}`);
        }

        const versionMajor = view.getUint8(4);
        const versionMinor = view.getUint8(5);
        if (versionMajor !== TCAN_VERSION_MAJOR) {
            throw new Error(`Unsupported TCAN major version: ${versionMajor}`);
        }

        const messageType = view.getUint8(6) as TcanMessageType;
        const flags = view.getUint8(7);
        if ((flags & ~TCAN_ALLOWED_FLAGS) !== 0
            || (flags & TCAN_FLAG_RESPONSE) !== 0 && (flags & TCAN_FLAG_EVENT) !== 0) {
            throw new Error(`Invalid TCAN envelope flags 0x${flags.toString(16)}`);
        }
        const headerLength = view.getUint16(8, true);
        if (headerLength !== TCAN_HEADER_LENGTH) {
            throw new Error(`Unsupported header length: ${headerLength}`);
        }

        const status = view.getUint16(10, true);
        const sessionId = view.getUint32(12, true);
        const sequence = view.getUint32(16, true);
        const requestId = view.getUint32(20, true);
        const payloadLength = view.getUint32(24, true);
        const isKnownEvent = messageType >= TcanMessageType.RX_BATCH && messageType <= TcanMessageType.DEVICE_EVENT;
        if (isKnownEvent && ((flags & TCAN_FLAG_EVENT) === 0 || requestId !== 0)
            || !isKnownEvent && (flags & TCAN_FLAG_EVENT) !== 0) {
            throw new Error('TCAN event flag or requestId does not match the message type.');
        }

        // 3. Enforce maximum payload length limit
        if (payloadLength > TCAN_MAX_PAYLOAD_LENGTH) {
            throw new Error(`Payload length ${payloadLength} exceeds maximum allowed (${TCAN_MAX_PAYLOAD_LENGTH})`);
        }

        // 4. Exact buffer length check (no unverified trailing bytes accepted)
        const expectedTotalLength = TCAN_HEADER_LENGTH + payloadLength + 4;
        if (buffer.length !== expectedTotalLength) {
            throw new Error(`Invalid buffer length: expected exactly ${expectedTotalLength} bytes, got ${buffer.length}`);
        }

        // 5. Verify Payload CRC32C
        const payload = buffer.subarray(TCAN_HEADER_LENGTH, TCAN_HEADER_LENGTH + payloadLength);
        const storedPayloadCrc = view.getUint32(TCAN_HEADER_LENGTH + payloadLength, true);
        const computedPayloadCrc = payloadLength > 0 ? crc32c(payload) : 0;
        if (storedPayloadCrc !== computedPayloadCrc) {
            throw new Error(`Payload CRC32C mismatch: expected 0x${storedPayloadCrc.toString(16)}, computed 0x${computedPayloadCrc.toString(16)}`);
        }

        return {
            header: {
                magic,
                versionMajor,
                versionMinor,
                messageType,
                flags,
                headerLength,
                status,
                sessionId,
                sequence,
                requestId,
                payloadLength,
                headerCrc32c: storedHeaderCrc
            },
            payload
        };
    }

    /**
     * Serializes a batch of CanFrames into TCAN RX_BATCH payload format.
     */
    static encodeRxBatch(frames: readonly CanFrame[]): Uint8Array {
        if (frames.length === 0 || frames.length > 0xFFFF) {
            throw new Error('RX_BATCH requires 1..65535 frame records.');
        }
        const timestampsNs = frames.map(frame => BigInt(Math.round(frame.timestamp * 1_000_000)));
        const baseDeviceTicks = timestampsNs.reduce((minimum, value) => value < minimum ? value : minimum);
        let totalBytes = 32;
        for (const f of frames) {
            this.validateClassicCanFrame(f);
            totalBytes += 12 + f.data.length;
        }
        if (totalBytes > TCAN_MAX_PAYLOAD_LENGTH) {
            throw new Error('RX_BATCH exceeds the TCAN payload limit.');
        }

        const buffer = new Uint8Array(totalBytes);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

        view.setUint8(0, 0); // channelIndex
        view.setUint8(1, 0); // DRIVER_RECEIVE
        view.setUint8(2, 0); // recordFormat v1
        view.setUint8(3, 0); // batchFlags v1
        view.setUint16(4, frames.length, true);
        view.setUint16(6, 0, true);
        view.setUint32(8, 1, true); // captureId
        view.setUint32(12, 0, true); // droppedBefore
        view.setBigUint64(16, 1n, true); // rxSequenceStart
        view.setBigUint64(24, baseDeviceTicks, true);
        let offset = 32;

        for (let index = 0; index < frames.length; index++) {
            const f = frames[index];
            const delta = timestampsNs[index] - baseDeviceTicks;
            if (delta > 0xFFFFFFFFn) {
                throw new Error('RX_BATCH timestamp span exceeds u32 deltaTicks.');
            }
            view.setUint32(offset, Number(delta), true);
            offset += 4;
            view.setUint32(offset, f.id, true);
            offset += 4;
            const flags = (f.extended ? 0x01 : 0) | (f.rtr ? 0x02 : 0);
            view.setUint16(offset, flags, true);
            offset += 2;
            view.setUint8(offset++, f.dlc);
            view.setUint8(offset++, f.data.length);

            buffer.set(f.data, offset);
            offset += f.data.length;
        }

        return buffer;
    }

    /**
     * Parses CanFrames from a TCAN RX_BATCH payload with atomic fail-closed validation.
     * If any frame record in the batch is corrupted or truncated, the entire batch is rejected.
     */
    static decodeRxBatch(payload: Uint8Array, iface = 'esp32-can'): CanFrame[] {
        if (payload.length < 32) {
            throw new Error(`RX_BATCH payload too short (${payload.length} < 32 bytes)`);
        }

        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        const recordFormat = view.getUint8(2);
        const batchFlags = view.getUint8(3);
        const count = view.getUint16(4, true);
        const reserved = view.getUint16(6, true);
        const baseDeviceTicks = view.getBigUint64(24, true);
        if (recordFormat !== 0 || batchFlags !== 0 || reserved !== 0 || count === 0) {
            throw new Error('RX_BATCH has an unsupported prefix or zero records.');
        }
        if (count * 12 > payload.length - 32) {
            throw new Error('RX_BATCH record count cannot fit in the payload.');
        }
        const frames: CanFrame[] = [];
        let offset = 32;

        for (let i = 0; i < count; i++) {
            if (offset + 12 > payload.length) {
                throw new Error(`Truncated RX_BATCH record header at index ${i}`);
            }

            const deltaTicks = view.getUint32(offset, true);
            offset += 4;
            const id = view.getUint32(offset, true);
            offset += 4;
            const flags = view.getUint16(offset, true);
            offset += 2;
            if ((flags & ~0x7F) !== 0 || (flags & 0x3C) !== 0 || id > 0x1FFFFFFF) {
                throw new Error(`Invalid RX_BATCH CAN flags or identifier at record index ${i}.`);
            }
            const extended = (flags & 0x01) !== 0;
            const rtr = (flags & 0x02) !== 0;
            const dlc = view.getUint8(offset++);
            const dataLen = view.getUint8(offset++);

            if (dlc > 8 || dataLen !== (rtr ? 0 : dlc) || (!extended && id > 0x7FF)) {
                throw new Error(`Invalid RX_BATCH DLC/data length at record index ${i}.`);
            }

            if (offset + dataLen > payload.length) {
                throw new Error(`Truncated RX_BATCH payload at record index ${i}: expected ${dataLen} bytes, remaining ${payload.length - offset}`);
            }

            const data = Array.from(payload.subarray(offset, offset + dataLen));
            offset += dataLen;

            frames.push({
                id,
                extended,
                rtr,
                dlc,
                data,
                timestamp: Number(baseDeviceTicks + BigInt(deltaTicks)) / 1_000_000,
                interface: iface
            });
        }

        if (offset !== payload.length) {
            throw new Error(`Unconsumed bytes in RX_BATCH payload (${payload.length - offset} extra bytes)`);
        }

        return frames;
    }

    /**
     * Serializes a scheduled TX_BATCH payload with policy generation and arm token.
     */
    static encodeTxBatch(
        frames: readonly CanFrame[],
        policyGeneration = 1,
        armToken: bigint | number = 0n,
        batchId = 1
    ): Uint8Array {
        if (frames.length === 0 || frames.length > 0xFFFF
            || !Number.isInteger(policyGeneration) || policyGeneration < 1
            || !Number.isInteger(batchId) || batchId < 1) {
            throw new Error('Invalid TX_BATCH prefix values.');
        }
        for (const frame of frames) {
            this.validateClassicCanFrame(frame);
        }
        const total = 32 + frames.reduce((size, frame) => size + 16 + frame.data.length, 0);
        if (total > TCAN_MAX_PAYLOAD_LENGTH) {
            throw new Error('TX_BATCH exceeds the TCAN payload limit.');
        }
        const buf = new Uint8Array(total);
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        view.setUint8(0, 0); // channelIndex
        view.setUint8(1, 0); // IMMEDIATE
        view.setUint8(2, 0); // DROP_LATE
        view.setUint8(3, 0);
        view.setUint16(4, frames.length, true);
        view.setUint16(6, 0, true);
        view.setUint32(8, batchId, true);
        view.setUint32(12, policyGeneration, true);
        view.setBigUint64(16, BigInt(armToken), true);
        view.setBigUint64(24, 0n, true);
        let offset = 32;
        for (let index = 0; index < frames.length; index++) {
            const frame = frames[index];
            view.setUint32(offset, 0, true); // dueDeltaTicks
            view.setUint32(offset + 4, index + 1, true); // clientTag
            view.setUint32(offset + 8, frame.id, true);
            const flags = (frame.extended ? 0x01 : 0) | (frame.rtr ? 0x02 : 0);
            view.setUint16(offset + 12, flags, true);
            view.setUint8(offset + 14, frame.dlc);
            view.setUint8(offset + 15, frame.data.length);
            buf.set(frame.data, offset + 16);
            offset += 16 + frame.data.length;
        }
        return buf;
    }

    /** Validates the fixed header before a stream parser trusts payloadLength. */
    static validatedEnvelopeLength(header: Uint8Array): number {
        if (header.length < TCAN_HEADER_LENGTH) {
            throw new Error('Incomplete TCAN header.');
        }
        const headerCopy = new Uint8Array(header.subarray(0, TCAN_HEADER_LENGTH));
        const copyView = new DataView(headerCopy.buffer, headerCopy.byteOffset, headerCopy.byteLength);
        const storedHeaderCrc = copyView.getUint32(28, true);
        copyView.setUint32(28, 0, true);
        if (storedHeaderCrc !== crc32c(headerCopy)) {
            throw new Error('Header CRC32C mismatch.');
        }
        const view = new DataView(header.buffer, header.byteOffset, TCAN_HEADER_LENGTH);
        if (view.getUint32(0, true) !== TCAN_MAGIC || view.getUint8(4) !== TCAN_VERSION_MAJOR
            || view.getUint16(8, true) !== TCAN_HEADER_LENGTH) {
            throw new Error('Invalid TCAN header identity or version.');
        }
        const payloadLength = view.getUint32(24, true);
        if (payloadLength > TCAN_MAX_PAYLOAD_LENGTH) {
            throw new Error('TCAN payload length exceeds the negotiated maximum.');
        }
        return TCAN_HEADER_LENGTH + payloadLength + 4;
    }

    private static validateClassicCanFrame(frame: CanFrame): void {
        const maxId = frame.extended ? 0x1FFFFFFF : 0x7FF;
        if (!Number.isInteger(frame.id) || frame.id < 0 || frame.id > maxId
            || !Number.isInteger(frame.dlc) || frame.dlc < 0 || frame.dlc > 8
            || !Array.isArray(frame.data)
            || frame.data.length !== (frame.rtr ? 0 : frame.dlc)
            || !Number.isFinite(frame.timestamp) || frame.timestamp < 0
            || frame.data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0xFF)) {
            throw new Error('Malformed Classical CAN frame record.');
        }
    }
}
