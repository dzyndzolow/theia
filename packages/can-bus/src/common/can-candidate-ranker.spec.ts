// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { CanCandidateRanker } from './can-candidate-ranker';
import { ExperimentJournal } from './can-experiment-event-bus';
import { TxFrameEvent, FeedbackEvent } from './can-experiment-protocol';

describe('SA-413: CanCandidateRanker (Causal Window Ranking)', () => {
    let journal: ExperimentJournal;

    beforeEach(() => {
        journal = new ExperimentJournal();
    });

    it('should correlate human feedback within calibrated reaction window', () => {
        const baseNs = 1_000_000_000n; // 1 second

        // TX frame at baseNs for ID 0x100
        const tx100: TxFrameEvent = {
            eventId: 'tx-1',
            sessionId: 's1',
            timestampMonotonicNs: baseNs,
            wallClockIso: new Date().toISOString(),
            type: 'TX_FRAME',
            frame: { id: 0x100, extended: false, rtr: false, dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8], timestamp: 10, interface: 'vcan0' },
            sourceKind: 'PATTERN',
            status: 'SENT',
            trialId: 'trial-100'
        };

        // TX frame at baseNs + 1s for ID 0x200
        const tx200: TxFrameEvent = {
            eventId: 'tx-2',
            sessionId: 's1',
            timestampMonotonicNs: baseNs + 1_000_000_000n,
            wallClockIso: new Date().toISOString(),
            type: 'TX_FRAME',
            frame: { id: 0x200, extended: false, rtr: false, dlc: 8, data: [0, 0, 0, 0, 0, 0, 0, 0], timestamp: 20, interface: 'vcan0' },
            sourceKind: 'PATTERN',
            status: 'SENT',
            trialId: 'trial-200'
        };

        // Human clicks feedback 400ms after tx100 (latency = 400ms, within default human window [250ms, 1050ms])
        const fb100: FeedbackEvent = {
            eventId: 'fb-1',
            sessionId: 's1',
            timestampMonotonicNs: baseNs + 400_000_000n,
            wallClockIso: new Date().toISOString(),
            type: 'FEEDBACK',
            kind: 'POSITIVE',
            feedbackType: 'WAKE',
            source: 'HUMAN',
            confidence: 1.0,
            comment: 'Screen turned on'
        };

        journal.append(tx100);
        journal.append(fb100);
        journal.append(tx200);

        const report = CanCandidateRanker.computeRanking(journal);

        expect(report.totalFeedbacks).to.equal(1);
        expect(report.correlatedFeedbacks).to.equal(1);
        expect(report.candidates).to.have.lengthOf(2);

        const topCandidate = report.candidates[0];
        expect(topCandidate.id).to.equal(0x100);
        expect(topCandidate.score).to.equal(1.0);
        expect(topCandidate.positiveHits).to.equal(1);
        expect(topCandidate.evidence).to.have.lengthOf(1);
        expect(topCandidate.evidence[0].targetId).to.equal(0x100);
        expect(topCandidate.evidence[0].latencyMs).to.be.closeTo(400, 1);

        const otherCandidate = report.candidates[1];
        expect(otherCandidate.id).to.equal(0x200);
        expect(otherCandidate.score).to.equal(0.0);
        expect(otherCandidate.positiveHits).to.equal(0);
    });
});
