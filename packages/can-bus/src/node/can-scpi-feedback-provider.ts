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

export interface ScpiPowerConfig {
    readonly host?: string;
    readonly port?: number;
    readonly deltaCurrentThresholdA: number;
    readonly baselineCurrentA?: number;
    readonly pollIntervalMs?: number;
}

export interface IScpiTransport {
    query(cmd: string): Promise<string>;
    close(): void;
}

@injectable()
export class CanScpiPowerFeedbackProvider implements CanFeedbackSensorProvider {
    readonly id = 'scpi-power-sensor';
    readonly name = 'SCPI Power Supply Current Delta Sensor';
    readonly source: FeedbackSource = 'SCPI_POWER';

    private sessionId = '';
    private onFeedbackCallback?: (fb: FeedbackEvent) => void;
    private transport?: IScpiTransport;
    private timerHandle?: NodeJS.Timeout;
    private baselineCurrentA = 0.05; // 50mA default sleep baseline
    private deltaThresholdA = 0.1;   // 100mA default jump threshold
    private eventCount = 0;
    private isMonitoring = false;

    configure(config: ScpiPowerConfig, transport?: IScpiTransport): void {
        this.deltaThresholdA = config.deltaCurrentThresholdA;
        if (config.baselineCurrentA !== undefined) {
            this.baselineCurrentA = config.baselineCurrentA;
        }
        if (transport) {
            this.transport = transport;
        }
    }

    async startMonitoring(sessionId: string, onFeedback: (fb: FeedbackEvent) => void): Promise<void> {
        this.sessionId = sessionId;
        this.onFeedbackCallback = onFeedback;
        this.isMonitoring = true;
    }

    async processCurrentSample(currentA: number): Promise<FeedbackEvent | undefined> {
        if (!this.isMonitoring) {
            return undefined;
        }

        const delta = currentA - this.baselineCurrentA;
        if (delta >= this.deltaThresholdA) {
            const nowNs = process.hrtime.bigint();
            const nowIso = new Date().toISOString();
            const eventId = `fb-scpi-${++this.eventCount}-${nowNs}`;

            const fbEvent: FeedbackEvent = {
                eventId,
                sessionId: this.sessionId,
                timestampMonotonicNs: nowNs,
                wallClockIso: nowIso,
                type: 'FEEDBACK',
                kind: 'POSITIVE',
                feedbackType: 'POWER',
                source: 'SCPI_POWER',
                confidence: 0.99,
                deltaValue: delta,
                comment: `Current jump ΔI = ${(delta * 1000).toFixed(1)} mA (exceeds ${(this.deltaThresholdA * 1000).toFixed(1)} mA threshold)`
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
        if (this.timerHandle) {
            clearInterval(this.timerHandle);
            this.timerHandle = undefined;
        }
    }

    dispose(): void {
        this.stopMonitoring();
        if (this.transport) {
            this.transport.close();
            this.transport = undefined;
        }
    }
}
