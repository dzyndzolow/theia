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
import { CanBitDiscovery, BitDiscoveryPlanConfig } from './can-bit-discovery';

describe('SA-415: CanBitDiscovery', () => {
    it('should generate walking-one trials only for bits allowed in byteMask', () => {
        const config: BitDiscoveryPlanConfig = {
            targetId: 0x120,
            baselinePayload: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
            byteMask: [0b00000011, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], // Only bits 0 and 1 of Byte 0
            strategy: 'WALKING_ONE'
        };

        const trials = CanBitDiscovery.generateTrials(config);

        expect(trials).to.have.lengthOf(2);
        expect(trials[0].byteIndex).to.equal(0);
        expect(trials[0].bitIndex).to.equal(0);
        expect(trials[0].mutatedPayload[0]).to.equal(0b00000001);

        expect(trials[1].byteIndex).to.equal(0);
        expect(trials[1].bitIndex).to.equal(1);
        expect(trials[1].mutatedPayload[0]).to.equal(0b00000010);
    });

    it('should correctly map feedback responses to discovered bit options', () => {
        const config: BitDiscoveryPlanConfig = {
            targetId: 0x120,
            baselinePayload: [0, 0, 0, 0, 0, 0, 0, 0],
            byteMask: [0xFF, 0, 0, 0, 0, 0, 0, 0],
            strategy: 'WALKING_ONE'
        };

        const trials = CanBitDiscovery.generateTrials(config);
        expect(trials).to.have.lengthOf(8);

        // Simulate operator feedback: Bit 3 of byte 0 turned on HIGH_BEAM lamp
        const discovered = CanBitDiscovery.correlateBitResults(trials, [
            { trialId: trials[3].trialId, feedbackType: 'LAMP', positive: true, confidence: 0.95 }
        ]);

        expect(discovered).to.have.lengthOf(1);
        expect(discovered[0].byteIndex).to.equal(0);
        expect(discovered[0].bitIndex).to.equal(3);
        expect(discovered[0].feedbackType).to.equal('LAMP');
        expect(discovered[0].confidence).to.equal(0.95);
    });
});
