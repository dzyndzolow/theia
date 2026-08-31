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
import { Container } from '@theia/core/shared/inversify';
import { CanDeviceLabSimulator } from './can-device-lab-simulator';
import { CanExperimentEventBus } from '../common/can-experiment-event-bus';
import { CanTransmitService, CanTransmitServiceImpl } from './can-transmit-service';
import { CanFeedbackService, CanFeedbackServiceImpl } from './can-feedback-service';
import { CanCandidateRanker } from '../common/can-candidate-ranker';
import { CanExperimentArchive, ExperimentArchivePackage } from '../common/can-experiment-archive';
import { CanExperimentReportServiceImpl } from './can-experiment-report-service';
import { CanExperimentSessionConfig } from '../common/can-experiment-protocol';
import { CanFrame } from '../common/can-protocol';

describe('SA-421: CAN Device Lab E2E Integration Gate', () => {
    let container: Container;
    let simulator: CanDeviceLabSimulator;
    let eventBus: CanExperimentEventBus;
    let transmitService: CanTransmitService;
    let feedbackService: CanFeedbackService;

    const sessionConfig: CanExperimentSessionConfig = {
        sessionId: 'e2e-gate-session',
        interfaceName: 'vcan0',
        bitrate: 500000,
        mode: 'CAN_2_0',
        idMode: 'STANDARD_11BIT',
        allowedIds: [0x150],
        maxFps: 50,
        maxBusLoadPercent: 70,
        maxDurationMs: 10000
    };

    beforeEach(() => {
        container = new Container();

        eventBus = new CanExperimentEventBus();

        // Simulator DUT: wakes on 0x150 payload [1, 0, 0, 0, 0, 0, 0, 0]
        simulator = new CanDeviceLabSimulator({
            name: 'Virtual Instrument Cluster',
            seed: 12345,
            wakeUpFrame: {
                id: 0x150,
                dataPattern: [1, 0, 0, 0, 0, 0, 0, 0]
            },
            statusFrameId: 0x250,
            statusFrameIntervalMs: 50
        });

        container.bind(CanTransmitService).to(CanTransmitServiceImpl).inSingletonScope();
        container.bind(CanFeedbackService).to(CanFeedbackServiceImpl).inSingletonScope();

        transmitService = container.get<CanTransmitService>(CanTransmitService);
        feedbackService = container.get<CanFeedbackService>(CanFeedbackService);

        transmitService.setSessionConfig(sessionConfig, eventBus);
        transmitService.setState('RUNNING');

        feedbackService.setEventBus(eventBus, sessionConfig.sessionId);

        // Connect mock adapter that delivers frames to simulator
        transmitService.setAdapter({
            sendFrame: (frame: CanFrame) => {
                simulator.processFrame(frame, Date.now());
                return true;
            }
        });
    });

    afterEach(() => {
        feedbackService.dispose();
        transmitService.dispose();
        eventBus.dispose();
    });

    it('should complete full E2E discovery flow: sleep -> transmit -> wake -> rx-delta -> rank -> archive & report', async () => {
        // Step 1: Simulator starts in SLEEPING state
        expect(simulator.getStateSnapshot().isAwake).to.be.false;

        // Step 2: Feedback service captures initial baseline
        feedbackService.freezeBaseline();

        // Step 3: Transmit valid wake-up frame through CanTransmitService
        const wakeFrame: CanFrame = {
            id: 0x150,
            extended: false,
            rtr: false,
            dlc: 8,
            data: [1, 0, 0, 0, 0, 0, 0, 0],
            timestamp: 0,
            interface: 'vcan0'
        };

        const txSuccess = await transmitService.transmit({
            frame: wakeFrame,
            sourceKind: 'LITERAL',
            trialId: 'trial-wake-1'
        });
        expect(txSuccess).to.be.true;

        // Step 4: Simulator processes wake-up frame and transitions to AWAKE
        expect(simulator.getStateSnapshot().isAwake).to.be.true;

        // Step 5: Simulator emits periodic awake frame via tick() -> feedbackService detects RX_DELTA
        const periodicFrames = simulator.tick(Date.now());
        for (const f of periodicFrames) {
            feedbackService.processRxFrame(f, false);
        }

        // Also record positive feedback for candidate ranker
        feedbackService.recordManualFeedback({
            kind: 'POSITIVE',
            feedbackType: 'WAKE',
            comment: 'Cluster screen illuminated'
        });

        // Step 6: Candidate Ranker builds causal correlation from journal
        const ranking = CanCandidateRanker.computeRanking(eventBus.getJournal(), {
            humanReactionOffsetMs: 0,
            humanWindowSpanMs: 2000,
            autoReactionOffsetMs: 0,
            autoWindowSpanMs: 2000
        });
        expect(ranking.candidates).to.have.lengthOf(1);
        expect(ranking.candidates[0].id).to.equal(0x150);
        expect(ranking.candidates[0].score).to.be.greaterThan(0);

        // Step 7: Export archive and generate final markdown report
        const archive: ExperimentArchivePackage = {
            schemaVersion: '1.0',
            sessionId: 'e2e-gate-session',
            exportedAtIso: new Date().toISOString(),
            initialSeed: 12345,
            targetDevice: 'Virtual E2E DUT',
            safetyConfig: sessionConfig,
            journalEvents: eventBus.getJournal().getAll(),
            rankingReport: ranking
        };

        const jsonArchive = CanExperimentArchive.serialize(archive);
        expect(jsonArchive).to.be.a('string');

        const reportService = new CanExperimentReportServiceImpl();
        const report = reportService.generateMarkdownReport(archive);

        expect(report).to.include('# Experiment Execution Report: e2e-gate-session');
        expect(report).to.include('`0x150`');
        expect(report).to.include('✅ No safety policy violations');
    });
});
