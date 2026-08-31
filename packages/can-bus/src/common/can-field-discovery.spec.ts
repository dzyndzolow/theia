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
import { CanFieldDiscovery, FieldSweepConfig } from './can-field-discovery';
import { CanTextPayload } from './can-text-payload';

describe('SA-416: CanFieldDiscovery & CanTextPayload', () => {
    describe('CanFieldDiscovery', () => {
        it('should generate Little Endian sweep frames with scale, offset and safe return', () => {
            const config: FieldSweepConfig = {
                targetId: 0x300,
                baselinePayload: [0, 0, 0, 0, 0, 0, 0, 0],
                startByte: 2,
                dataType: 'UINT16',
                byteOrder: 'LITTLE_ENDIAN',
                minValue: 0,
                maxValue: 200,
                step: 100, // 0, 100, 200 -> 3 frames + 1 safeReturn = 4 frames
                scale: 1.0,
                offset: 0,
                safeReturnValue: 0
            };

            const items = CanFieldDiscovery.generateSweepFrames(config);
            expect(items).to.have.lengthOf(4);

            // Item 0: val=0
            expect(items[0].value).to.equal(0);
            expect(items[0].frame.data[2]).to.equal(0);
            expect(items[0].frame.data[3]).to.equal(0);

            // Item 1: val=100 (0x0064 -> little endian [0x64, 0x00])
            expect(items[1].value).to.equal(100);
            expect(items[1].frame.data[2]).to.equal(0x64);
            expect(items[1].frame.data[3]).to.equal(0x00);

            // Item 2: val=200 (0x00C8 -> little endian [0xC8, 0x00])
            expect(items[2].value).to.equal(200);
            expect(items[2].frame.data[2]).to.equal(0xC8);
            expect(items[2].frame.data[3]).to.equal(0x00);

            // Item 3: safe return val=0
            expect(items[3].isSafeReturn).to.be.true;
            expect(items[3].frame.data[2]).to.equal(0);
            expect(items[3].frame.data[3]).to.equal(0);
        });

        it('should generate Big Endian sweep frames for UINT16', () => {
            const config: FieldSweepConfig = {
                targetId: 0x300,
                baselinePayload: [0, 0, 0, 0, 0, 0, 0, 0],
                startByte: 0,
                dataType: 'UINT16',
                byteOrder: 'BIG_ENDIAN',
                minValue: 258, // 0x0102 -> [0x01, 0x02]
                maxValue: 258,
                step: 1
            };

            const items = CanFieldDiscovery.generateSweepFrames(config);
            expect(items).to.have.lengthOf(1);
            expect(items[0].frame.data[0]).to.equal(0x01);
            expect(items[0].frame.data[1]).to.equal(0x02);
        });
    });

    describe('CanTextPayload', () => {
        it('should encode short text as ISO-TP Single Frame (SF)', () => {
            const frames = CanTextPayload.encodeIsoTpFrames({
                targetId: 0x7E0,
                text: 'HELLO',
                paddingByte: 0xAA
            });

            expect(frames).to.have.lengthOf(1);
            // Single Frame header: 0x05 (length 5), followed by 'H','E','L','L','O'
            expect(frames[0].data[0]).to.equal(0x05);
            expect(frames[0].data[1]).to.equal('H'.charCodeAt(0));
            expect(frames[0].data[2]).to.equal('E'.charCodeAt(0));
            expect(frames[0].data[3]).to.equal('L'.charCodeAt(0));
            expect(frames[0].data[4]).to.equal('L'.charCodeAt(0));
            expect(frames[0].data[5]).to.equal('O'.charCodeAt(0));
            expect(frames[0].data[6]).to.equal(0xAA);
            expect(frames[0].data[7]).to.equal(0xAA);
        });

        it('should encode long text as ISO-TP First Frame (FF) and Consecutive Frames (CF)', () => {
            const text = 'THEIA SIGNAL ANALYZER CAN LAB'; // 29 characters
            const frames = CanTextPayload.encodeIsoTpFrames({
                targetId: 0x7E0,
                text,
                paddingByte: 0x55
            });

            // 29 bytes: FF has 6 bytes, remaining 23 bytes split across 7 bytes/CF -> 4 CFs => total 5 frames
            expect(frames).to.have.lengthOf(5);
            // FF header: [0x10, 29]
            expect(frames[0].data[0]).to.equal(0x10);
            expect(frames[0].data[1]).to.equal(29);
            // CF 1 header: 0x21
            expect(frames[1].data[0]).to.equal(0x21);
            // CF 2 header: 0x22
            expect(frames[2].data[0]).to.equal(0x22);
            // CF 3 header: 0x23
            expect(frames[3].data[0]).to.equal(0x23);
            // CF 4 header: 0x24
            expect(frames[4].data[0]).to.equal(0x24);
        });
    });
});
