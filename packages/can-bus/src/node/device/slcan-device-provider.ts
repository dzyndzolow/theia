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

export class SlcanCodec {
    /**
     * Formats a CanFrame into standard SLCAN ASCII string (without trailing \r).
     */
    static formatFrame(frame: CanFrame): string {
        const maxId = frame.extended ? 0x1FFFFFFF : 0x7FF;
        if (!Number.isInteger(frame.id) || frame.id < 0 || frame.id > maxId
            || !Number.isInteger(frame.dlc) || frame.dlc < 0 || frame.dlc > 8
            || !Array.isArray(frame.data)
            || (frame.rtr ? frame.data.length !== 0 : frame.data.length !== frame.dlc)
            || frame.data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0xFF)) {
            throw new Error('Cannot format malformed SLCAN frame.');
        }
        const dlc = frame.dlc;
        const dataHex = frame.data.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');

        if (frame.extended) {
            const idHex = (frame.id & 0x1FFFFFFF).toString(16).padStart(8, '0').toUpperCase();
            return frame.rtr ? `R${idHex}${dlc}` : `T${idHex}${dlc}${dataHex}`;
        } else {
            const idHex = (frame.id & 0x7FF).toString(16).padStart(3, '0').toUpperCase();
            return frame.rtr ? `r${idHex}${dlc}` : `t${idHex}${dlc}${dataHex}`;
        }
    }

    /**
     * Parses an SLCAN ASCII command line into a CanFrame.
     */
    static parseFrame(line: string, iface = 'slcan'): CanFrame | undefined {
        const trimmed = line.trim();
        if (!trimmed) {
            return undefined;
        }

        const type = trimmed[0];
        if (type === 't') {
            // Standard 11-bit data frame: tIII L DD..
            if (trimmed.length < 5) {
                return undefined;
            }
            const match = /^t([0-9A-Fa-f]{3})([0-8])([0-9A-Fa-f]*)$/.exec(trimmed);
            if (!match) {
                return undefined;
            }
            const id = Number.parseInt(match[1], 16);
            const dlc = Number.parseInt(match[2], 10);
            const dataHex = match[3];
            if (dataHex.length !== dlc * 2) {
                return undefined;
            }
            const data: number[] = [];
            for (let i = 0; i < dataHex.length; i += 2) {
                const byteVal = Number.parseInt(dataHex.slice(i, i + 2), 16);
                data.push(byteVal);
            }
            return {
                id,
                extended: false,
                rtr: false,
                dlc,
                data,
                timestamp: Date.now(),
                interface: iface
            };
        } else if (type === 'T') {
            // Extended 29-bit data frame: TIIIIIIII L DD..
            if (trimmed.length < 10) {
                return undefined;
            }
            const match = /^T([0-9A-Fa-f]{8})([0-8])([0-9A-Fa-f]*)$/.exec(trimmed);
            if (!match) {
                return undefined;
            }
            const id = Number.parseInt(match[1], 16);
            const dlc = Number.parseInt(match[2], 10);
            const dataHex = match[3];
            if (id > 0x1FFFFFFF || dataHex.length !== dlc * 2) {
                return undefined;
            }
            const data: number[] = [];
            for (let i = 0; i < dataHex.length; i += 2) {
                const byteVal = Number.parseInt(dataHex.slice(i, i + 2), 16);
                data.push(byteVal);
            }
            return {
                id,
                extended: true,
                rtr: false,
                dlc,
                data,
                timestamp: Date.now(),
                interface: iface
            };
        } else if (type === 'r') {
            // Standard RTR: rIII L
            if (trimmed.length !== 5) {
                return undefined;
            }
            const match = /^r([0-9A-Fa-f]{3})([0-8])$/.exec(trimmed);
            if (!match) {
                return undefined;
            }
            const id = Number.parseInt(match[1], 16);
            const dlc = Number.parseInt(match[2], 10);
            return {
                id,
                extended: false,
                rtr: true,
                dlc,
                data: [],
                timestamp: Date.now(),
                interface: iface
            };
        } else if (type === 'R') {
            // Extended RTR: RIIIIIIII L
            if (trimmed.length !== 10) {
                return undefined;
            }
            const match = /^R([0-9A-Fa-f]{8})([0-8])$/.exec(trimmed);
            if (!match) {
                return undefined;
            }
            const id = Number.parseInt(match[1], 16);
            const dlc = Number.parseInt(match[2], 10);
            if (id > 0x1FFFFFFF) {
                return undefined;
            }
            return {
                id,
                extended: true,
                rtr: true,
                dlc,
                data: [],
                timestamp: Date.now(),
                interface: iface
            };
        }

        return undefined;
    }
}

export class SlcanSession implements CanDeviceSession {
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
        /* send 'C\r' to close slcan */
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

    handleIncomingLine(line: string): void {
        const frame = SlcanCodec.parseFrame(line, this.endpoint.endpointId);
        if (frame) {
            this.onFramesReceivedEmitter.fire([frame]);
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
export class SlcanDeviceProvider implements CanDeviceProvider {
    readonly providerId = 'slcan-device-provider';
    readonly displayName = 'CANable / SLCAN Serial Provider';

    private activeSessions = new Map<string, SlcanSession>();

    private knownDevices: CanDeviceDescriptor[] = [];

    /** Adds a deterministic mock CANable descriptor for automated tests only. */
    enableTestFixtures(): void {
        if (this.knownDevices.some(device => device.deviceId === 'canable-slcan-01')) {
            return;
        }
        this.knownDevices.push({
            deviceId: 'canable-slcan-01',
            name: 'CANable 2.0 (SLCAN Mode)',
            vendor: 'canable.io / Open Hardware',
            hardwareRevision: 'v2.0',
            firmwareVersion: '1.2.0',
            serialNumber: 'CANABLE-001',
            endpoints: [
                {
                    endpointId: 'canable:ref01:slcan:COM4',
                    transportType: 'SLCAN',
                    displayName: 'Serial Port COM4 (SLCAN)',
                    serialPort: 'COM4'
                }
            ],
            capabilities: {
                canFd: false,
                maxDataLength: 8,
                maxBaudRate: 1000000,
                hardwareFilters: 4,
                hardwareTxQueue: 8,
                timestampResolutionNs: 10000,
                galvanicIsolation: 'UNKNOWN'
            }
        });
    }

    async discoverDevices(): Promise<readonly CanDeviceDescriptor[]> {
        return this.knownDevices;
    }

    async connectSession(endpointId: string): Promise<CanDeviceSession> {
        const dev = this.knownDevices.find(d => d.endpoints.some(e => e.endpointId === endpointId));
        if (!dev) {
            throw new Error(`Endpoint '${endpointId}' not found in SLCAN provider`);
        }
        const ep = dev.endpoints.find(e => e.endpointId === endpointId)!;
        const session = new SlcanSession(dev, ep);
        this.activeSessions.set(endpointId, session);
        return session;
    }

    getSession(endpointId: string): SlcanSession | undefined {
        return this.activeSessions.get(endpointId);
    }
}
