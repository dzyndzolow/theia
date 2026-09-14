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

    it('enforces maximum capacity and evicts least recently updated messages (LRU)', () => {
        const explorer = new MatrixMessageExplorer(3);
        const f1: CanFrame = { ...frame, id: 1 };
        const f2: CanFrame = { ...frame, id: 2 };
        const f3: CanFrame = { ...frame, id: 3 };
        const f4: CanFrame = { ...frame, id: 4 };

        explorer.addFrame(f1, 1000);
        explorer.addFrame(f2, 1001);
        explorer.addFrame(f3, 1002);
        expect(explorer.size).to.equal(3);

        // Access/update f1 so f2 becomes the oldest/LRU
        explorer.addFrame(f1, 1003);

        // Adding f4 should evict f2 (since f1 was refreshed and f3 was added after f2)
        explorer.addFrame(f4, 1004);
        expect(explorer.size).to.equal(3);
        expect(explorer.has(MatrixMessageExplorer.createKey(f1))).to.be.true;
        expect(explorer.has(MatrixMessageExplorer.createKey(f2))).to.be.false;
        expect(explorer.has(MatrixMessageExplorer.createKey(f3))).to.be.true;
        expect(explorer.has(MatrixMessageExplorer.createKey(f4))).to.be.true;
    });

    it('supports deleting messages directly', () => {
        const explorer = new MatrixMessageExplorer();
        explorer.addFrame(frame, 1000);
        expect(explorer.size).to.equal(1);
        const key = MatrixMessageExplorer.createKey(frame);
        expect(explorer.delete(key)).to.be.true;
        expect(explorer.size).to.equal(0);
        expect(explorer.delete(key)).to.be.false;
    });

    it('rejects invalid maxMessages with RangeError', () => {
        expect(() => new MatrixMessageExplorer(0)).to.throw(RangeError);
        expect(() => new MatrixMessageExplorer(-1)).to.throw(RangeError);
        expect(() => new MatrixMessageExplorer(NaN)).to.throw(RangeError);
        expect(() => new MatrixMessageExplorer(Infinity)).to.throw(RangeError);
        expect(() => new MatrixMessageExplorer(2.5)).to.throw(RangeError);
        expect(() => new MatrixMessageExplorer(10_001)).to.throw(RangeError);
    });

    it('accepts boundary maxMessages values', () => {
        const minExplorer = new MatrixMessageExplorer(1);
        expect(minExplorer.maxMessages).to.equal(1);

        const maxExplorer = new MatrixMessageExplorer(10_000);
        expect(maxExplorer.maxMessages).to.equal(10_000);

        const defaultExplorer = new MatrixMessageExplorer();
        expect(defaultExplorer.maxMessages).to.equal(10_000);
    });
});

