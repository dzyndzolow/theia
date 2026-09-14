// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { CanBinaryEncoder, CanFrame } from '../common/can-protocol';
import { CAN_MATRIX_WORKER_SOURCE, CanMatrixWorkerResponse } from './can-matrix-worker';

interface TestWorkerScope {
    onmessage: ((event: { data: unknown }) => void) | undefined;
    postMessage(message: CanMatrixWorkerResponse): void;
}

function createWorkerHarness(): { worker: TestWorkerScope; responses: CanMatrixWorkerResponse[] } {
    const responses: CanMatrixWorkerResponse[] = [];
    const worker: TestWorkerScope = {
        onmessage: undefined,
        postMessage: message => responses.push(message)
    };
    // The worker source intentionally has no module dependencies, so it can be
    // tested with the same message contract used by a browser Blob Worker.
    Function('self', CAN_MATRIX_WORKER_SOURCE)(worker);
    return { worker, responses };
}

describe('CanMatrixWorker', () => {
    it('aggregates a batch and returns only the latest row update per CAN ID', () => {
        const { worker, responses } = createWorkerHarness();
        const first: CanFrame = {
            id: 0x123, extended: false, rtr: false, dlc: 3,
            data: [0x67, 0x74, 0x00], timestamp: 1, interface: 'demo'
        };
        const changed: CanFrame = { ...first, data: [0x67, 0x74, 0x01], timestamp: 2 };
        const chunk = CanBinaryEncoder.encodeBatch([first, changed]);

        worker.onmessage!({ data: { type: 'PROCESS_BATCH', chunk } });

        expect(responses).to.have.length(1);
        const updates = responses[0].updates;
        expect(updates).to.have.length(1);
        expect(updates[0].count).to.equal(2);
        expect(updates[0].data).to.deep.equal([0x67, 0x74, 0x01]);
        expect(updates[0].changedMask).to.deep.equal([false, false, true]);
    });

    it('clears worker-side aggregation state on reset', () => {
        const { worker, responses } = createWorkerHarness();
        const frame: CanFrame = {
            id: 0x123, extended: false, rtr: false, dlc: 1,
            data: [0x01], timestamp: 1, interface: 'demo'
        };

        worker.onmessage!({ data: { type: 'PROCESS_BATCH', chunk: CanBinaryEncoder.encodeBatch([frame]) } });
        worker.onmessage!({ data: { type: 'RESET' } });
        worker.onmessage!({ data: { type: 'PROCESS_BATCH', chunk: CanBinaryEncoder.encodeBatch([frame]) } });

        expect(responses[1].updates[0].count).to.equal(1);
    });

    it('returns evictedKeys array in responses', () => {
        const { worker, responses } = createWorkerHarness();
        const frame: CanFrame = {
            id: 0x123, extended: false, rtr: false, dlc: 1,
            data: [0x01], timestamp: 1, interface: 'demo'
        };

        worker.onmessage!({ data: { type: 'PROCESS_BATCH', chunk: CanBinaryEncoder.encodeBatch([frame]) } });

        expect(responses).to.have.length(1);
        expect(responses[0].evictedKeys).to.be.an('array');
        expect(responses[0].evictedKeys).to.be.empty;
    });

    it('processMatrixBatchDirect enforces maxRows limit with LRU eviction', () => {
        const { processMatrixBatchDirect } = require('./can-matrix-worker');
        const f1: CanFrame = { id: 1, extended: false, rtr: false, dlc: 1, data: [1], timestamp: 1, interface: 'demo' };
        const f2: CanFrame = { id: 2, extended: false, rtr: false, dlc: 1, data: [2], timestamp: 2, interface: 'demo' };
        const f3: CanFrame = { id: 3, extended: false, rtr: false, dlc: 1, data: [3], timestamp: 3, interface: 'demo' };
        const f4: CanFrame = { id: 4, extended: false, rtr: false, dlc: 1, data: [4], timestamp: 4, interface: 'demo' };

        const rows = new Map();
        processMatrixBatchDirect(CanBinaryEncoder.encodeBatch([f1, f2, f3]), rows, 3);
        expect(rows.size).to.equal(3);

        // Update f1 so it becomes newest, making f2 oldest
        processMatrixBatchDirect(CanBinaryEncoder.encodeBatch([f1]), rows, 3);

        // Add f4 -> should evict f2
        processMatrixBatchDirect(CanBinaryEncoder.encodeBatch([f4]), rows, 3);
        expect(rows.size).to.equal(3);
        expect(rows.has('demo:standard:1:1')).to.be.true;
        expect(rows.has('demo:standard:2:1')).to.be.false;
        expect(rows.has('demo:standard:3:1')).to.be.true;
        expect(rows.has('demo:standard:4:1')).to.be.true;
    });

    it('worker source calculates net evictedKeys and clears re-added key from evictedKeys in same batch', () => {
        const customSource = CAN_MATRIX_WORKER_SOURCE.replace('const MAX_ROWS = 10000;', 'const MAX_ROWS = 3;');
        const responses: CanMatrixWorkerResponse[] = [];
        const worker: TestWorkerScope = {
            onmessage: undefined,
            postMessage: message => responses.push(message)
        };
        Function('self', customSource)(worker);

        const f1: CanFrame = { id: 1, extended: false, rtr: false, dlc: 1, data: [1], timestamp: 1, interface: 'demo' };
        const f2: CanFrame = { id: 2, extended: false, rtr: false, dlc: 1, data: [2], timestamp: 2, interface: 'demo' };
        const f3: CanFrame = { id: 3, extended: false, rtr: false, dlc: 1, data: [3], timestamp: 3, interface: 'demo' };
        const f4: CanFrame = { id: 4, extended: false, rtr: false, dlc: 1, data: [4], timestamp: 4, interface: 'demo' };

        // Initial batch fills capacity: 1, 2, 3
        worker.onmessage!({ data: { type: 'PROCESS_BATCH', chunk: CanBinaryEncoder.encodeBatch([f1, f2, f3]) } });
        expect(responses[0].updates).to.have.length(3);
        expect(responses[0].evictedKeys).to.be.empty;

        // Second batch:
        // Frame 4 arrives -> capacity 3 exceeded, oldest (f1) is evicted -> evictedKeysSet has 'demo:standard:1:1'
        // Frame 1 arrives again in the SAME batch -> f1 re-added -> evictedKeysSet deletes 'demo:standard:1:1', oldest (f2) evicted
        worker.onmessage!({ data: { type: 'PROCESS_BATCH', chunk: CanBinaryEncoder.encodeBatch([f4, f1]) } });

        expect(responses).to.have.length(2);
        const secondBatch = responses[1];
        const updateKeys = secondBatch.updates.map(u => u.key);
        expect(updateKeys).to.include('demo:standard:1:1');
        expect(updateKeys).to.include('demo:standard:4:1');
        expect(updateKeys).to.not.include('demo:standard:2:1');

        expect(secondBatch.evictedKeys).to.include('demo:standard:2:1');
        expect(secondBatch.evictedKeys).to.not.include('demo:standard:1:1');
    });
});

