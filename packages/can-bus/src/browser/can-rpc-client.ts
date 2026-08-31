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
import {
    CanRpc,
    CanStatistics,
    CanInterfaceConfig,
    CanRpcInterfaceInfo,
    CanTxArmRequest,
    CanFrame,
    canServicePath
} from '../common/can-protocol';

/**
 * Frontend singleton owning the single RPC connection to the backend CAN service.
 *
 * Theia's `ChannelMultiplexer` allows only one channel per path per WebSocket
 * connection. All widgets (CAN Bus Analyzer, CAN ID Matrix) share this single proxy
 * and subscribe to the binary frame stream instead of opening their own connection.
 */
@injectable()
export class CanRpcClient {

    @inject(WebSocketConnectionProvider)
    protected readonly connectionProvider!: WebSocketConnectionProvider;

    protected readonly framesEmitter = new Emitter<ArrayBuffer>();
    readonly onBinaryFrames: Event<ArrayBuffer> = this.framesEmitter.event;

    protected readonly interfacesChangedEmitter = new Emitter<void>();
    readonly onDidChangeInterfaces: Event<void> = this.interfacesChangedEmitter.event;

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

    getAvailableInterfaces(): Promise<CanRpcInterfaceInfo[]> {
        return this.getProxy().getAvailableInterfaces();
    }

    async registerTcpDevice(host: string, port = 9751): Promise<CanRpcInterfaceInfo> {
        const info = await this.getProxy().registerTcpDevice(host, port);
        this.interfacesChangedEmitter.fire();
        return info;
    }

    sendFrame(frame: CanFrame): Promise<boolean> {
        return this.getProxy().sendFrame(frame);
    }

    armTransmit(request: CanTxArmRequest): Promise<void> {
        return this.getProxy().armTransmit(request);
    }

    disarmTransmit(): Promise<void> {
        return this.getProxy().disarmTransmit();
    }

    emergencyStop(): Promise<void> {
        return this.getProxy().emergencyStop();
    }
}
