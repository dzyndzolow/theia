// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from './can-protocol';
import { CanExperimentSessionConfig, CanExperimentState } from './can-experiment-protocol';

export interface TxValidationResult {
    readonly valid: boolean;
    readonly reason?: string;
    readonly violationCode?:
        | 'NOT_RUNNING'
        | 'ID_NOT_ALLOWED'
        | 'REMOTE_FRAME_FORBIDDEN'
        | 'EXTENDED_ID_FORBIDDEN'
        | 'DIAGNOSTIC_SERVICE_FORBIDDEN'
        | 'RATE_LIMIT_EXCEEDED'
        | 'BUS_LOAD_EXCEEDED'
        | 'INVALID_DLC'
        | 'INVALID_FRAME';
}

export interface BusMetricsSnapshot {
    readonly currentFps: number;
    readonly estimatedBusLoadPercent: number;
    readonly consecutiveErrors: number;
    readonly isBusOff: boolean;
}

/** Dangerous or state-modifying UDS / ISO 14229 Service IDs blocked by default. */
const RESTRICTED_DIAGNOSTIC_SIDS = new Set<number>([
    0x27, // SecurityAccess
    0x28, // CommunicationControl
    0x2E, // WriteDataByIdentifier
    0x2F, // InputOutputControlByIdentifier
    0x31, // RoutineControl (start/stop memory routines)
    0x34, // RequestDownload
    0x35, // RequestUpload
    0x36, // TransferData
    0x37, // RequestTransferExit
    0x85  // ControlDTCSetting
]);

export class CanSafetyPolicy {
    /**
     * Strictly validates whether a frame may be sent under the active session state and policy.
     */
    static validateTx(
        frame: CanFrame,
        state: CanExperimentState,
        config: CanExperimentSessionConfig,
        metrics?: BusMetricsSnapshot
    ): TxValidationResult {
        if (state !== 'RUNNING') {
            return {
                valid: false,
                reason: `Cannot transmit frame while session is in state '${state}' (must be RUNNING).`,
                violationCode: 'NOT_RUNNING'
            };
        }

        if (metrics?.isBusOff) {
            return {
                valid: false,
                reason: 'Cannot transmit frame: CAN controller is in BUS_OFF state.',
                violationCode: 'NOT_RUNNING'
            };
        }

        const maxDataLength = config.mode === 'CAN_FD' ? 64 : 8;
        if (!Number.isInteger(frame.id) || frame.id < 0 || frame.id > 0x1FFFFFFF) {
            return {
                valid: false,
                reason: `Invalid CAN identifier '${frame.id}'.`,
                violationCode: 'INVALID_FRAME'
            };
        }

        if (!Number.isInteger(frame.dlc) || frame.dlc < 0 || frame.dlc > maxDataLength) {
            return {
                valid: false,
                reason: `Invalid DLC ${frame.dlc} for ${config.mode} mode.`,
                violationCode: 'INVALID_DLC'
            };
        }

        if (!Array.isArray(frame.data)
            || (!frame.rtr && frame.data.length !== frame.dlc)
            || (frame.rtr && frame.data.length !== 0)
            || frame.data.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 0xFF)) {
            return {
                valid: false,
                reason: 'CAN frame payload does not exactly match DLC or contains a non-byte value.',
                violationCode: 'INVALID_FRAME'
            };
        }

        if (!Number.isFinite(frame.timestamp) || typeof frame.interface !== 'string' || frame.interface.length === 0) {
            return {
                valid: false,
                reason: 'CAN frame timestamp or interface is invalid.',
                violationCode: 'INVALID_FRAME'
            };
        }

        if (frame.rtr && !config.allowRemoteFrames) {
            return {
                valid: false,
                reason: 'Remote transmission request (RTR) frames are forbidden by default safety policy.',
                violationCode: 'REMOTE_FRAME_FORBIDDEN'
            };
        }

        if (frame.extended && config.idMode === 'STANDARD_11BIT') {
            return {
                valid: false,
                reason: `Extended 29-bit CAN ID 0x${frame.id.toString(16)} forbidden in STANDARD_11BIT mode.`,
                violationCode: 'EXTENDED_ID_FORBIDDEN'
            };
        }

        if (!frame.extended && frame.id > 0x7FF) {
            return {
                valid: false,
                reason: `Standard CAN ID 0x${frame.id.toString(16)} exceeds 11-bit range (0x7FF).`,
                violationCode: 'ID_NOT_ALLOWED'
            };
        }

