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
import { DecoderProvider, createDecoderId } from './contracts';
import { DecoderDAG, CyclicDependencyException } from './decoder-dag';
import { DecoderRegistry } from './decoder-registry';

function mockDecoder(idStr: string, inputType: string, outputType: string): DecoderProvider {
    return {
        id: createDecoderId(idStr),
        displayName: `Decoder ${idStr}`,
        apiVersion: '1.0.0',
        inputType,
        outputType,
        channelRoles: [],
        async *decode() {
            // Mock generator
        }
    };
}

describe('SA-201: DecoderRegistry & Topological Sort (Kahn\'s Algorithm)', () => {

    describe('DecoderDAG (Kahn\'s Algorithm)', () => {

        it('should return empty array for empty decoder input', () => {
            const sorted = DecoderDAG.sortTopologically([]);
            expect(sorted).to.deep.equal([]);
        });

        it('should correctly sort a linear 3-stage decoder pipeline', () => {
            const d1 = mockDecoder('d1', 'raw:can', 'annotation:can');
            const d2 = mockDecoder('d2', 'annotation:can', 'annotation:j1939');
            const d3 = mockDecoder('d3', 'annotation:j1939', 'annotation:obd2');

            // Pass in reversed order
            const sorted = DecoderDAG.sortTopologically([d3, d2, d1]);
            const ids = sorted.map(d => d.id);

            expect(ids).to.deep.equal(['d1', 'd2', 'd3']);
        });

        it('should throw CyclicDependencyException when a cycle exists', () => {
            const d1 = mockDecoder('d1', 'typeA', 'typeB');
            const d2 = mockDecoder('d2', 'typeB', 'typeC');
            const d3 = mockDecoder('d3', 'typeC', 'typeA'); // Cycle: A -> B -> C -> A

            expect(() => DecoderDAG.sortTopologically([d1, d2, d3])).to.throw(CyclicDependencyException);
        });

        it('DoD: should handle 100 decoder nodes in a DAG without stack overflow', () => {
            const decoders: DecoderProvider[] = [];

            // Build a chain of 100 decoders: stage_0 -> stage_1 -> ... -> stage_99
            for (let i = 0; i < 100; i++) {
                const inType = i === 0 ? 'raw:signal' : `type:${i - 1}`;
                const outType = `type:${i}`;
                decoders.push(mockDecoder(`dec_${i}`, inType, outType));
            }

            // Shuffle decoders randomly
            const shuffled = [...decoders].sort(() => Math.random() - 0.5);

            const perfNow = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
            const start = perfNow();
            const sorted = DecoderDAG.sortTopologically(shuffled);
            const duration = perfNow() - start;

            expect(sorted.length).to.equal(100);
            expect(sorted[0].id).to.equal('dec_0');
            expect(sorted[99].id).to.equal('dec_99');
            expect(duration).to.be.below(50); // Under 50ms requirement
        });
    });

    describe('DecoderRegistry', () => {
        let registry: DecoderRegistry;

        beforeEach(() => {
            registry = new DecoderRegistry();
        });

        afterEach(() => {
            registry.dispose();
        });

        it('should register decoders and notify listeners (Observer Pattern)', () => {
            let notificationCount = 0;
            let lastOrder: readonly DecoderProvider[] = [];

            registry.onDidUpdatePipelines(ordered => {
                notificationCount++;
                lastOrder = ordered;
            });

            const d1 = mockDecoder('d1', 'raw:can', 'annotation:can');
            const d2 = mockDecoder('d2', 'annotation:can', 'annotation:j1939');

            registry.registerDecoder(d1);
            expect(notificationCount).to.equal(1);
            expect(lastOrder.map(d => d.id)).to.deep.equal(['d1']);

            registry.registerDecoder(d2);
            expect(notificationCount).to.equal(2);
            expect(lastOrder.map(d => d.id)).to.deep.equal(['d1', 'd2']);
        });

        it('should throw error when registering duplicate decoder ID', () => {
            const d1 = mockDecoder('d1', 'raw:can', 'annotation:can');
            registry.registerDecoder(d1);
            expect(() => registry.registerDecoder(d1)).to.throw("Decoder with ID 'd1' is already registered.");
        });

        it('should unregister decoders via ID or disposable', () => {
            const d1 = mockDecoder('d1', 'raw:can', 'annotation:can');
            const handle = registry.registerDecoder(d1);
            expect(registry.getDecoders().length).to.equal(1);

            handle.dispose();
            expect(registry.getDecoders().length).to.equal(0);
        });

        it('should detect cycles via hasCycle()', () => {
            const d1 = mockDecoder('d1', 'typeA', 'typeB');
            const d2 = mockDecoder('d2', 'typeB', 'typeA');

            registry.registerDecoder(d1);
            expect(registry.hasCycle()).to.be.false;

            registry.registerDecoder(d2);
            expect(registry.hasCycle()).to.be.true;
        });
    });
});
