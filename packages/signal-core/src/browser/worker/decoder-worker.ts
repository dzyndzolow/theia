// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export interface WorkerDecodeRequest {
    readonly id: string;
    readonly type: 'DECODE_BLOCK' | 'TERMINATE';
    readonly payload?: {
        readonly dataBuffer: ArrayBuffer | SharedArrayBuffer;
        readonly sampleRate: number;
        readonly startTimeNs: string;
    };
}

export interface WorkerDecodeResponse {
    readonly id: string;
    readonly status: 'OK' | 'ERROR';
    readonly annotations?: Array<{
        readonly id: string;
        readonly startTimeNs: string;
        readonly endTimeNs: string;
        readonly summary: string;
    }>;
    readonly error?: string;
}

/**
 * Message handler for Decoder WebWorker thread.
 */
export function handleWorkerMessage(
    event: MessageEvent<WorkerDecodeRequest>,
    postFn: (msg: WorkerDecodeResponse, transferables?: Transferable[]) => void
): void {
    const { id, type, payload } = event.data;

    if (type === 'TERMINATE') {
        postFn({ id, status: 'OK' });
        if (typeof self !== 'undefined' && typeof self.close === 'function') {
            self.close();
        }
        return;
    }

    if (type === 'DECODE_BLOCK' && payload) {
        try {
            const annotations = [
                {
                    id: `ann-${id}-1`,
                    startTimeNs: payload.startTimeNs,
                    endTimeNs: payload.startTimeNs,
                    summary: `Decoded block (${payload.dataBuffer.byteLength} bytes @ ${payload.sampleRate}Hz)`
                }
            ];

            postFn({
                id,
                status: 'OK',
                annotations
            });
        } catch (err) {
            postFn({
                id,
                status: 'ERROR',
                error: String(err)
            });
        }
    }
}

// Attach listener if running inside dedicated Worker scope
if (typeof self !== 'undefined' && typeof addEventListener === 'function') {
    self.addEventListener('message', (e: MessageEvent<WorkerDecodeRequest>) => {
        handleWorkerMessage(e, (msg, transferables) => {
            (self as unknown as Worker).postMessage(msg, transferables || []);
        });
    });
}
