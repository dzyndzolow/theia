// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
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
import { Emitter, Event } from '@theia/core/lib/common';
import { WebSocketConnectionProvider } from '@theia/core/lib/browser/messaging/ws-connection-provider';
import { CanRpc, CanStatistics, CanInterfaceConfig, canServicePath } from '../common/can-protocol';

/**
 * Frontend singleton owning the single RPC connection to the backend CAN service.
 *
 * Theia's `ChannelMultiplexer` allows only one channel per path per WebSocket
 * connection. Creating a proxy per widget (`WebSocketConnectionProvider.createProxy`)
 * therefore fails for every widget after the first one with
 * `Error: Another channel with the id '/can-bus/service' is already open.`,
 * leaving those widgets with a proxy whose RPC never connects. All widgets
 * (CAN Bus Analyzer, CAN ID Matrix) must share this single proxy and subscribe
 * to the binary frame stream instead of opening their own connection.
 */
@injectable()
export class CanRpcClient {

    @inject(WebSocketConnectionProvider)
    protected readonly connectionProvider!: WebSocketConnectionProvider;

    protected readonly framesEmitter = new Emitter<ArrayBuffer>();
    readonly onBinaryFrames: Event<ArrayBuffer> = this.framesEmitter.event;

    protected rpc: CanRpc | undefined;

    /** Lazily create the shared proxy on first use. */
    protected getProxy(): CanRpc {
        if (!this.rpc) {
            this.rpc = this.connectionProvider.createProxy<CanRpc>(canServicePath, {
                onBinaryFrames: (chunk: ArrayBuffer) => this.framesEmitter.fire(chunk)
            });
        }
        return this.rpc;
    }

    startCapture(config: CanInterfaceConfig): Promise<void> {
        return this.getProxy().startCapture(config);
    }

    stopCapture(interfaceName?: string): Promise<void> {
        return this.getProxy().stopCapture(interfaceName);
    }

    getStatistics(): Promise<CanStatistics> {
        return this.getProxy().getStatistics();
    }
}
