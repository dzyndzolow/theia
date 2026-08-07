// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common';
import { CanRpc, CanRpcClient, CanStatistics, CanInterfaceConfig, CanFrame, CanBinaryEncoder } from '../common/can-protocol';
import { CanSocketService, ICanSocketService } from './can-socket-service';

const BATCH_FLUSH_INTERVAL_MS = 30;
const MAX_PENDING_BATCH_SIZE = 5000;

@injectable()
export class CanRpcServiceImpl implements CanRpc {
    protected readonly toDispose = new DisposableCollection();
    protected readonly clients = new Set<CanRpcClient>();
    protected pendingBatch: CanFrame[] = [];
    protected batchTimer: ReturnType<typeof setInterval> | undefined;
    protected droppedFramesCount = 0;
    protected readonly activeInterfaces = new Set<string>();

    constructor(
        @inject(CanSocketService) protected readonly socketService: ICanSocketService
    ) {
        this.toDispose.push(this.socketService.onFrameReceived(frame => this.onFrame(frame)));
    }

    protected onFrame(frame: CanFrame): void {
        // Stream all running interfaces. Each widget filters frames by its own
        // selected interface on the frontend, so several analyzers (demo, demo2, sim0)
        // can capture concurrently through the single shared RPC channel.
        if (this.pendingBatch.length < MAX_PENDING_BATCH_SIZE) {
            this.pendingBatch.push(frame);
        } else {
            // Drop oldest frame when backpressure limit is reached (drop-oldest policy)
            this.pendingBatch.shift();
            this.pendingBatch.push(frame);
            this.droppedFramesCount++;
        }
    }

    setClient(client: CanRpcClient): void {
        this.clients.add(client);
        const originalClose = client.onDidCloseConnection;
        client.onDidCloseConnection = () => {
            this.removeClient(client);
            if (originalClose) {
                try {
                    originalClose();
                } catch (e) {
                    console.warn('Error in client onDidCloseConnection:', e);
                }
            }
        };
    }

    removeClient(client: CanRpcClient): void {
        this.clients.delete(client);
        if (this.clients.size === 0) {
            this.stopBatching();
            this.stopAllInterfaces();
        }
    }

    async startCapture(config: CanInterfaceConfig): Promise<void> {
        this.activeInterfaces.add(config.name);
        this.pendingBatch = [];
        this.droppedFramesCount = 0;
        this.startBatching();
        this.socketService.start(config);
    }

    async stopCapture(interfaceName?: string): Promise<void> {
        if (interfaceName) {
            this.activeInterfaces.delete(interfaceName);
            this.socketService.stop(interfaceName);
        } else if (interfaceName === undefined) {
            this.activeInterfaces.clear();
            this.socketService.stop();
        }
        if (this.activeInterfaces.size === 0) {
            this.flushBatch();
            this.stopBatching();
        }
    }

    async getStatistics(): Promise<CanStatistics> {
        const stats = this.socketService.getStatistics();
        return {
            ...stats,
            droppedFrames: this.droppedFramesCount
        };
    }

    protected startBatching(): void {
        if (this.batchTimer !== undefined) { return; }
        this.batchTimer = setInterval(() => this.flushBatch(), BATCH_FLUSH_INTERVAL_MS);
    }

    protected stopBatching(): void {
        if (this.batchTimer !== undefined) {
            clearInterval(this.batchTimer);
            this.batchTimer = undefined;
        }
    }

    protected flushBatch(): void {
        if (this.pendingBatch.length === 0) { return; }
        if (this.clients.size === 0) {
            this.droppedFramesCount += this.pendingBatch.length;
            this.pendingBatch = [];
            return;
        }

        const batch = this.pendingBatch;
        this.pendingBatch = [];
        const chunk = CanBinaryEncoder.encodeBatch(batch);
        for (const client of this.clients) {
            try {
                client.onBinaryFrames?.(chunk);
            } catch (e) {
                console.warn('Error broadcasting binary chunk to CAN client:', e);
            }
        }
    }

    dispose(): void {
        this.stopBatching();
        this.stopAllInterfaces();
        this.clients.clear();
        this.toDispose.dispose();
    }

    protected stopAllInterfaces(): void {
        this.activeInterfaces.clear();
        this.socketService.stop();
    }
}

