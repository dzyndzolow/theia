// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { FeedbackType } from './can-experiment-protocol';

export type BitMutationStrategy =
    | 'WALKING_ONE'
    | 'WALKING_ZERO'
    | 'SINGLE_BIT_FLIP'
    | 'MASKED_EXHAUSTIVE';

export interface BitDiscoveryPlanConfig {
    readonly targetId: number;
    readonly extended?: boolean;
    readonly dlc?: number;
    readonly baselinePayload: readonly number[];
    /** 8-byte mask of which bits are allowed to be mutated. If undefined, all 64 bits allowed. */
    readonly byteMask?: readonly number[];
    readonly strategy: BitMutationStrategy;
    readonly repeatCount?: number;
    readonly intervalMs?: number;
    readonly dwellMs?: number;
}

export interface BitTrial {
    readonly trialId: string;
    readonly targetId: number;
    readonly byteIndex: number;
    readonly bitIndex: number;
    readonly mutatedPayload: readonly number[];
    readonly bitValue: 0 | 1;
}

export interface DiscoveredBitOption {
    readonly byteIndex: number;
    readonly bitIndex: number;
    readonly activeState: 0 | 1;
    readonly feedbackType: FeedbackType;
    readonly confidence: number;
    readonly description: string;
}

export interface BitTrialFeedbackResult {
    readonly trialId: string;
    readonly feedbackType: FeedbackType;
    readonly positive: boolean;
    readonly confidence?: number;
}

export class CanBitDiscovery {
    static generateTrials(config: BitDiscoveryPlanConfig): BitTrial[] {
        const dlc = config.dlc !== undefined ? config.dlc : config.baselinePayload.length;
        const baseline = [...config.baselinePayload];
        while (baseline.length < dlc) {
            baseline.push(0);
        }

        const mask = config.byteMask ? [...config.byteMask] : new Array(dlc).fill(0xFF);
        while (mask.length < dlc) {
            mask.push(0xFF);
        }

        const trials: BitTrial[] = [];
        let trialIndex = 0;

        for (let byteIdx = 0; byteIdx < dlc; byteIdx++) {
            const byteMaskVal = mask[byteIdx];
            if (byteMaskVal === 0) {
                continue;
            }

            for (let bitIdx = 0; bitIdx < 8; bitIdx++) {
                if ((byteMaskVal & (1 << bitIdx)) === 0) {
                    continue;
                }

                const baselineBit = (baseline[byteIdx] >> bitIdx) & 1;
                let targetBit: 0 | 1;

                switch (config.strategy) {
                    case 'WALKING_ONE':
                        targetBit = 1;
                        break;
                    case 'WALKING_ZERO':
                        targetBit = 0;
                        break;
                    case 'SINGLE_BIT_FLIP':
                    case 'MASKED_EXHAUSTIVE':
                    default:
                        targetBit = baselineBit === 1 ? 0 : 1;
                        break;
                }

                // Create payload with only this bit modified
                const mutated = [...baseline];
                if (targetBit === 1) {
                    mutated[byteIdx] |= (1 << bitIdx);
                } else {
                    mutated[byteIdx] &= ~(1 << bitIdx);
                }

                trials.push({
                    trialId: `bit-t${++trialIndex}-b${byteIdx}-i${bitIdx}`,
                    targetId: config.targetId,
                    byteIndex: byteIdx,
                    bitIndex: bitIdx,
                    mutatedPayload: mutated,
                    bitValue: targetBit
                });
            }
        }

        return trials;
    }

    static correlateBitResults(
        trials: readonly BitTrial[],
        feedbacks: readonly BitTrialFeedbackResult[]
    ): DiscoveredBitOption[] {
        const trialMap = new Map<string, BitTrial>();
        for (const t of trials) {
            trialMap.set(t.trialId, t);
        }

        const discovered: DiscoveredBitOption[] = [];

        for (const fb of feedbacks) {
            if (!fb.positive) {
                continue;
            }

            const trial = trialMap.get(fb.trialId);
            if (trial) {
                discovered.push({
                    byteIndex: trial.byteIndex,
                    bitIndex: trial.bitIndex,
                    activeState: trial.bitValue,
                    feedbackType: fb.feedbackType,
                    confidence: fb.confidence !== undefined ? fb.confidence : 1.0,
                    description: `Byte ${trial.byteIndex}, Bit ${trial.bitIndex} triggers ${fb.feedbackType} when set to ${trial.bitValue}`
                });
            }
        }

        return discovered;
    }
}
