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
import { AnnotationValidator } from './annotation-validator';
import { DecoderCircuitBreaker, CircuitState } from './decoder-circuit-breaker';
import { ProtocolAnnotation } from './contracts';

describe('SA-203: AnnotationValidator & DecoderCircuitBreaker', () => {

    describe('AnnotationValidator', () => {
        it('should validate ProtocolAnnotation correctness', () => {
            const valid: ProtocolAnnotation = {
                id: 'a1',
                parentId: null,
                level: 0,
                startTimeNs: BigInt(10),
                endTimeNs: BigInt(20),
                type: 'annotation:test',
                summary: 'Valid',
                payload: null
            };

            expect(AnnotationValidator.isValid(valid)).to.be.true;

            const invalidTime = { ...valid, startTimeNs: BigInt(30), endTimeNs: BigInt(20) };
            expect(AnnotationValidator.isValid(invalidTime)).to.be.false;
        });

        it('should create valid GAP and RESYNC annotations', () => {
            const gap = AnnotationValidator.createGapAnnotation(BigInt(100), BigInt(200), 'Missing packets');
            expect(gap.type).to.equal('GAP');
            expect(gap.summary).to.include('Missing packets');

            const resync = AnnotationValidator.createResyncAnnotation(BigInt(205), 'Frame header sync');
            expect(resync.type).to.equal('RESYNC');
            expect(resync.summary).to.include('Frame header sync');
        });

        it('should create DECODER_FAULT annotation with memory-truncated stack trace', () => {
            const longTrace = 'A'.repeat(500);
            const fault = AnnotationValidator.createDecoderFaultAnnotation('dec1', BigInt(0), BigInt(10), new Error(longTrace));

            expect(fault.type).to.equal('DECODER_FAULT');
            const trace = fault.payload?.errorTrace as string;
            expect(trace.length).to.be.at.most(305);
            expect(trace).to.include('...');
        });
    });

    describe('DecoderCircuitBreaker', () => {

        it('should remain CLOSED under normal operations', async () => {
            const cb = new DecoderCircuitBreaker({ failureThreshold: 3 });

            const res = await cb.execute('dec1', BigInt(0), BigInt(10), async () => [
                {
                    id: 'a1', parentId: null, level: 0, startTimeNs: BigInt(0), endTimeNs: BigInt(10),
                    type: 'test', summary: 'OK', payload: null
                }
            ]);

            expect(cb.getState('dec1')).to.equal(CircuitState.CLOSED);
            expect(res.length).to.equal(1);
            expect(res[0].type).to.equal('test');
        });

        it('should trip to OPEN after failureThreshold is reached', async () => {
            const cb = new DecoderCircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 100 });

            // Failure 1
            const r1 = await cb.execute('dec1', BigInt(0), BigInt(10), async () => { throw new Error('Err1'); });
            expect(r1[0].type).to.equal('DECODER_FAULT');
            expect(cb.getState('dec1')).to.equal(CircuitState.CLOSED);

            // Failure 2 -> Trips circuit to OPEN
            const r2 = await cb.execute('dec1', BigInt(10), BigInt(20), async () => { throw new Error('Err2'); });
            expect(r2[0].type).to.equal('DECODER_FAULT');
            expect(cb.getState('dec1')).to.equal(CircuitState.OPEN);

            // Subsequent call when OPEN immediately returns fault without running action
            let actionRan = false;
            const r3 = await cb.execute('dec1', BigInt(20), BigInt(30), async () => {
                actionRan = true;
                return [];
            });

            expect(actionRan).to.be.false;
            expect(r3[0].type).to.equal('DECODER_FAULT');
            expect(r3[0].summary).to.include('Circuit breaker is OPEN');
        });

        it('should transition to HALF_OPEN after timeout and recover to CLOSED on success', async () => {
            const cb = new DecoderCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 20 });

            // Trip to OPEN
            await cb.execute('dec1', BigInt(0), BigInt(10), async () => { throw new Error('Fail'); });
            expect(cb.getState('dec1')).to.equal(CircuitState.OPEN);

            // Wait for reset timeout
            await new Promise(r => setTimeout(r, 30));

            // Query state -> HALF_OPEN
            expect(cb.getState('dec1')).to.equal(CircuitState.HALF_OPEN);

            // Trial call in HALF_OPEN succeeds -> transitions back to CLOSED
            await cb.execute('dec1', BigInt(10), BigInt(20), async () => []);
            expect(cb.getState('dec1')).to.equal(CircuitState.CLOSED);
        });
    });
});
