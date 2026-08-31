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

/**
 * State machine for safe bench-isolated CAN experimentation.
 */
export type CanExperimentState =
    | 'DISARMED'
    | 'ARMED'
    | 'RUNNING'
    | 'STOPPING'
    | 'STOPPED'
    | 'FAULT';

export type CanExperimentMode = 'CAN_2_0' | 'CAN_FD';

export type CanIdMode = 'STANDARD_11BIT' | 'EXTENDED_29BIT' | 'MIXED';

/**
 * Full session configuration with mandatory safety boundaries.
 */
export interface CanExperimentSessionConfig {
    readonly sessionId: string;
    readonly interfaceName: string;
    readonly bitrate: number;
    readonly dataBitrate?: number;
    readonly mode: CanExperimentMode;
    readonly idMode: CanIdMode;
    /**
     * Explicit allowlist of allowed CAN IDs.
     * Full scan of standard 0x000-0x7FF requires explicit bench confirmation flag.
     */
    readonly allowedIds: readonly number[] | 'ALLOW_ALL_11BIT_BENCH_ONLY';
    readonly maxFps: number;
    readonly maxBusLoadPercent: number;
    readonly maxDurationMs: number;
    /** Safety invariants: default false */
    readonly allowRemoteFrames?: boolean;
    readonly allowErrorFrames?: boolean;
    readonly allowDiagnosticServices?: boolean;
    readonly requireAckConfirmation?: boolean;
}

export type FeedbackKind = 'POSITIVE' | 'NEGATIVE' | 'UNCERTAIN';

export type FeedbackType =
    | 'WAKE'
    | 'LAMP'
    | 'DISPLAY'
    | 'SOUND'
    | 'POWER'
    | 'CAN_ACTIVITY'
    | 'OTHER';

export type FeedbackSource =
    | 'HUMAN'
    | 'RX_DELTA'
    | 'SCPI_POWER'
    | 'GPIO'
    | 'AUDIO'
    | 'CAMERA'
    | 'PLUGIN';

export type ExperimentEventType =
    | 'STATE_CHANGE'
    | 'TX_FRAME'
    | 'RX_FRAME'
    | 'FEEDBACK'
    | 'ERROR'
    | 'BUS_STAT';

export interface BaseExperimentEvent {
    readonly eventId: string;
    readonly sessionId: string;
    readonly timestampMonotonicNs: bigint;
    readonly wallClockIso: string;
    readonly type: ExperimentEventType;
}

export interface StateChangeEvent extends BaseExperimentEvent {
    readonly type: 'STATE_CHANGE';
    readonly previousState: CanExperimentState;
    readonly newState: CanExperimentState;
    readonly reason: string;
}

export type TxSourceKind =
    | 'LITERAL'
    | 'PATTERN'
    | 'IMPORTED'
    | 'VARIABLE'
    | 'GENERATOR'
    | 'SCRIPT';

export type TxStatus =
    | 'QUEUED'
    | 'SENT'
    | 'DRIVER_ECHO'
    | 'DEADLINE_MISSED'
    | 'ADAPTER_ERROR';

export interface TxFrameEvent extends BaseExperimentEvent {
    readonly type: 'TX_FRAME';
    readonly campaignId?: string;
    readonly trialId?: string;
    readonly sequenceIndex?: number;
    readonly frame: CanFrame;
    readonly sourceKind: TxSourceKind;
    readonly status: TxStatus;
}

export interface RxFrameEvent extends BaseExperimentEvent {
    readonly type: 'RX_FRAME';
    readonly frame: CanFrame;
    readonly isEcho: boolean;
}

export interface FeedbackEvent extends BaseExperimentEvent {
    readonly type: 'FEEDBACK';
    readonly kind: FeedbackKind;
    readonly feedbackType: FeedbackType;
    readonly source: FeedbackSource;
    readonly confidence?: number;
    readonly deltaValue?: number;
    readonly comment?: string;
}

export interface ErrorEvent extends BaseExperimentEvent {
    readonly type: 'ERROR';
    readonly code:
        | 'BUS_OFF'
        | 'ERROR_PASSIVE'
        | 'OVERLOAD'
        | 'DEADLINE_EXCEEDED'
        | 'SAFETY_VIOLATION'
        | 'ADAPTER_DISCONNECT'
        | 'UNKNOWN';
    readonly message: string;
}

export type ExperimentEvent =
    | StateChangeEvent
    | TxFrameEvent
    | RxFrameEvent
    | FeedbackEvent
    | ErrorEvent;

/**
 * Contribution point for external feedback providers (e.g. SCPI power, GPIO).
 * Strictly read-only / feedback emitting; never possesses TX capabilities.
 */
export interface CanFeedbackProvider {
    readonly id: string;
    readonly displayName: string;
    start(sessionId: string, emitFeedback: (event: Omit<FeedbackEvent, 'eventId' | 'sessionId' | 'type'>) => void): Promise<void> | void;
    stop(): Promise<void> | void;
}

/**
 * Contribution point for declarative scenario importers (DBC, KCD, ARXML, CSV, candump).
 * Strictly declarative data parsing; never arms or sends CAN frames directly.
 */
export interface CanScenarioImporter {
    readonly id: string;
    readonly displayName: string;
    readonly fileExtensions: readonly string[];
    parse(content: string | ArrayBuffer): Promise<Record<string, unknown>> | Record<string, unknown>;
}
