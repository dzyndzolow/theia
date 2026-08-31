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
import { Disposable } from '@theia/core';
import { CanFrame } from '../common/can-protocol';
import { CanAdaptiveIdentifyAlgorithms, MinimalWakeupRecipe } from '../common/can-adaptive-identify';
import { CanTransmitService } from './can-transmit-service';

export const CanAdaptiveReplayService = Symbol('CanAdaptiveReplayService');

export interface CanAdaptiveReplayService extends Disposable {
    transmitSequence(frames: readonly CanFrame[], delayMs?: number): Promise<boolean>;
    minimizeSequence(
        sequence: readonly CanFrame[],
        evaluateSuccess: (subseq: readonly CanFrame[]) => Promise<boolean>
    ): Promise<MinimalWakeupRecipe>;
    bisectKeepAlive(
        minIntervalMs: number,
        maxIntervalMs: number,
        toleranceMs: number,
        evaluateSuccess: (intervalMs: number) => Promise<boolean>
    ): Promise<number>;
}

@injectable()
export class CanAdaptiveReplayServiceImpl implements CanAdaptiveReplayService {
    @inject(CanTransmitService)
    protected readonly transmitService!: CanTransmitService;

    private isDisposed = false;

    async transmitSequence(frames: readonly CanFrame[], delayMs = 10): Promise<boolean> {
        if (this.isDisposed || frames.length === 0) {
            return false;
        }

        for (let i = 0; i < frames.length; i++) {
            if (this.isDisposed) {
                return false;
            }
            const ok = await this.transmitService.transmit({
                frame: frames[i],
                sourceKind: 'PATTERN',
                sequenceIndex: i
            });
            if (!ok) {
                return false;
            }
            if (delayMs > 0 && i < frames.length - 1) {
                await new Promise(r => setTimeout(r, delayMs));
            }
        }
        return true;
    }

    async minimizeSequence(
        sequence: readonly CanFrame[],
        evaluateSuccess: (subseq: readonly CanFrame[]) => Promise<boolean>
    ): Promise<MinimalWakeupRecipe> {
        const minimized = await CanAdaptiveIdentifyAlgorithms.minimizeSequence(sequence, evaluateSuccess);

        const recipeType = minimized.length === 1 ? 'SINGLE_FRAME' : 'MULTI_FRAME_SEQUENCE';
        return {
            type: recipeType,
            frames: minimized,
            confirmedConfidence: 1.0,
            explanation: `Sequence reduced from ${sequence.length} frames to ${minimized.length} minimal essential frame(s).`
        };
    }

    async bisectKeepAlive(
        minIntervalMs: number,
        maxIntervalMs: number,
        toleranceMs = 20,
        evaluateSuccess: (intervalMs: number) => Promise<boolean>
    ): Promise<number> {
        return CanAdaptiveIdentifyAlgorithms.bisectKeepAliveInterval(
            minIntervalMs,
            maxIntervalMs,
            toleranceMs,
            evaluateSuccess
        );
    }

    dispose(): void {
        this.isDisposed = true;
    }
}
