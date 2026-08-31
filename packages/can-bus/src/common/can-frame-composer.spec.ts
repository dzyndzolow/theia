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
import { CanFrameComposer, FrameCompositionTemplate } from './can-frame-composer';

describe('SA-418: CanFrameComposer (Dynamic Variables)', () => {
    it('should inject variables into payload at specified offsets and endianness', () => {
        const template: FrameCompositionTemplate = {
            id: 0x150,
            baseData: [0, 0, 0, 0, 0, 0, 0, 0],
            bindings: [
                { variableName: 'speedKph', targetByte: 0, dataType: 'UINT16_LE', scale: 0.1, offset: 0 },
                { variableName: 'engineRpm', targetByte: 2, dataType: 'UINT16_BE', scale: 1.0, offset: 0 },
                { variableName: 'fuelLevel', targetByte: 4, dataType: 'UINT8', fallbackValue: 50 }
            ]
        };

        const variables = new Map<string, number>();
        variables.set('speedKph', 120.5); // raw = 120.5 / 0.1 = 1205 -> 0x04B5 -> LE [0xB5, 0x04]
        variables.set('engineRpm', 3000); // raw = 3000 -> 0x0BB8 -> BE [0x0B, 0xB8]
        // fuelLevel omitted -> should use fallback 50 (0x32)

        const frame = CanFrameComposer.composeFrame(template, variables);

        expect(frame.id).to.equal(0x150);
        expect(frame.data[0]).to.equal(0xB5);
        expect(frame.data[1]).to.equal(0x04);
        expect(frame.data[2]).to.equal(0x0B);
        expect(frame.data[3]).to.equal(0xB8);
        expect(frame.data[4]).to.equal(50);
    });
});
