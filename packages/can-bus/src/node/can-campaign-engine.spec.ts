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
import { CanCampaignPlanner, CampaignPlanConfig } from '../common/can-campaign';
import { CanCampaignEngine, CanCampaignEngineImpl } from './can-campaign-engine';
import { CanTransmitService, CanTransmitRequest } from './can-transmit-service';

describe('SA-411: CanCampaignPlanner & CanCampaignEngine', () => {
    describe('CanCampaignPlanner', () => {
        it('should build deterministic trials excluding baseline active IDs', () => {
            const config: CampaignPlanConfig = {
                campaignId: 'camp-test',
                candidateIds: [0x100, 0x101, 0x102],
                baselineActiveIds: [0x101], // Exclude active ID 0x101
                payloadClasses: ['ALL_ZEROS', 'ALL_ONES'],
                repeatCountPerPattern: 2,
                repeatIntervalMs: 10,
                dwellTimeMs: 50
            };

            const plan = CanCampaignPlanner.buildPlan(config);
            // 2 IDs * 2 patterns = 4 trials
            expect(plan.trials).to.have.lengthOf(4);
            expect(plan.summary.totalTrials).to.equal(4);
            expect(plan.summary.totalFrames).to.equal(8);
            expect(plan.summary.candidateIdCount).to.equal(2);

            // Targets should be 0x100 and 0x102
            expect(plan.trials[0].targetId).to.equal(0x100);
            expect(plan.trials[0].patternClass).to.equal('ALL_ZEROS');
            expect(plan.trials[1].targetId).to.equal(0x100);
            expect(plan.trials[1].patternClass).to.equal('ALL_ONES');
            expect(plan.trials[2].targetId).to.equal(0x102);
        });
    });

    describe('CanCampaignEngine', () => {
        let container: Container;
        let campaignEngine: CanCampaignEngine;
        let sentRequests: CanTransmitRequest[];

        beforeEach(() => {
            container = new Container();
            sentRequests = [];

            const mockTransmit: Partial<CanTransmitService> = {
                transmit: async (req: CanTransmitRequest) => {
                    sentRequests.push(req);
                    return true;
                },
                dispose: () => { /* no-op */ }
            };

            container.bind(CanTransmitService).toConstantValue(mockTransmit as CanTransmitService);
            container.bind(CanCampaignEngine).to(CanCampaignEngineImpl).inSingletonScope();

            campaignEngine = container.get<CanCampaignEngine>(CanCampaignEngine);
        });

        afterEach(() => {
            campaignEngine.dispose();
        });

        it('should execute campaign trials sequentially and reach COMPLETED', async () => {
            const config: CampaignPlanConfig = {
                campaignId: 'engine-test',
                candidateIds: [0x200],
                payloadClasses: ['ALL_ZEROS', 'ALT_AA'],
                repeatCountPerPattern: 2,
                repeatIntervalMs: 2,
                dwellTimeMs: 5
            };

            campaignEngine.configure(config);
            expect(campaignEngine.getStatus()).to.equal('IDLE');

            await campaignEngine.start();
            expect(campaignEngine.getStatus()).to.equal('COMPLETED');
            expect(sentRequests).to.have.lengthOf(4); // 2 patterns * 2 reps = 4 frames
            expect(sentRequests[0].frame.id).to.equal(0x200);
            expect(sentRequests[0].frame.data).to.deep.equal([0, 0, 0, 0, 0, 0, 0, 0]);
            expect(sentRequests[2].frame.data).to.deep.equal([0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA]);
        });
    });
});
