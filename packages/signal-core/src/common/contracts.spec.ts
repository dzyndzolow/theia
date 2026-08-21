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
    createDecoderId,
    createSignalId,
    createChannelId,
    createSessionId,
    SampleBlock,
    ProtocolAnnotation,
    DecoderProvider,
    SampleWindow
} from './contracts';

describe('SA-102: System Contracts & Branded Types', () => {

    it('should correctly create and assign branded types for IDs', () => {
        const decId = createDecoderId('decoder-can');
        const sigId = createSignalId('signal-1');
        const chanId = createChannelId('chan-tx');
        const sessId = createSessionId('sess-100');

        expect(decId).to.equal('decoder-can');
        expect(sigId).to.equal('signal-1');
        expect(chanId).to.equal('chan-tx');
        expect(sessId).to.equal('sess-100');
    });

    it('should construct valid SampleBlock and ProtocolAnnotation objects', () => {
        const block: SampleBlock = {
            blockId: 1,
            channelId: createChannelId('ch1'),
            sampleRate: 1000000,
            startTimeNs: BigInt(1000000000),
            sampleCount: 100,
            dataType: 'UINT8',
            data: new ArrayBuffer(100)
        };

        expect(block.blockId).to.equal(1);
        expect(block.channelId).to.equal('ch1');
        expect(block.sampleRate).to.equal(1000000);
        expect(block.startTimeNs).to.equal(BigInt(1000000000));
        expect(block.dataType).to.equal('UINT8');
        expect(block.data.byteLength).to.equal(100);

        const annotation: ProtocolAnnotation = {
            id: 'ann-1',
            // Root annotations use null by contract.
            // eslint-disable-next-line no-null/no-null -- required by ProtocolAnnotation
            parentId: null,
            level: 0,
            startTimeNs: BigInt(100),
            endTimeNs: BigInt(200),
            type: 'CAN_FRAME',
            summary: 'ID=0x123 DLC=4',
            payload: { id: 0x123, data: [1, 2, 3, 4] }
        };

        expect(annotation.id).to.equal('ann-1');
        expect(annotation.parentId).to.be.null;
        expect(annotation.type).to.equal('CAN_FRAME');
    });

    it('should handle DecoderProvider structure and decode signature', async () => {
        const dummyDecoder: DecoderProvider = {
            id: createDecoderId('dummy-dec'),
            displayName: 'Dummy Decoder',
            apiVersion: '1.0.0',
            inputType: 'raw-digital',
            outputType: 'annotation:dummy',
            channelRoles: [
                { roleName: 'DATA', required: true }
            ],
            async *decode(input: SampleWindow | AsyncIterable<ProtocolAnnotation>): AsyncIterable<ProtocolAnnotation> {
                yield {
                    id: 'out-1',
                    // Root annotations use null by contract.
                    // eslint-disable-next-line no-null/no-null -- required by ProtocolAnnotation
                    parentId: null,
                    level: 0,
                    startTimeNs: BigInt(0),
                    endTimeNs: BigInt(100),
                    type: 'DUMMY',
                    summary: 'Decoded dummy',
                    // No decoded payload is intentional for this contract test.
                    // eslint-disable-next-line no-null/no-null -- required by ProtocolAnnotation
                    payload: null
                };
            }
        };

        expect(dummyDecoder.id).to.equal('dummy-dec');
        expect(dummyDecoder.channelRoles).to.have.lengthOf(1);

        const annotations: ProtocolAnnotation[] = [];
        for await (const ann of dummyDecoder.decode({ startTimeNs: BigInt(0), endTimeNs: BigInt(100), blocks: [] }, {})) {
            annotations.push(ann);
        }

        expect(annotations).to.have.lengthOf(1);
        expect(annotations[0].summary).to.equal('Decoded dummy');
    });
});