        if (!this.isIdAllowed(frame.id, frame.extended, config.allowedIds)) {
            return {
                valid: false,
                reason: `CAN ID 0x${frame.id.toString(16)} is not on the session allowlist.`,
                violationCode: 'ID_NOT_ALLOWED'
            };
        }

        if (!config.allowDiagnosticServices && this.isRestrictedDiagnosticPayload(frame)) {
            return {
                valid: false,
                reason: 'State-modifying diagnostic/security service payload forbidden in standard bench safety profile.',
                violationCode: 'DIAGNOSTIC_SERVICE_FORBIDDEN'
            };
        }

        if (metrics) {
            if (config.maxFps > 0 && metrics.currentFps >= config.maxFps) {
                return {
                    valid: false,
                    reason: `Current rate (${metrics.currentFps} FPS) exceeds safety limit (${config.maxFps} FPS).`,
                    violationCode: 'RATE_LIMIT_EXCEEDED'
                };
            }

            if (config.maxBusLoadPercent > 0 && metrics.estimatedBusLoadPercent > config.maxBusLoadPercent) {
                return {
                    valid: false,
                    reason: `Estimated bus load (${metrics.estimatedBusLoadPercent.toFixed(1)}%) exceeds safety limit (${config.maxBusLoadPercent}%).`,
                    violationCode: 'BUS_LOAD_EXCEEDED'
                };
            }
        }

        return { valid: true };
    }

    /**
     * Checks if a state transition is legal according to safety invariants.
     */
    static transition(
        currentState: CanExperimentState,
        action: 'ARM' | 'START' | 'STOP' | 'FAULT' | 'DISARM' | 'RESET'
    ): { nextState: CanExperimentState; allowed: boolean; reason?: string } {
        switch (action) {
            case 'ARM':
                if (currentState === 'DISARMED' || currentState === 'STOPPED') {
                    return { nextState: 'ARMED', allowed: true };
                }
                return {
                    nextState: currentState,
                    allowed: false,
                    reason: `Cannot ARM from state '${currentState}'.`
                };

            case 'START':
                if (currentState === 'ARMED') {
                    return { nextState: 'RUNNING', allowed: true };
                }
                return {
                    nextState: currentState,
                    allowed: false,
                    reason: `Cannot START unless session is ARMED (current: '${currentState}').`
                };

            case 'STOP':
                if (currentState === 'RUNNING' || currentState === 'ARMED') {
                    return { nextState: 'STOPPED', allowed: true };
                }
                return { nextState: 'STOPPED', allowed: true };

            case 'FAULT':
                return { nextState: 'FAULT', allowed: true };

            case 'DISARM':
                return { nextState: 'DISARMED', allowed: true };

            case 'RESET':
                if (currentState === 'FAULT' || currentState === 'STOPPED') {
                    return { nextState: 'DISARMED', allowed: true };
                }
                return {
                    nextState: currentState,
                    allowed: false,
                    reason: `Cannot RESET while active (current: '${currentState}').`
                };

            default:
                return {
                    nextState: currentState,
                    allowed: false,
                    reason: `Unknown action '${action}'.`
                };
        }
    }

    private static isIdAllowed(
        id: number,
        extended: boolean,
        allowed: readonly number[] | 'ALLOW_ALL_11BIT_BENCH_ONLY'
    ): boolean {
        if (allowed === 'ALLOW_ALL_11BIT_BENCH_ONLY') {
            return !extended && id >= 0 && id <= 0x7FF;
        }
        return allowed.includes(id);
    }

    private static isRestrictedDiagnosticPayload(frame: CanFrame): boolean {
        if (!frame.data || frame.data.length < 2) {
            return false;
        }
        // Check for Single Frame (PCI 0x0N) or First Frame (PCI 0x1N) UDS patterns
        const pciByte = frame.data[0];
        const pciType = (pciByte & 0xF0) >> 4;
        let sid = -1;

        if (pciType === 0) {
            // ISO-TP Single Frame: Byte 1 is SID
            sid = frame.data[1];
        } else if (pciType === 1 && frame.data.length >= 3) {
            // ISO-TP First Frame: Byte 2 is SID
            sid = frame.data[2];
        }

        if (sid >= 0 && RESTRICTED_DIAGNOSTIC_SIDS.has(sid)) {
            return true;
        }

        return false;
    }
}
