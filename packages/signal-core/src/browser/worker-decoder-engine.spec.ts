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
import { WorkerDecoderEngine, BackpressureExceededException } from './worker-decoder-engine';

describe('SA-202: WorkerDecoderEngine & Decode-on-demand', () => {

    it('should decode block asynchronously and return annotations', async () => {
        const engine = new WorkerDecoderEngine();
        const buffer = new Uint8Array([1, 2, 3, 4]).buffer;

        const res = await engine.decodeBlockAsync(buffer, 1000, BigInt(1000000));
        expect(res.status).to.equal('OK');
        expect(res.annotations).to.be.an('array').with.lengthOf(1);
        expect(res.annotations![0].summary).to.include('4 bytes @ 1000Hz');
        engine.dispose();
    });

    it('should enforce backpressure limit and throw BackpressureExceededException', async () => {
        const mockWorker = {
            postMessage: () => {}, // Hold responses to keep requests pending
            terminate: () => {},
            onmessage: null,
            onerror: null
        } as unknown as Worker;

        const engine = new WorkerDecoderEngine({
            maxPendingRequests: 2,
            workerFactory: () => mockWorker
        });
        const buffer = new Uint8Array([1, 2]).buffer;

        // Fill up to maxPendingRequests
        void engine.decodeBlockAsync(buffer, 1000, BigInt(0));
        void engine.decodeBlockAsync(buffer, 1000, BigInt(0));

        expect(engine.getPendingCount()).to.equal(2);

        // Attempting 3rd should throw BackpressureExceededException
        try {
            await engine.decodeBlockAsync(buffer, 1000, BigInt(0));
            expect.fail('Should have thrown BackpressureExceededException');
        } catch (err) {
            expect(err).to.be.instanceOf(BackpressureExceededException);
        }

        engine.dispose();
    });

    it('should reject pending requests and prevent Zombie Workers on terminate()', async () => {
        let terminatedWorker = false;
        const mockWorker = {
            postMessage: () => {},
            terminate: () => { terminatedWorker = true; },
            onmessage: null,
            onerror: null
        } as unknown as Worker;

        const engine = new WorkerDecoderEngine({
            workerFactory: () => mockWorker
        });

        const buffer = new Uint8Array([1]).buffer;
        const pendingPromise = engine.decodeBlockAsync(buffer, 500, BigInt(0));

        engine.terminate();
        expect(terminatedWorker).to.be.true;

        try {
            await pendingPromise;
            expect.fail('Should have rejected pending promise');
        } catch (err) {
            expect((err as Error).message).to.include('Worker terminated');
        }
    });

    it('should report SharedArrayBuffer support status correctly', () => {
        const supported = WorkerDecoderEngine.isSharedArrayBufferSupported();
        expect(typeof supported).to.equal('boolean');
    });
});
