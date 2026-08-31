// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { Disposable, Event } from '@theia/core';
import { CanFrame } from './can-protocol';
import { CanExperimentSessionConfig } from './can-experiment-protocol';

export type CanDeviceTransportType = 'USB_CDC' | 'TCP' | 'UDP' | 'PCAN_BASIC' | 'SLCAN';

export interface CanDeviceEndpoint {
    readonly endpointId: string;
    readonly transportType: CanDeviceTransportType;
    readonly displayName: string;
    readonly address?: string;
    readonly port?: number;
    readonly serialPort?: string;
}

export interface CanDeviceCapabilities {
    readonly canFd: boolean;
    readonly maxDataLength: number;
    readonly maxBaudRate: number;
    readonly hardwareFilters: number;
    readonly hardwareTxQueue: number;
    readonly timestampResolutionNs: number;
    readonly galvanicIsolation: 'YES' | 'NO' | 'UNKNOWN';
}

export interface CanDeviceDescriptor {
    readonly deviceId: string;
    readonly name: string;
    readonly vendor: string;
    readonly hardwareRevision: string;
    readonly firmwareVersion: string;
    readonly serialNumber?: string;
    readonly endpoints: readonly CanDeviceEndpoint[];
    readonly capabilities: CanDeviceCapabilities;
}

export type CanDeviceEventType = 'FRAME_BATCH' | 'BUS_STATE' | 'GAP' | 'ERROR' | 'DISCONNECTED';

export interface CanDeviceBusState {
    readonly state: 'ERROR_ACTIVE' | 'ERROR_PASSIVE' | 'BUS_OFF';
    readonly txErrorCount: number;
    readonly rxErrorCount: number;
    readonly isBusOff: boolean;
}

export interface CanDeviceGapEvent {
    readonly droppedFramesEstimate: number;
    readonly reason: string;
}

export interface CanDeviceEvent {
    readonly type: CanDeviceEventType;
    readonly timestampNs: bigint;
    readonly busState?: CanDeviceBusState;
    readonly gap?: CanDeviceGapEvent;
    readonly error?: string;
}

export interface CanDeviceSession extends Disposable {
    readonly descriptor: CanDeviceDescriptor;
    readonly endpoint: CanDeviceEndpoint;
    readonly onFramesReceived: Event<readonly CanFrame[]>;
    readonly onDeviceEvent: Event<CanDeviceEvent>;
    configure(config: CanExperimentSessionConfig): Promise<boolean>;
    startCapture(): Promise<boolean>;
    stopCapture(): Promise<void>;
    transmitFrame(frame: CanFrame): Promise<boolean>;
    emergencyStop(): Promise<void>;
    isConnected(): boolean;
    close(): Promise<void>;
}

export const CanDeviceProvider = Symbol('CanDeviceProvider');

export interface CanDeviceProvider {
    readonly providerId: string;
    readonly displayName: string;
    discoverDevices(): Promise<readonly CanDeviceDescriptor[]>;
    connectSession(endpointId: string): Promise<CanDeviceSession>;
}
