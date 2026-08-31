// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import {
    crc32c,
    cobsEncode,
    cobsDecode,
    TcanCodec,
    TcanMessageType,
    TCAN_MAGIC,
    TCAN_FLAG_RESPONSE,
    TCAN_FLAG_EVENT,
    TCAN_FLAG_URGENT
} from './esp32-can-device-protocol';
import { CanFrame } from './can-protocol';
import { SlcanCodec } from '../node/device/slcan-device-provider';

describe('SA-HW-001: TCAN v1 Protocol, CRC32C, COBS & Batch Codec', () => {
    it('uses the normative TCAN v1 message and envelope flag values', () => {
        expect(TcanMessageType.SET_TX_POLICY).to.equal(0x08);
        expect(TcanMessageType.EMERGENCY_STOP).to.equal(0x0B);
        expect(TcanMessageType.TX_BATCH).to.equal(0x0C);
        expect(TcanMessageType.RX_BATCH).to.equal(0x40);
        expect(TcanMessageType.TX_RESULT_BATCH).to.equal(0x41);
        expect(TCAN_FLAG_RESPONSE).to.equal(0x01);
        expect(TCAN_FLAG_EVENT).to.equal(0x02);
        expect(TCAN_FLAG_URGENT).to.equal(0x08);
    });
    it('should compute correct CRC32C checksum for standard test vector', () => {
        // Standard check vector for Castagnoli CRC32C on "123456789" is 0xE3069283
        const testVector = new TextEncoder().encode('123456789');
        const checksum = crc32c(testVector);
        expect(checksum).to.equal(0xE3069283);
    });

    it('should encode and decode arbitrary binary data via COBS without 0x00 bytes', () => {
        const original = new Uint8Array([0x00, 0x11, 0x00, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66]);
        const encoded = cobsEncode(original);

        // Encoded payload must not contain any 0x00 bytes
        expect(Array.from(encoded)).to.not.include(0x00);

        const decoded = cobsDecode(encoded);
        expect(Array.from(decoded)).to.deep.equal(Array.from(original));
    });

    it('should round-trip serialize and deserialize TCAN envelope messages', () => {
        const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
        const encoded = TcanCodec.encodeMessage(TcanMessageType.START_CAPTURE, payload, {
            sessionId: 0x12345678,
            sequence: 42,
            requestId: 100
        });

        const decoded = TcanCodec.decodeMessage(encoded);
        expect(decoded.header.magic).to.equal(TCAN_MAGIC);
        expect(decoded.header.messageType).to.equal(TcanMessageType.START_CAPTURE);
        expect(decoded.header.sessionId).to.equal(0x12345678);
        expect(decoded.header.sequence).to.equal(42);
        expect(decoded.header.requestId).to.equal(100);
        expect(Array.from(decoded.payload)).to.deep.equal([1, 2, 3, 4]);
    });

    it('should reject corrupted header or payload CRC32C', () => {
        const payload = new Uint8Array([0x10, 0x20]);
        const encoded = TcanCodec.encodeMessage(TcanMessageType.HELLO, payload);

        // Corrupt a header byte (e.g. sequence)
        const corruptedHeader = new Uint8Array(encoded);
        corruptedHeader[16] ^= 0xFF;
        expect(() => TcanCodec.decodeMessage(corruptedHeader)).to.throw(/Header CRC32C mismatch/);

        // Corrupt a payload byte
        const corruptedPayload = new Uint8Array(encoded);
        corruptedPayload[32] ^= 0xFF;
        expect(() => TcanCodec.decodeMessage(corruptedPayload)).to.throw(/Payload CRC32C mismatch/);
    });

    it('should reject envelope with extra unverified trailing bytes (fail-closed)', () => {
        const payload = new Uint8Array([0x01, 0x02]);
        const encoded = TcanCodec.encodeMessage(TcanMessageType.HELLO, payload);

        const withTrailingJunk = new Uint8Array(encoded.length + 5);
        withTrailingJunk.set(encoded, 0);
        withTrailingJunk.set([0xDE, 0xAD, 0xBE, 0xEF, 0x00], encoded.length);

        expect(() => TcanCodec.decodeMessage(withTrailingJunk)).to.throw(/Invalid buffer length/);
    });

    it('rejects reserved or conflicting envelope flags', () => {
        expect(() => TcanCodec.encodeMessage(TcanMessageType.PING, new Uint8Array(0), { flags: 0x80 }))
            .to.throw(/flags/);
        expect(() => TcanCodec.encodeMessage(TcanMessageType.PING, new Uint8Array(0), {
            flags: TCAN_FLAG_RESPONSE | TCAN_FLAG_EVENT
        })).to.throw(/flags/);
    });

    it('should encode and decode RX_BATCH payloads containing standard and extended CAN frames with fractional timestamps', () => {
        const frames: CanFrame[] = [
            {
                id: 0x123,
                extended: false,
                rtr: false,
                dlc: 4,
                data: [0xDE, 0xAD, 0xBE, 0xEF],
                timestamp: 0.1, // Fractional millisecond timestamp (100 µs)
                interface: 'esp32-can'
            },
            {
                id: 0x18DA00F1,
                extended: true,
                rtr: false,
                dlc: 8,
                data: [1, 2, 3, 4, 5, 6, 7, 8],
                timestamp: 1020.5,
                interface: 'esp32-can'
            }
        ];

        const batchBytes = TcanCodec.encodeRxBatch(frames);
        const restoredFrames = TcanCodec.decodeRxBatch(batchBytes, 'esp32-can');

        expect(restoredFrames).to.have.lengthOf(2);
        expect(restoredFrames[0].id).to.equal(0x123);
        expect(restoredFrames[0].extended).to.be.false;
        expect(restoredFrames[0].data).to.deep.equal([0xDE, 0xAD, 0xBE, 0xEF]);
        expect(restoredFrames[0].timestamp).to.be.closeTo(0.1, 0.001);

        expect(restoredFrames[1].id).to.equal(0x18DA00F1);
        expect(restoredFrames[1].extended).to.be.true;
        expect(restoredFrames[1].data).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(restoredFrames[1].timestamp).to.be.closeTo(1020.5, 0.001);
    });

    it('should reject truncated RX_BATCH atomically without returning partial data', () => {
        const frames: CanFrame[] = [
            { id: 0x100, extended: false, rtr: false, dlc: 2, data: [1, 2], timestamp: 1, interface: 'esp32' },
            { id: 0x200, extended: false, rtr: false, dlc: 4, data: [3, 4, 5, 6], timestamp: 2, interface: 'esp32' }
        ];

        const fullBatch = TcanCodec.encodeRxBatch(frames);
        // Truncate the second frame record
        const truncatedBatch = fullBatch.subarray(0, fullBatch.length - 3);

        expect(() => TcanCodec.decodeRxBatch(truncatedBatch, 'esp32')).to.throw(/Truncated RX_BATCH/);
    });

    it('encodes the normative 32-byte TX_BATCH prefix with a 64-bit arm token', () => {
        const frame: CanFrame = {
            id: 0x123,
            extended: false,
            rtr: false,
            dlc: 2,
            data: [0xAA, 0x55],
            timestamp: 0,
            interface: 'esp32'
        };
        const payload = TcanCodec.encodeTxBatch([frame], 7, 0x123456789ABCDEFn, 9);
        const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
        expect(view.getUint16(4, true)).to.equal(1);
        expect(view.getUint32(8, true)).to.equal(9);
        expect(view.getUint32(12, true)).to.equal(7);
        expect(view.getBigUint64(16, true)).to.equal(0x123456789ABCDEFn);
        expect(view.getUint32(40, true)).to.equal(0x123);
    });

    it('should strictly reject SLCAN lines with DLC mismatch or invalid hex payload', () => {
        // Line declares DLC=8 but provides only 1 byte (2 hex chars) -> Must be rejected!
        const invalidDlc8 = SlcanCodec.parseFrame('t1238AA\r');
        expect(invalidDlc8).to.be.undefined;

        // Line declares DLC=2 and provides exactly 2 bytes -> Valid!
        const validDlc2 = SlcanCodec.parseFrame('t1232AABB\r');
        expect(validDlc2).to.not.be.undefined;
        expect(validDlc2?.dlc).to.equal(2);
        expect(validDlc2?.data).to.deep.equal([0xAA, 0xBB]);
    });
});
