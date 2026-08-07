// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { MatrixMessageExplorer } from './matrix-message-explorer';
import { CanFrame } from '../common/can-protocol';

const frame: CanFrame = {
    id: 0x123,
    extended: false,
    rtr: false,
    dlc: 2,
    data: [0x41, 0x42],
    timestamp: 0,
    interface: 'can0'
};

describe('MatrixMessageExplorer', () => {
    it('groups equal CAN message identities and calculates their frequency', () => {
        const explorer = new MatrixMessageExplorer();
        explorer.addFrame(frame, 1000);
        const message = explorer.addFrame({ ...frame, data: [0x43, 0x44] }, 1025);

        expect(explorer.size).to.equal(1);
        expect(message.count).to.equal(2);
        expect(message.periodMs).to.equal(25);
        expect(message.frequencyHz).to.equal(40);
        expect(message.frame.data).to.deep.equal([0x43, 0x44]);
    });

    it('keeps standard, extended and per-interface messages separate', () => {
        const explorer = new MatrixMessageExplorer();
        explorer.addFrame(frame, 1000);
        explorer.addFrame({ ...frame, extended: true }, 1001);
        explorer.addFrame({ ...frame, interface: 'can1' }, 1002);

        expect(explorer.size).to.equal(3);
    });
});
