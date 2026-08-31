// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ExperimentJournal } from './can-experiment-event-bus';
import { TxFrameEvent, FeedbackEvent, FeedbackKind } from './can-experiment-protocol';

export interface CausalWindowConfig {
    readonly humanReactionOffsetMs?: number;
    readonly humanWindowSpanMs?: number;
    readonly autoReactionOffsetMs?: number;
    readonly autoWindowSpanMs?: number;
}

export interface EvidenceItem {
    readonly trialId?: string;
    readonly targetId: number;
    readonly payloadHex: string;
    readonly feedbackKind: FeedbackKind;
    readonly latencyMs: number;
    readonly confidence: number;
    readonly wallClockIso: string;
}

export interface CandidateScore {
    readonly id: number;
    readonly totalTrials: number;
    readonly positiveHits: number;
    readonly negativeHits: number;
    readonly score: number;
    readonly confidence: number;
    readonly evidence: readonly EvidenceItem[];
}

export interface CandidateRankingReport {
    readonly candidates: readonly CandidateScore[];
    readonly totalFeedbacks: number;
    readonly correlatedFeedbacks: number;
}

export class CanCandidateRanker {
    static computeRanking(
        journal: ExperimentJournal,
        config: CausalWindowConfig = {}
    ): CandidateRankingReport {
        const humanOffsetNs = BigInt(Math.round((config.humanReactionOffsetMs ?? 250) * 1e6));
        const humanSpanNs = BigInt(Math.round((config.humanWindowSpanMs ?? 800) * 1e6));
        const autoOffsetNs = BigInt(Math.round((config.autoReactionOffsetMs ?? 5) * 1e6));
        const autoSpanNs = BigInt(Math.round((config.autoWindowSpanMs ?? 100) * 1e6));

        const events = journal.getAll();
        const txEvents: TxFrameEvent[] = [];
        const feedbackEvents: FeedbackEvent[] = [];

        for (const evt of events) {
            if (evt.type === 'TX_FRAME' && evt.status === 'SENT') {
                txEvents.push(evt as TxFrameEvent);
            } else if (evt.type === 'FEEDBACK') {
                feedbackEvents.push(evt as FeedbackEvent);
            }
        }

        const candidateMap = new Map<number, {
            totalTrials: number;
            positiveHits: number;
            negativeHits: number;
            evidence: EvidenceItem[];
        }>();

        // Register all tested IDs from TX events
        for (const tx of txEvents) {
            const id = tx.frame.id;
            if (!candidateMap.has(id)) {
                candidateMap.set(id, {
                    totalTrials: 0,
                    positiveHits: 0,
                    negativeHits: 0,
                    evidence: []
                });
            }
            candidateMap.get(id)!.totalTrials++;
        }

        let correlatedFeedbacks = 0;

        // Correlate feedbacks backward to TX events
        for (const fb of feedbackEvents) {
            const isHuman = fb.source === 'HUMAN';
            const offsetNs = isHuman ? humanOffsetNs : autoOffsetNs;
            const spanNs = isHuman ? humanSpanNs : autoSpanNs;

            const fbTimeNs = fb.timestampMonotonicNs;
            const windowEndNs = fbTimeNs - offsetNs;
            const windowStartNs = windowEndNs - spanNs;

            // Find matching TX events in window
            const matchingTx = txEvents.filter(
                tx => tx.timestampMonotonicNs >= windowStartNs && tx.timestampMonotonicNs <= windowEndNs
            );

            if (matchingTx.length > 0) {
                correlatedFeedbacks++;
                for (const tx of matchingTx) {
                    const id = tx.frame.id;
                    const rec = candidateMap.get(id);
                    if (rec) {
                        const latencyMs = Number(fbTimeNs - tx.timestampMonotonicNs) / 1e6;
                        const payloadHex = tx.frame.data.map(b => b.toString(16).padStart(2, '0')).join(' ');

                        if (fb.kind === 'POSITIVE') {
                            rec.positiveHits++;
                        } else if (fb.kind === 'NEGATIVE') {
                            rec.negativeHits++;
                        }

                        rec.evidence.push({
                            trialId: tx.trialId,
                            targetId: id,
                            payloadHex,
                            feedbackKind: fb.kind,
                            latencyMs,
                            confidence: fb.confidence ?? 1.0,
                            wallClockIso: fb.wallClockIso
                        });
                    }
                }
            }
        }

        // Calculate scores
        const candidates: CandidateScore[] = [];
        for (const [id, data] of candidateMap.entries()) {
            const total = data.positiveHits + data.negativeHits;
            let score = 0;
            let confidence = 0;

            if (total > 0) {
                score = data.positiveHits / total;
                confidence = Math.min(1.0, total / 3); // 3+ consistent observations = 100% confidence
            }

            candidates.push({
                id,
                totalTrials: data.totalTrials,
                positiveHits: data.positiveHits,
                negativeHits: data.negativeHits,
                score,
                confidence,
                evidence: data.evidence
            });
        }

        // Sort descending by score, then by positiveHits
        candidates.sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return b.positiveHits - a.positiveHits;
        });

        return {
            candidates,
            totalFeedbacks: feedbackEvents.length,
            correlatedFeedbacks
        };
    }
}
