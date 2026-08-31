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
import { CanExperimentArchive, ExperimentArchivePackage } from '../common/can-experiment-archive';
import { CanExperimentReportServiceImpl } from './can-experiment-report-service';

describe('SA-424: CanExperimentArchive & CanExperimentReportService', () => {
    const mockArchive: ExperimentArchivePackage = {
        schemaVersion: '1.0',
        sessionId: 'session-2026-cluster-lab',
        exportedAtIso: '2026-08-28T10:00:00.000Z',
        initialSeed: 42,
        targetDevice: 'Virtual Instrument Cluster',
        safetyConfig: {
            sessionId: 'session-2026-cluster-lab',
            interfaceName: 'vcan0',
            bitrate: 500000,
            mode: 'CAN_2_0',
            idMode: 'STANDARD_11BIT',
            allowedIds: [0x100, 0x120],
            maxFps: 100,
            maxBusLoadPercent: 80,
            maxDurationMs: 60000
        },
        journalEvents: [
            {
                eventId: 'ev-1',
                sessionId: 'session-2026-cluster-lab',
                timestampMonotonicNs: 1000000000n,
                wallClockIso: '2026-08-28T10:00:00.000Z',
                type: 'STATE_CHANGE',
                previousState: 'DISARMED',
                newState: 'ARMED',
                reason: 'Armed by operator'
            }
        ],
        rankingReport: {
            candidates: [
                {
                    id: 0x120,
                    score: 0.95,
                    totalTrials: 5,
                    positiveHits: 5,
                    negativeHits: 0,
                    confidence: 0.99,
                    evidence: []
                }
            ],
            totalFeedbacks: 5,
            correlatedFeedbacks: 5
        }
    };

    it('should round-trip serialize and deserialize experiment package with BigInt timestamps', () => {
        const serialized = CanExperimentArchive.serialize(mockArchive);
        expect(serialized).to.be.a('string');

        const restored = CanExperimentArchive.deserialize(serialized);
        expect(restored.sessionId).to.equal(mockArchive.sessionId);
        expect(restored.initialSeed).to.equal(42);
        expect(restored.journalEvents).to.have.lengthOf(1);
        expect(restored.journalEvents[0].timestampMonotonicNs).to.equal(1000000000n);
    });

    it('should reject corrupted or invalid schema version archives', () => {
        expect(() => CanExperimentArchive.deserialize('{ invalid json')).to.throw();
        expect(() => CanExperimentArchive.deserialize('{"schemaVersion":"2.0"}')).to.throw();
    });

    it('should generate formatted markdown report with evidence and safety summary', () => {
        const reportService = new CanExperimentReportServiceImpl();
        const report = reportService.generateMarkdownReport(mockArchive);

        expect(report).to.include('# Experiment Execution Report: session-2026-cluster-lab');
        expect(report).to.include('`0x120`');
        expect(report).to.include('**95.0%**');
        expect(report).to.include('✅ No safety policy violations');
    });
});
