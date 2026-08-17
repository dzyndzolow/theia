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
});
