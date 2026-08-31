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
import {
    CanDeviceDescriptor,
    CanDeviceEndpoint,
    CanDeviceProvider,
    CanDeviceSession
} from '../../common/can-device';
import { Esp32CanSession, IByteTransport } from './esp32-can-session';

@injectable()
export class Esp32CanDeviceProvider implements CanDeviceProvider {
    readonly providerId = 'esp32-can-provider';
    readonly displayName = 'ESP32-S3 Isolated CAN Provider';

    private mockTransports = new Map<string, IByteTransport>();
    private knownDevices: CanDeviceDescriptor[] = [];

    /** Adds deterministic descriptors used only by hardware-layer tests. */
    enableTestFixtures(): void {
        if (this.knownDevices.some(device => device.deviceId === 'esp32s3-can-ref01')) {
            return;
        }
        this.knownDevices.push({
            deviceId: 'esp32s3-can-ref01',
            name: 'ESP32-S3 Isolated CAN Module (Ref 01)',
            vendor: 'Theia Embedded',
            hardwareRevision: 'v1.2',
            firmwareVersion: '1.0.0',
            serialNumber: 'TH-CAN-0001',
            endpoints: [
                {
                    endpointId: 'esp32s3-can:ref01:usb',
                    transportType: 'USB_CDC',
                    displayName: 'USB Native CDC (COM3 / ttyACM0)',
                    serialPort: 'COM3'
                },
                {
                    endpointId: 'esp32s3-can:ref01:tcp',
                    transportType: 'TCP',
                    displayName: 'Ethernet TCP (192.168.1.150:9751)',
                    address: '192.168.1.150',
                    port: 9751
                }
            ],
            capabilities: {
                canFd: false,
                maxDataLength: 8,
                maxBaudRate: 1000000,
                hardwareFilters: 16,
                hardwareTxQueue: 32,
                timestampResolutionNs: 1000,
                galvanicIsolation: 'YES'
            }
        });
    }

    registerMockTransport(endpointId: string, transport: IByteTransport): void {
        this.mockTransports.set(endpointId, transport);
    }

    registerTcpEndpoint(host: string, port = 9751, customName?: string): CanDeviceEndpoint {
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
            throw new Error('A valid ESP32 host and TCP port are required.');
        }
        const endpointId = `esp32s3-can:tcp:${host}:${port}`;
        const displayName = customName || `ESP32-S3 TCP (${host}:${port})`;
        const endpoint: CanDeviceEndpoint = {
            endpointId,
            transportType: 'TCP',
            displayName,
            address: host,
            port
        };

        const existingDevice = this.knownDevices.find(d => d.endpoints.some(e => e.address === host && e.port === port));
        if (existingDevice) {
            return endpoint;
        }

        const newDevice: CanDeviceDescriptor = {
            deviceId: `esp32s3-${host.replace(/[^a-zA-Z0-9]/g, '_')}-${port}`,
            name: customName || `Unverified ESP32-S3 endpoint (${host}:${port})`,
            vendor: 'Unverified',
            hardwareRevision: 'unknown',
            firmwareVersion: 'unknown',
            endpoints: [endpoint],
            capabilities: {
                canFd: false,
                maxDataLength: 8,
                maxBaudRate: 1000000,
                hardwareFilters: 0,
                hardwareTxQueue: 0,
                timestampResolutionNs: 0,
                galvanicIsolation: 'UNKNOWN'
            }
        };

        this.knownDevices.push(newDevice);
        return endpoint;
    }

    async discoverDevices(): Promise<readonly CanDeviceDescriptor[]> {
        return this.knownDevices;
    }

    async connectSession(endpointId: string): Promise<CanDeviceSession> {
        let matchedDesc: CanDeviceDescriptor | undefined;
        let matchedEndpoint = undefined;

        for (const desc of this.knownDevices) {
            const ep = desc.endpoints.find(e => e.endpointId === endpointId);
            if (ep) {
                matchedDesc = desc;
                matchedEndpoint = ep;
                break;
            }
        }

        if (!matchedDesc || !matchedEndpoint) {
            throw new Error(`Endpoint '${endpointId}' not found in ESP32 provider`);
        }

        let transport: IByteTransport;
        if (this.mockTransports.has(endpointId)) {
            transport = this.mockTransports.get(endpointId)!;
        } else if (matchedEndpoint.transportType === 'TCP' && matchedEndpoint.address) {
            throw new Error(
                `Authenticated TCAN v1 handshake for '${endpointId}' is not implemented; `
                + 'the endpoint remains capture/TX unavailable rather than operating without identity and response validation.'
            );
        } else {
            throw new Error(`Transport for endpoint '${endpointId}' requires active hardware port or mock transport`);
        }

        const session = new Esp32CanSession(matchedDesc, matchedEndpoint, transport);
        await session.initHandshake();
        return session;
    }
}
