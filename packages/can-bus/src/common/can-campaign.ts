// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

export type PayloadPatternClass =
    | 'ALL_ZEROS'
    | 'ALL_ONES'
    | 'ALT_AA'
    | 'ALT_55'
    | 'SEVEN_F'
    | 'BYTE_RAMP'
    | 'EIGHTY';

export const DEFAULT_WAKEUP_PAYLOAD_CLASSES: readonly PayloadPatternClass[] = [
    'ALL_ZEROS',
    'ALL_ONES',
    'ALT_AA',
    'ALT_55',
    'SEVEN_F',
    'BYTE_RAMP'
];

export function generatePatternPayload(patternClass: PayloadPatternClass, dlc = 8): number[] {
    const data: number[] = [];
    for (let i = 0; i < dlc; i++) {
        switch (patternClass) {
            case 'ALL_ZEROS':
                data.push(0x00);
                break;
            case 'ALL_ONES':
                data.push(0xFF);
                break;
            case 'ALT_AA':
                data.push(0xAA);
                break;
            case 'ALT_55':
                data.push(0x55);
                break;
            case 'SEVEN_F':
                data.push(0x7F);
                break;
            case 'BYTE_RAMP':
                data.push(i & 0xFF);
                break;
            case 'EIGHTY':
                data.push(0x80);
                break;
            default:
                data.push(0x00);
                break;
        }
    }
    return data;
}

export interface CampaignTrialConfig {
    readonly trialId: string;
    readonly targetId: number;
    readonly extended: boolean;
    readonly dlc: number;
    readonly payload: readonly number[];
    readonly patternClass: PayloadPatternClass;
    readonly repeatCount: number;
    readonly repeatIntervalMs: number;
    readonly dwellAfterMs: number;
}

export interface CampaignPlanConfig {
    readonly campaignId: string;
    readonly candidateIds: readonly number[];
    readonly extended?: boolean;
    readonly dlc?: number;
    readonly payloadClasses?: readonly PayloadPatternClass[];
    readonly repeatCountPerPattern?: number;
    readonly repeatIntervalMs?: number;
    readonly dwellTimeMs?: number;
    readonly pauseBetweenBlocksMs?: number;
    readonly blockSize?: number;
    /** IDs active during baseline listening to exclude from candidate sweep */
    readonly baselineActiveIds?: readonly number[];
}

export interface CampaignSummary {
    readonly campaignId: string;
    readonly totalTrials: number;
    readonly totalFrames: number;
    readonly candidateIdCount: number;
    readonly estimatedDurationMs: number;
    readonly peakFps: number;
}

export class CanCampaignPlanner {
    static buildPlan(config: CampaignPlanConfig): { trials: readonly CampaignTrialConfig[]; summary: CampaignSummary } {
        const dlc = config.dlc !== undefined ? config.dlc : 8;
        const extended = !!config.extended;
        const payloadClasses = config.payloadClasses || DEFAULT_WAKEUP_PAYLOAD_CLASSES;
        const repeatCount = config.repeatCountPerPattern || 3;
        const repeatInterval = config.repeatIntervalMs || 20;
        const dwellTime = config.dwellTimeMs || 100;

        // Filter candidate IDs against baseline active IDs
        const excludedSet = new Set(config.baselineActiveIds || []);
        const filteredIds = config.candidateIds.filter(id => !excludedSet.has(id));

        const trials: CampaignTrialConfig[] = [];
        let trialCounter = 0;

        for (const targetId of filteredIds) {
            for (const patternClass of payloadClasses) {
                const payload = generatePatternPayload(patternClass, dlc);
                trials.push({
                    trialId: `${config.campaignId}-t${++trialCounter}`,
                    targetId,
                    extended,
                    dlc,
                    payload,
                    patternClass,
                    repeatCount,
                    repeatIntervalMs: repeatInterval,
                    dwellAfterMs: dwellTime
                });
            }
        }

        const totalFrames = trials.reduce((acc, t) => acc + t.repeatCount, 0);
        const trialDurationMs = trials.reduce(
            (acc, t) => acc + (t.repeatCount * t.repeatIntervalMs) + t.dwellAfterMs,
            0
        );
        const peakFps = repeatInterval > 0 ? Math.round(1000 / repeatInterval) : 100;

        const summary: CampaignSummary = {
            campaignId: config.campaignId,
            totalTrials: trials.length,
            totalFrames,
            candidateIdCount: filteredIds.length,
            estimatedDurationMs: trialDurationMs,
            peakFps
        };

        return { trials, summary };
    }
}
