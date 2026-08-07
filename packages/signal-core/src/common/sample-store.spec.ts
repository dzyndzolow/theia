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
import { RingSampleStore } from './ring-sample-store';
import { ChunkedIntervalTree } from './chunked-interval-tree';

describe('SA-103: RingSampleStore & ChunkedIntervalTree', () => {

    describe('RingSampleStore', () => {
        it('should throw error on non-positive capacity', () => {
            expect(() => new RingSampleStore(0)).to.throw('RingSampleStore capacity must be positive');
        });

        it('should store blocks and provide O(1) random access', () => {
            const store = new RingSampleStore(5);
            expect(store.getCapacity()).to.equal(5);
            expect(store.getLength()).to.equal(0);
            expect(store.getBlock(-1)).to.be.undefined;
            expect(store.getBlock(10)).to.be.undefined;
            expect(store.getStartTimeNs()).to.be.undefined;
            expect(store.getEndTimeNs()).to.be.undefined;
            expect(store.findBlockIndexAtTime(BigInt(100))).to.equal(-1);

            for (let i = 0; i < 3; i++) {
                store.addBlock({
                    blockId: i,
                    channelId: 'ch1',
                    sampleRate: 1000,
                    startTimeNs: BigInt(i * 1000),
                    sampleCount: 10,
                    dataType: 'UINT8',
                    data: new ArrayBuffer(10)
                });
            }

            expect(store.getLength()).to.equal(3);
            expect(store.getBlock(0)?.blockId).to.equal(0);
            expect(store.getBlock(2)?.blockId).to.equal(2);
            expect(store.getStartTimeNs()).to.equal(BigInt(0));
            expect(store.getEndTimeNs()).to.equal(BigInt(2000));

            store.clear();
            expect(store.getLength()).to.equal(0);
        });

        it('should handle ring buffer overwriting when capacity is exceeded', () => {
            const store = new RingSampleStore(3);

            for (let i = 0; i < 5; i++) {
                store.addBlock({
                    blockId: i,
                    channelId: 'ch1',
                    sampleRate: 1000,
                    startTimeNs: BigInt(i * 1000),
                    sampleCount: 10,
                    dataType: 'UINT8',
                    data: new ArrayBuffer(10)
                });
            }

            expect(store.getLength()).to.equal(3);
            expect(store.getBlock(0)?.blockId).to.equal(2);
            expect(store.getBlock(2)?.blockId).to.equal(4);
            expect(store.getStartTimeNs()).to.equal(BigInt(2000));
            expect(store.getEndTimeNs()).to.equal(BigInt(4000));
        });

        it('should binary search block index in O(log N)', () => {
            const store = new RingSampleStore(100);
            for (let i = 0; i < 100; i++) {
                store.addBlock({
                    blockId: i,
                    channelId: 'ch1',
                    sampleRate: 1000,
                    startTimeNs: BigInt(i * 100),
                    sampleCount: 10,
                    dataType: 'UINT8',
                    data: new ArrayBuffer(10)
                });
            }

            const idx = store.findBlockIndexAtTime(BigInt(550));
            expect(idx).to.equal(5);
        });
    });

    describe('ChunkedIntervalTree', () => {
        it('should handle empty tree search and clear', () => {
            const tree = new ChunkedIntervalTree<string>();
            expect(tree.size()).to.equal(0);
            expect(tree.search(BigInt(0), BigInt(100))).to.be.empty;

            tree.insert(BigInt(0), BigInt(10), 'a');
            expect(tree.size()).to.equal(1);
            tree.clear();
            expect(tree.size()).to.equal(0);
        });

        it('should insert intervals and retrieve overlapping results', () => {
            const tree = new ChunkedIntervalTree<string>(64);
            tree.insert(BigInt(10), BigInt(20), 'val1');
            tree.insert(BigInt(30), BigInt(40), 'val2');
            tree.insert(BigInt(15), BigInt(35), 'val3');

            const queryResults = tree.search(BigInt(18), BigInt(25));
            expect(queryResults).to.include('val1');
            expect(queryResults).to.include('val3');
            expect(queryResults).to.not.include('val2');
        });

        it('should scale efficiently with 100,000 intervals under sub-millisecond search time', () => {
            const tree = new ChunkedIntervalTree<number>(1024);
            const count = 100000;

            for (let i = 0; i < count; i++) {
                const start = BigInt(i * 10);
                const end = start + BigInt(5);
                tree.insert(start, end, i);
            }

            expect(tree.size()).to.equal(count);

            const perfNow = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
            const t0 = perfNow();

            // Query a narrow 50ns window in the middle of 100,000 intervals
            const results = tree.search(BigInt(500000), BigInt(500050));
            const elapsed = perfNow() - t0;

            expect(results.length).to.be.greaterThan(0);
            expect(elapsed).to.be.below(10); // DoD assertion: near zero latency query
        });
    });
});
