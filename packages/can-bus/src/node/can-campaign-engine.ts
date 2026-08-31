// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable, inject } from '@theia/core/shared/inversify';
import { Disposable, Emitter, Event } from '@theia/core';
import { CanCampaignPlanner, CampaignPlanConfig, CampaignTrialConfig, CampaignSummary } from '../common/can-campaign';
import { CanTransmitService } from './can-transmit-service';
import { CanFrame } from '../common/can-protocol';

export type CampaignStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'STOPPED';

export interface CampaignProgress {
    readonly campaignId: string;
    readonly status: CampaignStatus;
    readonly currentTrialIndex: number;
    readonly totalTrials: number;
    readonly activeTrial?: CampaignTrialConfig;
    readonly sentFramesCount: number;
}

export const CanCampaignEngine = Symbol('CanCampaignEngine');

export interface CanCampaignEngine extends Disposable {
    readonly onProgress: Event<CampaignProgress>;
    configure(config: CampaignPlanConfig): CampaignSummary;
    start(): Promise<void>;
    pause(): void;
    resume(): void;
    stop(): void;
    getStatus(): CampaignStatus;
}

@injectable()
export class CanCampaignEngineImpl implements CanCampaignEngine {
    @inject(CanTransmitService)
    protected readonly transmitService!: CanTransmitService;

    private readonly onProgressEmitter = new Emitter<CampaignProgress>();
    readonly onProgress: Event<CampaignProgress> = this.onProgressEmitter.event;

    private currentConfig?: CampaignPlanConfig;
    private trials: readonly CampaignTrialConfig[] = [];
    private summary?: CampaignSummary;
    private status: CampaignStatus = 'IDLE';
    private currentTrialIndex = 0;
    private sentFramesCount = 0;
    private isAborted = false;
    private isDisposed = false;

    configure(config: CampaignPlanConfig): CampaignSummary {
        this.stop();
        this.currentConfig = config;
        const plan = CanCampaignPlanner.buildPlan(config);
        this.trials = plan.trials;
        this.summary = plan.summary;
        this.currentTrialIndex = 0;
        this.sentFramesCount = 0;
        this.status = 'IDLE';
        return this.summary;
    }

    async start(): Promise<void> {
        if (this.trials.length === 0 || this.isDisposed) {
            return;
        }

        this.status = 'RUNNING';
        this.isAborted = false;
        this.currentTrialIndex = 0;
        this.sentFramesCount = 0;

        await this.runCampaignLoop();
    }

    pause(): void {
        if (this.status === 'RUNNING') {
            this.status = 'PAUSED';
            this.emitProgress();
        }
    }

    resume(): void {
        if (this.status === 'PAUSED') {
            this.status = 'RUNNING';
            this.emitProgress();
            this.runCampaignLoop().catch(() => { /* handled */ });
        }
    }

    stop(): void {
        this.isAborted = true;
        if (this.status !== 'STOPPED' && this.status !== 'IDLE') {
            this.status = 'STOPPED';
            this.emitProgress();
        }
    }

    getStatus(): CampaignStatus {
        return this.status;
    }

    private async runCampaignLoop(): Promise<void> {
        while (this.currentTrialIndex < this.trials.length && !this.isAborted) {
            if (this.status === 'PAUSED') {
                return;
            }
            if (this.status !== 'RUNNING') {
                break;
            }

            const trial = this.trials[this.currentTrialIndex];
            this.emitProgress(trial);

            // Execute trial repetitions
            for (let rep = 0; rep < trial.repeatCount; rep++) {
                if (this.isAborted || this.status !== 'RUNNING') {
                    break;
                }

                const frame: CanFrame = {
                    id: trial.targetId,
                    extended: trial.extended,
                    rtr: false,
                    dlc: trial.dlc,
                    data: [...trial.payload],
                    timestamp: Date.now(),
                    interface: 'vcan0'
                };

                await this.transmitService.transmit({
                    frame,
                    sourceKind: 'PATTERN',
                    campaignId: this.currentConfig?.campaignId,
                    trialId: trial.trialId,
                    sequenceIndex: rep
                });

                this.sentFramesCount++;

                if (trial.repeatIntervalMs > 0) {
                    await this.delay(trial.repeatIntervalMs);
                }
            }

            // Dwell time after trial (listening for DUT response)
            if (!this.isAborted && this.status === 'RUNNING' && trial.dwellAfterMs > 0) {
                await this.delay(trial.dwellAfterMs);
            }

            this.currentTrialIndex++;
        }

        if (!this.isAborted && this.currentTrialIndex >= this.trials.length) {
            this.status = 'COMPLETED';
            this.emitProgress();
        }
    }

    private emitProgress(activeTrial?: CampaignTrialConfig): void {
        this.onProgressEmitter.fire({
            campaignId: this.currentConfig?.campaignId || '',
            status: this.status,
            currentTrialIndex: this.currentTrialIndex,
            totalTrials: this.trials.length,
            activeTrial: activeTrial || (this.currentTrialIndex < this.trials.length ? this.trials[this.currentTrialIndex] : undefined),
            sentFramesCount: this.sentFramesCount
        });
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    dispose(): void {
        this.isDisposed = true;
        this.stop();
        this.onProgressEmitter.dispose();
        this.trials = [];
    }
}
