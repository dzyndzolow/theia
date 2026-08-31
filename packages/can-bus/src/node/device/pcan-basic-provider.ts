// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import {
    CanDeviceDescriptor,
    CanDeviceEndpoint,
    CanDeviceEvent,
    CanDeviceProvider,
    CanDeviceSession
} from '../../common/can-device';
import { CanFrame } from '../../common/can-protocol';
import { CanExperimentSessionConfig } from '../../common/can-experiment-protocol';

export class PcanBasicSession implements CanDeviceSession {
    private readonly onFramesReceivedEmitter = new Emitter<readonly CanFrame[]>();
    readonly onFramesReceived: Event<readonly CanFrame[]> = this.onFramesReceivedEmitter.event;

    private readonly onDeviceEventEmitter = new Emitter<CanDeviceEvent>();
    readonly onDeviceEvent: Event<CanDeviceEvent> = this.onDeviceEventEmitter.event;

    private connected = true;

    constructor(
        readonly descriptor: CanDeviceDescriptor,
        readonly endpoint: CanDeviceEndpoint
    ) {}

    async configure(config: CanExperimentSessionConfig): Promise<boolean> {
        return this.connected;
    }

    async startCapture(): Promise<boolean> {
        return this.connected;
    }

    async stopCapture(): Promise<void> {
        /* stop PCAN read queue */
    }

    async transmitFrame(frame: CanFrame): Promise<boolean> {
        if (!this.connected) {
            return false;
        }
        return true;
    }

    async emergencyStop(): Promise<void> {
        await this.stopCapture();
    }

    isConnected(): boolean {
        return this.connected;
    }

    simulateRxFrames(frames: readonly CanFrame[]): void {
        if (this.connected && frames.length > 0) {
            this.onFramesReceivedEmitter.fire(frames);
        }
    }

    async close(): Promise<void> {
        this.connected = false;
        this.onDeviceEventEmitter.fire({
            type: 'DISCONNECTED',
            timestampNs: process.hrtime.bigint()
        });
    }

    dispose(): void {
        this.close();
        this.onFramesReceivedEmitter.dispose();
        this.onDeviceEventEmitter.dispose();
    }
}

@injectable()
export class PcanBasicDeviceProvider implements CanDeviceProvider {
    readonly providerId = 'pcan-basic-provider';
    readonly displayName = 'PCAN-Basic Compatible Provider (PEAK / Clones)';

    private activeSessions = new Map<string, PcanBasicSession>();

    private knownDevices: CanDeviceDescriptor[] = [];

    /** Adds a deterministic mock PCAN descriptor for automated tests only. */
    enableTestFixtures(): void {
        if (this.knownDevices.some(device => device.deviceId === 'pcan-usb-ch1')) {
            return;
        }
        this.knownDevices.push({
            deviceId: 'pcan-usb-ch1',
            name: 'PCAN-USB Adapter (Channel 1)',
            vendor: 'PEAK-System / Compatible',
            hardwareRevision: 'v2.0',
            firmwareVersion: '8.4.0',
            serialNumber: 'PCAN-001A',
            endpoints: [
                {
                    endpointId: 'pcan:usb1',
                    transportType: 'PCAN_BASIC',
                    displayName: 'PCAN_USBBUS1 (0x51)',
                    address: '0x51'
                }
            ],
            capabilities: {
                canFd: false,
                maxDataLength: 8,
                maxBaudRate: 1000000,
                hardwareFilters: 8,
                hardwareTxQueue: 16,
                timestampResolutionNs: 1000,
                galvanicIsolation: 'YES'
            }
        });
    }

    async discoverDevices(): Promise<readonly CanDeviceDescriptor[]> {
        return this.knownDevices;
    }

    async connectSession(endpointId: string): Promise<CanDeviceSession> {
        const dev = this.knownDevices.find(d => d.endpoints.some(e => e.endpointId === endpointId));
        if (!dev) {
            throw new Error(`Endpoint '${endpointId}' not found in PCAN provider`);
        }
        const ep = dev.endpoints.find(e => e.endpointId === endpointId)!;
        const session = new PcanBasicSession(dev, ep);
        this.activeSessions.set(endpointId, session);
        return session;
    }

    getSession(endpointId: string): PcanBasicSession | undefined {
        return this.activeSessions.get(endpointId);
    }
}
