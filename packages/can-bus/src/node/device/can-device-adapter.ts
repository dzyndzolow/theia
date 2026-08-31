// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, DisposableCollection } from '@theia/core';
import { CanHardwareAdapter } from '../can-socket-service';
import { CanTransmitAdapter } from '../can-transmit-service';
import { CanDeviceSession } from '../../common/can-device';
import { CanFrame, CanInterfaceConfig } from '../../common/can-protocol';

export interface ICanFrameSink {
    onFrameReceived(frame: CanFrame): void;
}

export class CanDeviceHardwareBridge implements CanHardwareAdapter, CanTransmitAdapter, Disposable {
    private readonly toDispose = new DisposableCollection();

    constructor(
        readonly iface: string,
        readonly session: CanDeviceSession,
        private readonly frameSink: ICanFrameSink
    ) {
        // Forward incoming frames from hardware session to frameSink
        this.toDispose.push(
            this.session.onFramesReceived(frames => {
                for (const frame of frames) {
                    this.frameSink.onFrameReceived(frame);
                }
            })
        );

        // Capture connections must not implicitly become transmit adapters.
        // The backend selects this bridge only during an explicit ARM action.
    }

    async configure(config: CanInterfaceConfig): Promise<void> {
        const configured = await this.session.configure({
            sessionId: `sess-${this.iface}`,
            interfaceName: this.iface,
            bitrate: config.bitrate,
            mode: 'CAN_2_0',
            idMode: 'STANDARD_11BIT',
            // Capture setup must never silently grant transmit permission.
            // The RPC ARM path installs the actual explicit allowlist.
            allowedIds: [],
            maxFps: 0,
            maxBusLoadPercent: 0,
            maxDurationMs: 0
        });
        if (!configured) {
            throw new Error(`CAN device '${this.iface}' rejected its configuration.`);
        }
    }

    async start(): Promise<void> {
        if (!await this.session.startCapture()) {
            throw new Error(`CAN device '${this.iface}' did not start capture.`);
        }
    }

    async stop(): Promise<void> {
        await this.session.stopCapture();
    }

    async sendFrame(frame: CanFrame): Promise<boolean> {
        return this.session.transmitFrame(frame);
    }

    async emergencyStop(): Promise<void> {
        await this.session.emergencyStop();
    }

    dispose(): void {
        this.toDispose.dispose();
        this.session.dispose();
    }
}
