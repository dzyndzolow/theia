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
import { FeedbackEvent, FeedbackSource } from '../common/can-experiment-protocol';
import { CanFeedbackSensorProvider } from '../common/can-feedback-provider';

export interface GpioSensorConfig {
    readonly pinNumber: number;
    readonly triggerEdge: 'RISING' | 'FALLING' | 'BOTH';
}

@injectable()
export class CanGpioFeedbackProvider implements CanFeedbackSensorProvider {
    readonly id = 'gpio-sensor';
    readonly name = 'GPIO Digital Pin Edge Sensor';
    readonly source: FeedbackSource = 'GPIO';

    private sessionId = '';
    private onFeedbackCallback?: (fb: FeedbackEvent) => void;
    private lastState: 0 | 1 = 0;
    private eventCount = 0;
    private isMonitoring = false;

    async startMonitoring(sessionId: string, onFeedback: (fb: FeedbackEvent) => void): Promise<void> {
        this.sessionId = sessionId;
        this.onFeedbackCallback = onFeedback;
        this.isMonitoring = true;
    }

    processPinTransition(newState: 0 | 1): FeedbackEvent | undefined {
        if (!this.isMonitoring) {
            return undefined;
        }

        if (newState !== this.lastState) {
            const isRising = newState === 1;
            this.lastState = newState;

            const nowNs = process.hrtime.bigint();
            const nowIso = new Date().toISOString();
            const eventId = `fb-gpio-${++this.eventCount}-${nowNs}`;

            const fbEvent: FeedbackEvent = {
                eventId,
                sessionId: this.sessionId,
                timestampMonotonicNs: nowNs,
                wallClockIso: nowIso,
                type: 'FEEDBACK',
                kind: 'POSITIVE',
                feedbackType: 'OTHER',
                source: 'GPIO',
                confidence: 1.0,
                comment: `GPIO pin transition: ${isRising ? 'RISING (0 -> 1)' : 'FALLING (1 -> 0)'}`
            };

            if (this.onFeedbackCallback) {
                this.onFeedbackCallback(fbEvent);
            }
            return fbEvent;
        }
        return undefined;
    }

    async stopMonitoring(): Promise<void> {
        this.isMonitoring = false;
    }

    dispose(): void {
        this.stopMonitoring();
    }
}
