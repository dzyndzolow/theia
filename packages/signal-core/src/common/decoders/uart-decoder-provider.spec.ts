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
import { SampleWindow, ProtocolAnnotation } from '../contracts';
import { UartDecoderProvider } from './uart-decoder-provider';

describe('SA-205: UartDecoderProvider (2nd Protocol PoC)', () => {

    it('should satisfy DecoderProvider contract attributes for UART', () => {
        const provider = new UartDecoderProvider();
        expect(provider.id).to.equal('decoder:uart');
        expect(provider.displayName).to.equal('UART Protocol Decoder');
        expect(provider.apiVersion).to.equal('1.0.0');
        expect(provider.inputType).to.equal('raw:uart');
        expect(provider.outputType).to.equal('annotation:uart');
        expect(provider.channelRoles).to.have.lengthOf(2);
    });

    it('should decode "HELLO" ASCII byte sequence into UART annotations', async () => {
        const provider = new UartDecoderProvider();
        const helloBytes = new Uint8Array([0x48, 0x45, 0x4C, 0x4C, 0x4F]); // "HELLO"

        const sampleWindow: SampleWindow = {
            startTimeNs: BigInt(0),
            endTimeNs: BigInt(100000),
            blocks: [
                {
                    blockId: 1,
                    channelId: 'ch-uart-rx',
                    sampleRate: 115200,
                    startTimeNs: BigInt(0),
                    sampleCount: helloBytes.length,
                    dataType: 'UINT8',
                    data: helloBytes.buffer
                }
            ]
        };

        const annotations: ProtocolAnnotation[] = [];
        for await (const ann of provider.decode(sampleWindow, { baudrate: 115200 })) {
            annotations.push(ann);
        }

        expect(annotations).to.have.lengthOf(5);

        const decodedString = annotations.map(a => a.payload?.char).join('');
        expect(decodedString).to.equal('HELLO');
        expect(annotations[0].summary).to.include("('H')");
        expect(annotations[4].summary).to.include("('O')");
    });
});
