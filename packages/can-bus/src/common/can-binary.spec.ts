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

import { expect } from 'chai';
import { CanFrame, CanBinaryEncoder, CanBinaryDecoder, canFrameToAnnotation, annotationToCanFrame } from './can-protocol';

describe('SA-005: CanBinaryTransport (Encoder & Decoder)', () => {

    it('should convert CanFrame to ProtocolAnnotation and back losslessly', () => {
        const frame: CanFrame = {
            id: 0x246,
            extended: true,
            rtr: false,
            dlc: 4,
            data: [0xAA, 0xBB, 0xCC, 0xDD],
            timestamp: 1234.56,
            interface: 'can0'
        };

        const ann = canFrameToAnnotation(frame);
        expect(ann.type).to.equal('annotation:can');
        expect(ann.summary).to.equal('ID=0x246 DLC=4');

        const convertedBack = annotationToCanFrame(ann);
        expect(convertedBack.id).to.equal(frame.id);
        expect(convertedBack.extended).to.be.true;
        expect(convertedBack.rtr).to.be.false;
        expect(convertedBack.dlc).to.equal(frame.dlc);
        expect(convertedBack.data).to.deep.equal(frame.data);
        expect(convertedBack.interface).to.equal('can0');
    });

    it('should encode and decode a batch of CAN frames losslessly', () => {
        const originalFrames: CanFrame[] = [
            {
                id: 0x123,
                extended: false,
                rtr: false,
                dlc: 4,
                data: [0xDE, 0xAD, 0xBE, 0xEF],
                timestamp: 1000.5,
                interface: 'sim0'
            },
            {
                id: 0x1ABCDEF,
                extended: true,
                rtr: true,
                dlc: 8,
                data: [1, 2, 3, 4, 5, 6, 7, 8],
                timestamp: 2000.125,
                interface: 'can7'
            }
        ];

        const buffer = CanBinaryEncoder.encodeBatch(originalFrames);
        expect(buffer).to.be.instanceOf(ArrayBuffer);

        const decodedFrames: CanFrame[] = [];
        const count = CanBinaryDecoder.decodeBatch(buffer, frame => decodedFrames.push(frame));

        expect(count).to.equal(2);
        expect(decodedFrames.length).to.equal(2);

        // Frame 1
        expect(decodedFrames[0].id).to.equal(0x123);
        expect(decodedFrames[0].extended).to.be.false;
        expect(decodedFrames[0].rtr).to.be.false;
        expect(decodedFrames[0].dlc).to.equal(4);
        expect(decodedFrames[0].data).to.deep.equal([0xDE, 0xAD, 0xBE, 0xEF]);
        expect(decodedFrames[0].timestamp).to.equal(1000.5);
        expect(decodedFrames[0].interface).to.equal('sim0');

        // Frame 2
        expect(decodedFrames[1].id).to.equal(0x1ABCDEF);
        expect(decodedFrames[1].extended).to.be.true;
        expect(decodedFrames[1].rtr).to.be.true;
        expect(decodedFrames[1].dlc).to.equal(8);
        expect(decodedFrames[1].data).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(decodedFrames[1].timestamp).to.equal(2000.125);
        expect(decodedFrames[1].interface).to.equal('can7');
    });

    it('should handle empty batch', () => {
        const buffer = CanBinaryEncoder.encodeBatch([]);
        const decodedFrames: CanFrame[] = [];
        const count = CanBinaryDecoder.decodeBatch(buffer, frame => decodedFrames.push(frame));

        expect(count).to.equal(0);
        expect(decodedFrames.length).to.equal(0);
    });

    it('should reject invalid magic header or corrupted CRC32', () => {
        const original: CanFrame[] = [{
            id: 0x100, extended: false, rtr: false, dlc: 2, data: [1, 2], timestamp: 10, interface: 'can0'
        }];
        const buffer = CanBinaryEncoder.encodeBatch(original);
        const bytes = new Uint8Array(buffer);

        // Corrupt CRC32 byte
        bytes[15] ^= 0xFF;

        const decodedFrames: CanFrame[] = [];
        const count = CanBinaryDecoder.decodeBatch(buffer, frame => decodedFrames.push(frame));

        expect(count).to.equal(0);
        expect(decodedFrames.length).to.equal(0);
    });

    it('should validate the complete frame layout before emitting any frames', () => {
        const buffer = CanBinaryEncoder.encodeBatch([{
            id: 0x100, extended: false, rtr: false, dlc: 1, data: [42], timestamp: 10, interface: 'can0'
        }]);
        // The payload CRC remains valid because the advertised count is stored
        // in the envelope header. No valid prefix may escape to consumers.
        new DataView(buffer).setUint32(4, 2, true);

        const decodedFrames: CanFrame[] = [];
        const result = CanBinaryDecoder.decodeBatchDetailed(buffer, frame => decodedFrames.push(frame));

        expect(result.valid).to.be.false;
        expect(result.advertisedCount).to.equal(2);
        expect(result.decodedCount).to.equal(0);
        expect(decodedFrames).to.have.lengthOf(0);
    });

    it('should decode 20,000 frames under 50ms (throughput DOD)', () => {
        const frames: CanFrame[] = [];
        for (let i = 0; i < 20000; i++) {
            frames.push({
                id: (i * 17) & 0x1FFFFFFF,
                extended: i % 2 === 0,
                rtr: i % 10 === 0,
                dlc: 8,
                data: [i & 0xFF, (i >> 8) & 0xFF, 0, 0, 0, 0, 0, 0],
                timestamp: i * 0.1,
                interface: 'vcan0'
            });
        }

        const buffer = CanBinaryEncoder.encodeBatch(frames);
        const perfNow = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
        // Warm up the complete hot path, then use a median to avoid failing on
        // an unrelated scheduler interruption in a single iteration.
        CanBinaryDecoder.decodeBatch(buffer, () => { /* warm-up */ });
        const elapsedSamples: number[] = [];
        let decodedCount = 0;
        for (let iteration = 0; iteration < 5; iteration++) {
            decodedCount = 0;
            const start = perfNow();
            CanBinaryDecoder.decodeBatch(buffer, () => {
                decodedCount++;
            });
            elapsedSamples.push(perfNow() - start);
        }
        elapsedSamples.sort((left, right) => left - right);
        const medianElapsed = elapsedSamples[Math.floor(elapsedSamples.length / 2)];

        expect(decodedCount).to.equal(20000);
        expect(medianElapsed).to.be.below(50);
    });
});
