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

/** Standard CAN frame (11-bit or 29-bit ID) */
export interface CanFrame {
    /** CAN identifier */
    id: number;
    /** true = extended 29-bit ID, false = standard 11-bit ID */
    extended: boolean;
    /** true = remote transmission request */
    rtr: boolean;
    /** Data payload (0-8 bytes for classical CAN, up to 64 for CAN FD) */
    data: number[];
    /** Data Length Code */
    dlc: number;
    /** Timestamp in milliseconds since capture start */
    timestamp: number;
    /** Interface name (e.g. 'can0', 'vcan0') */
    interface: string;
}

/** CAN bus interface configuration */
export interface CanInterfaceConfig {
    /** Interface name, e.g. 'can0', 'vcan0' */
    name: string;
    /** Bitrate in bps, e.g. 500000 */
    bitrate: number;
    /** Enable CAN FD */
    fd?: boolean;
}

/** Filter for CAN frames */
export interface CanFilter {
    /** CAN ID to match */
    id?: number;
    /** Mask applied to ID before comparison (default 0x7FF for 11-bit) */
    mask?: number;
    /** Include only extended frames */
    extended?: boolean;
    /** Include only standard frames */
    standard?: boolean;
    /** Include only data frames (not RTR) */
    dataOnly?: boolean;
}

/** Statistics for the CAN capture session */
export interface CanStatistics {
    totalFrames: number;
    framesPerSecond: number;
    errors: number;
    busLoad: number;
    startTime: number;
}

/** Events emitted by the CAN service */
export const CanServiceEvents = {
    FRAME_RECEIVED: 'frame-received',
    STATISTICS_UPDATED: 'statistics-updated',
    ERROR: 'can-error',
    STATUS_CHANGED: 'status-changed'
} as const;

export type CanServiceEvent = typeof CanServiceEvents[keyof typeof CanServiceEvents];

export const CanBusWidget = {
    ID: 'can-bus-widget',
    LABEL: 'CAN Bus Analyzer'
} as const;
