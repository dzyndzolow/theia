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
import { SampleWindow, ProtocolAnnotation } from '@theia/signal-core';
import { CanFrame, CanBinaryEncoder } from './can-protocol';
import { CanDecoderProvider } from './can-decoder-provider';

describe('SA-204: CanDecoderProvider', () => {

    it('should satisfy DecoderProvider contract attributes', () => {
        const provider = new CanDecoderProvider();
        expect(provider.id).to.equal('decoder:can');
        expect(provider.displayName).to.equal('CAN Protocol Decoder');
        expect(provider.apiVersion).to.equal('1.0.0');
        expect(provider.inputType).to.equal('raw:can');
        expect(provider.outputType).to.equal('annotation:can');
        expect(provider.channelRoles).to.have.lengthOf(1);
    });

    it('should decode a SampleWindow batch of CAN frames into ProtocolAnnotation stream', async () => {
        const provider = new CanDecoderProvider();

        const frames: CanFrame[] = [
            {
                id: 0x7FF,
                extended: false,
                rtr: false,
                dlc: 4,
                data: [1, 2, 3, 4],
                timestamp: 1000.5,
                interface: 'can0'
            },
            {
                id: 0x12345678,
                extended: true,
                rtr: true,
                dlc: 0,
                data: [],
                timestamp: 2000.125,
                interface: 'can1'
            }
        ];

        const buffer = CanBinaryEncoder.encodeBatch(frames);
        const sampleWindow: SampleWindow = {
            startTimeNs: BigInt(1000500000),
            endTimeNs: BigInt(2000125000),
            blocks: [
                {
                    blockId: 1,
                    channelId: 'ch-can',
                    sampleRate: 500000,
                    startTimeNs: BigInt(1000500000),
                    sampleCount: 2,
                    dataType: 'UINT8',
                    data: buffer
                }
            ]
        };

        const annotations: ProtocolAnnotation[] = [];
        for await (const ann of provider.decode(sampleWindow)) {
            annotations.push(ann);
        }

        expect(annotations).to.have.lengthOf(2);
        expect(annotations[0].type).to.equal('annotation:can');
        expect(annotations[0].summary).to.equal('ID=0x7FF DLC=4');
        expect(annotations[1].summary).to.equal('ID=0x12345678 DLC=0');
    });
});
