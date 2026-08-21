// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable } from '../common/decoder-registry';
import { WorkerDecodeRequest, WorkerDecodeResponse, handleWorkerMessage } from './worker/decoder-worker';

export interface WorkerDecoderEngineOptions {
    /** Maximum number of concurrent pending requests allowed in worker queue (backpressure limit). Default: 64 */
    readonly maxPendingRequests?: number;
    /** Factory for Worker instance or mock worker for Node unit tests */
    readonly workerFactory?: () => Worker;
}

export class BackpressureExceededException extends Error {
    constructor(max: number) {
        super(`WorkerDecoderEngine backpressure limit exceeded (${max} pending requests).`);
        this.name = 'BackpressureExceededException';
    }
}

export class WorkerDecoderEngine implements Disposable {
    private worker: Worker | undefined;
    private readonly pendingRequests = new Map<string, {
        resolve: (response: WorkerDecodeResponse) => void;
        reject: (error: Error) => void;
    }>();
    private readonly maxPending: number;
    private requestCounter = 0;
    private isTerminated = false;

    constructor(options: WorkerDecoderEngineOptions = {}) {
        this.maxPending = options.maxPendingRequests ?? 64;
        if (options.workerFactory) {
            this.worker = options.workerFactory();
            this.setupWorkerListeners();
        }
    }

    /**
     * Checks if SharedArrayBuffer and Atomics synchronization are supported in runtime.
     */
    public static isSharedArrayBufferSupported(): boolean {
        return typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined';
    }

    /**
     * Submits a data block for asynchronous decoding in the WebWorker.
     * Uses Transferable Objects when ArrayBuffer is supplied and SAB is not active.
     */
    public async decodeBlockAsync(
        dataBuffer: ArrayBuffer | SharedArrayBuffer,
        sampleRate: number,
        startTimeNs: bigint
    ): Promise<WorkerDecodeResponse> {
        if (this.isTerminated) {
            throw new Error('WorkerDecoderEngine is terminated.');
        }

        if (this.pendingRequests.size >= this.maxPending) {
            throw new BackpressureExceededException(this.maxPending);
        }

        const requestId = `req-${++this.requestCounter}`;
        const request: WorkerDecodeRequest = {
            id: requestId,
            type: 'DECODE_BLOCK',
            payload: {
                dataBuffer,
                sampleRate,
                startTimeNs: startTimeNs.toString()
            }
        };

        return new Promise<WorkerDecodeResponse>((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });

            if (this.worker) {
                const transferables: Transferable[] = [];
                if (!WorkerDecoderEngine.isSharedArrayBufferSupported() && dataBuffer instanceof ArrayBuffer) {
                    transferables.push(dataBuffer);
                }
                this.worker.postMessage(request, transferables);
            } else {
                // Direct synchronous mock handling for headless/Node execution
                const mockEvent = { data: request } as MessageEvent<WorkerDecodeRequest>;
                handleWorkerMessage(mockEvent, responseMsg => {
                    this.onMessageReceived(responseMsg);
                });
            }
        });
    }

    public getPendingCount(): number {
        return this.pendingRequests.size;
    }

    /**
     * Terminates the worker process immediately to prevent Zombie Workers.
     */
    public terminate(): void {
        if (this.isTerminated) {
            return;
        }
        this.isTerminated = true;

        if (this.worker) {
            try {
                this.worker.postMessage({ id: 'term', type: 'TERMINATE' });
                this.worker.terminate();
            } catch (err) {
                // Ignore cleanup errors
            }
            this.worker = undefined;
        }

        for (const { reject } of this.pendingRequests.values()) {
            reject(new Error('Worker terminated before completing request.'));
        }
        this.pendingRequests.clear();
    }

    public dispose(): void {
        this.terminate();
    }

    private setupWorkerListeners(): void {
        if (!this.worker) {
            return;
        }
        this.worker.onmessage = (event: MessageEvent<WorkerDecodeResponse>) => {
            this.onMessageReceived(event.data);
        };
        this.worker.onerror = (err: ErrorEvent) => {
            console.error('Worker error:', err.message);
        };
    }

    private onMessageReceived(response: WorkerDecodeResponse): void {
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.status === 'OK') {
                pending.resolve(response);
            } else {
                pending.reject(new Error(response.error || 'Worker decoding error'));
            }
        }
    }
}
