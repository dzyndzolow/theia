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
import { Disposable, Emitter, Event } from '@theia/core';
import { CanFrame } from '../common/can-protocol';
import { FeedbackEvent } from '../common/can-experiment-protocol';
import { ManualFeedbackInput, IdTrafficStats } from '../common/can-feedback';
import { CanExperimentEventBus } from '../common/can-experiment-event-bus';

export const CanFeedbackService = Symbol('CanFeedbackService');

export interface CanFeedbackService extends Disposable {
    readonly onFeedbackRecorded: Event<FeedbackEvent>;
    setEventBus(eventBus: CanExperimentEventBus, sessionId: string): void;
    startBaseline(): void;
    freezeBaseline(): ReadonlyMap<number, IdTrafficStats>;
    recordManualFeedback(input: ManualFeedbackInput): FeedbackEvent;
    processRxFrame(frame: CanFrame, isEcho: boolean): FeedbackEvent | undefined;
    getBaselineStats(): ReadonlyMap<number, IdTrafficStats>;
}

@injectable()
export class CanFeedbackServiceImpl implements CanFeedbackService {
    private readonly onFeedbackRecordedEmitter = new Emitter<FeedbackEvent>();
    readonly onFeedbackRecorded: Event<FeedbackEvent> = this.onFeedbackRecordedEmitter.event;

    private eventBus?: CanExperimentEventBus;
    private sessionId = '';
    private feedbackCount = 0;
    private isCollectingBaseline = false;
    private baselineFrozen = false;
    private isDisposed = false;

    private readonly baselineMap = new Map<number, { count: number; firstSeenNs: bigint; lastSeenNs: bigint; lastPayload: number[] }>();
    private readonly activeMap = new Map<number, { count: number; firstSeenNs: bigint; lastSeenNs: bigint; lastPayload: number[] }>();

    setEventBus(eventBus: CanExperimentEventBus, sessionId: string): void {
        this.eventBus = eventBus;
        this.sessionId = sessionId;
    }

    startBaseline(): void {
        this.baselineMap.clear();
        this.activeMap.clear();
        this.isCollectingBaseline = true;
        this.baselineFrozen = false;
    }

    freezeBaseline(): ReadonlyMap<number, IdTrafficStats> {
        this.isCollectingBaseline = false;
        this.baselineFrozen = true;
        return this.getBaselineStats();
    }

    recordManualFeedback(input: ManualFeedbackInput): FeedbackEvent {
        const nowNs = input.timestampMonotonicNs || process.hrtime.bigint();
        const nowIso = new Date().toISOString();
        const eventId = `fb-manual-${++this.feedbackCount}-${nowNs}`;

        const event: FeedbackEvent = {
            eventId,
            sessionId: this.sessionId,
            timestampMonotonicNs: nowNs,
            wallClockIso: nowIso,
            type: 'FEEDBACK',
            kind: input.kind,
            feedbackType: input.feedbackType,
            source: 'HUMAN',
            confidence: input.confidence !== undefined ? input.confidence : 1.0,
            deltaValue: input.deltaValue,
            comment: input.comment
        };

        if (this.eventBus) {
            this.eventBus.publish(event);
        }
        this.onFeedbackRecordedEmitter.fire(event);
        return event;
    }

    processRxFrame(frame: CanFrame, isEcho: boolean): FeedbackEvent | undefined {
        if (this.isDisposed || isEcho) {
            // Local echo from driver is NEVER treated as DUT reaction
            return undefined;
        }

        const nowNs = process.hrtime.bigint();
        const id = frame.id;
        const payload = frame.data ? [...frame.data] : [];

        // Baseline collection mode
        if (this.isCollectingBaseline) {
            const entry = this.baselineMap.get(id);
            if (!entry) {
                this.baselineMap.set(id, {
                    count: 1,
                    firstSeenNs: nowNs,
                    lastSeenNs: nowNs,
                    lastPayload: payload
                });
            } else {
                entry.count++;
                entry.lastSeenNs = nowNs;
                entry.lastPayload = payload;
            }
            return undefined;
        }

        // Active experimentation mode (baseline frozen)
        if (this.baselineFrozen) {
            const isNewId = !this.baselineMap.has(id) && !this.activeMap.has(id);

            // Track active traffic
            const entry = this.activeMap.get(id);
            if (!entry) {
                this.activeMap.set(id, {
                    count: 1,
                    firstSeenNs: nowNs,
                    lastSeenNs: nowNs,
                    lastPayload: payload
                });
            } else {
                entry.count++;
                entry.lastSeenNs = nowNs;
                entry.lastPayload = payload;
            }

            if (isNewId) {
                const nowIso = new Date().toISOString();
                const eventId = `fb-rx-delta-${++this.feedbackCount}-${nowNs}`;

                const event: FeedbackEvent = {
                    eventId,
                    sessionId: this.sessionId,
                    timestampMonotonicNs: nowNs,
                    wallClockIso: nowIso,
                    type: 'FEEDBACK',
                    kind: 'POSITIVE',
                    feedbackType: 'CAN_ACTIVITY',
                    source: 'RX_DELTA',
                    confidence: 0.95,
                    comment: `RX_DELTA detected new spontaneous CAN ID 0x${id.toString(16).toUpperCase()}`
                };

                if (this.eventBus) {
                    this.eventBus.publish(event);
                }
                this.onFeedbackRecordedEmitter.fire(event);
                return event;
            }
        }

        return undefined;
    }

    getBaselineStats(): ReadonlyMap<number, IdTrafficStats> {
        const stats = new Map<number, IdTrafficStats>();
        for (const [id, e] of this.baselineMap.entries()) {
            const durationSec = Number(e.lastSeenNs - e.firstSeenNs) / 1e9;
            const freq = durationSec > 0 ? e.count / durationSec : 0;
            stats.set(id, {
                id,
                count: e.count,
                firstSeenNs: e.firstSeenNs,
                lastSeenNs: e.lastSeenNs,
                lastPayload: e.lastPayload,
                estimatedFrequencyHz: freq
            });
        }
        return stats;
    }

    dispose(): void {
        this.isDisposed = true;
        this.onFeedbackRecordedEmitter.dispose();
        this.baselineMap.clear();
        this.activeMap.clear();
        this.eventBus = undefined;
    }
}
