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
import { Disposable } from '@theia/core';
import { CanFrame } from '../common/can-protocol';
import {
    CanExperimentSessionConfig,
    CanExperimentState,
    TxSourceKind,
    TxFrameEvent
} from '../common/can-experiment-protocol';
import { CanSafetyPolicy, BusMetricsSnapshot } from '../common/can-safety-policy';
import { CanExperimentEventBus } from '../common/can-experiment-event-bus';

export interface CanTransmitRequest {
    readonly frame: CanFrame;
    readonly sourceKind: TxSourceKind;
    readonly campaignId?: string;
    readonly trialId?: string;
    readonly sequenceIndex?: number;
    readonly deadlineMs?: number;
}

export interface CanTransmitAdapter {
    sendFrame(frame: CanFrame): Promise<boolean> | boolean;
}

export const CanTransmitService = Symbol('CanTransmitService');

export interface CanTransmitService extends Disposable {
    setSessionConfig(config: CanExperimentSessionConfig, eventBus: CanExperimentEventBus): void;
    setState(state: CanExperimentState): void;
    setAdapter(adapter: CanTransmitAdapter): void;
    updateMetrics(metrics: BusMetricsSnapshot): void;
    transmit(request: CanTransmitRequest): Promise<boolean>;
    stop(): void;
}

@injectable()
export class CanTransmitServiceImpl implements CanTransmitService {
    private sessionConfig?: CanExperimentSessionConfig;
    private eventBus?: CanExperimentEventBus;
    private adapter?: CanTransmitAdapter;
    private currentState: CanExperimentState = 'DISARMED';
    private currentMetrics?: BusMetricsSnapshot;
    private txCount = 0;
    private recentTxNs: bigint[] = [];
    private isDisposed = false;

    setSessionConfig(config: CanExperimentSessionConfig, eventBus: CanExperimentEventBus): void {
        // Any change in configuration automatically disarms the active session
        this.currentState = 'DISARMED';
        this.sessionConfig = config;
        this.eventBus = eventBus;
        this.recentTxNs = [];
    }

    setState(state: CanExperimentState): void {
        this.currentState = state;
        if (state !== 'RUNNING' && state !== 'ARMED') {
            this.recentTxNs = [];
        }
    }

    setAdapter(adapter: CanTransmitAdapter): void {
        this.adapter = adapter;
    }

    updateMetrics(metrics: BusMetricsSnapshot): void {
        this.currentMetrics = metrics;
        if (metrics.isBusOff && this.currentState === 'RUNNING') {
            this.currentState = 'FAULT';
            this.stop();
        }
    }

    async transmit(request: CanTransmitRequest): Promise<boolean> {
        if (this.isDisposed || !this.sessionConfig) {
            return false;
        }

        const nowNs = process.hrtime.bigint();
        const nowIso = new Date().toISOString();
        const eventId = `tx-${++this.txCount}-${nowNs}`;

        // 1. Strict safety evaluation
        const oneSecondAgo = nowNs - 1_000_000_000n;
        while (this.recentTxNs.length > 0 && this.recentTxNs[0] < oneSecondAgo) {
            this.recentTxNs.shift();
        }
        const rateMetrics: BusMetricsSnapshot = {
            currentFps: Math.max(this.currentMetrics?.currentFps ?? 0, this.recentTxNs.length),
            estimatedBusLoadPercent: this.currentMetrics?.estimatedBusLoadPercent ?? 0,
            consecutiveErrors: this.currentMetrics?.consecutiveErrors ?? 0,
            isBusOff: this.currentMetrics?.isBusOff ?? false
        };
        const validation = CanSafetyPolicy.validateTx(
            request.frame,
            this.currentState,
            this.sessionConfig,
            rateMetrics
        );

        if (!validation.valid) {
            if (this.eventBus) {
                const errorTxEvent: TxFrameEvent = {
                    eventId,
                    sessionId: this.sessionConfig.sessionId,
                    timestampMonotonicNs: nowNs,
                    wallClockIso: nowIso,
                    type: 'TX_FRAME',
                    frame: request.frame,
                    sourceKind: request.sourceKind,
                    status: 'ADAPTER_ERROR',
                    campaignId: request.campaignId,
                    trialId: request.trialId,
                    sequenceIndex: request.sequenceIndex
                };
                this.eventBus.publish(errorTxEvent);
            }
            return false;
        }

        // 2. Transmit via low-level adapter
        if (!this.adapter) {
            return false;
        }

        // Reserve the rate-limit slot before awaiting the adapter so parallel
        // callers cannot race past the configured maximum.
        this.recentTxNs.push(nowNs);

        let sentSuccess = false;
        try {
            sentSuccess = await this.adapter.sendFrame(request.frame);
        } catch {
            sentSuccess = false;
        }

        // 3. Monotonic audit logging to Journal
        if (this.eventBus) {
            const publishNs = process.hrtime.bigint();
            const txEvent: TxFrameEvent = {
                eventId,
                sessionId: this.sessionConfig.sessionId,
                timestampMonotonicNs: publishNs >= nowNs ? publishNs : nowNs,
                wallClockIso: new Date().toISOString(),
                type: 'TX_FRAME',
                frame: request.frame,
                sourceKind: request.sourceKind,
                status: sentSuccess ? 'SENT' : 'ADAPTER_ERROR',
                campaignId: request.campaignId,
                trialId: request.trialId,
                sequenceIndex: request.sequenceIndex
            };
            this.eventBus.publish(txEvent);
        }

        return sentSuccess;
    }

    stop(): void {
        // Priority immediate cutoff
        if (this.currentState === 'RUNNING' || this.currentState === 'ARMED') {
            this.currentState = 'STOPPED';
        }
        this.recentTxNs = [];
    }

    dispose(): void {
        this.isDisposed = true;
        this.stop();
        this.adapter = undefined;
        this.eventBus = undefined;
        this.sessionConfig = undefined;
    }
}
