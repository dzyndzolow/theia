// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, multiInject, optional } from '@theia/core/shared/inversify';
import {
    CanDeviceDescriptor,
    CanDeviceProvider,
    CanDeviceSession
} from '../../common/can-device';

export const CanDeviceRegistry = Symbol('CanDeviceRegistry');

export interface CanDeviceRegistry {
    registerProvider(provider: CanDeviceProvider): void;
    discoverAllDevices(): Promise<readonly CanDeviceDescriptor[]>;
    connectSession(endpointId: string): Promise<CanDeviceSession>;
    getActiveSession(deviceId: string): CanDeviceSession | undefined;
}

@injectable()
export class CanDeviceRegistryImpl implements CanDeviceRegistry {
    private readonly providers = new Map<string, CanDeviceProvider>();
    private readonly activeSessions = new Map<string, CanDeviceSession>();

    constructor(
        @multiInject(CanDeviceProvider) @optional() providers: CanDeviceProvider[] = []
    ) {
        for (const p of providers) {
            this.registerProvider(p);
        }
    }

    registerProvider(provider: CanDeviceProvider): void {
        this.providers.set(provider.providerId, provider);
    }

    async discoverAllDevices(): Promise<readonly CanDeviceDescriptor[]> {
        const deviceMap = new Map<string, CanDeviceDescriptor>();

        for (const provider of this.providers.values()) {
            try {
                const found = await provider.discoverDevices();
                for (const dev of found) {
                    if (deviceMap.has(dev.deviceId)) {
                        // Merge endpoints for multi-transport hardware (e.g. USB + TCP)
                        const existing = deviceMap.get(dev.deviceId)!;
                        const mergedEndpoints = [...existing.endpoints, ...dev.endpoints];
                        deviceMap.set(dev.deviceId, {
                            ...existing,
                            endpoints: mergedEndpoints
                        });
                    } else {
                        deviceMap.set(dev.deviceId, dev);
                    }
                }
            } catch {
                /* provider discovery failure handled gracefully */
            }
        }

        return Array.from(deviceMap.values());
    }

    async connectSession(endpointId: string): Promise<CanDeviceSession> {
        // 1. Find provider owning endpoint
        const allDevices = await this.discoverAllDevices();
        let targetDev: CanDeviceDescriptor | undefined;
        for (const dev of allDevices) {
            if (dev.endpoints.some(e => e.endpointId === endpointId)) {
                targetDev = dev;
                break;
            }
        }

        if (!targetDev) {
            throw new Error(`Endpoint '${endpointId}' is not available in any registered provider`);
        }

        // 2. Check Single Control Lease invariant per deviceId
        if (this.activeSessions.has(targetDev.deviceId)) {
            const active = this.activeSessions.get(targetDev.deviceId)!;
            if (active.isConnected()) {
                throw new Error(`Device '${targetDev.deviceId}' is busy: active control lease held on endpoint '${active.endpoint.endpointId}'`);
            }
        }

        // 3. Connect via provider
        for (const provider of this.providers.values()) {
            const found = await provider.discoverDevices();
            if (found.some(d => d.endpoints.some(e => e.endpointId === endpointId))) {
                const session = await provider.connectSession(endpointId);
                this.activeSessions.set(targetDev.deviceId, session);
                return session;
            }
        }

        throw new Error(`Failed to establish session for endpoint '${endpointId}'`);
    }

    getActiveSession(deviceId: string): CanDeviceSession | undefined {
        const session = this.activeSessions.get(deviceId);
        return session && session.isConnected() ? session : undefined;
    }
}
