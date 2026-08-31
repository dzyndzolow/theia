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
import { CanPythonRunner, CanPythonRunnerImpl } from './can-python-runner';
import { CanTransmitService, CanTransmitRequest } from './can-transmit-service';
import { CanFeedbackService } from './can-feedback-service';
import { FeedbackEvent } from '../common/can-experiment-protocol';
import { ManualFeedbackInput } from '../common/can-feedback';

describe('SA-420: CanPythonRunner (Capability IPC Protocol & Lifecycle)', () => {
    let container: Container;
    let runner: CanPythonRunnerImpl;
    let transmittedRequests: CanTransmitRequest[];
    let recordedFeedback: ManualFeedbackInput[];

    beforeEach(() => {
        container = new Container();
        transmittedRequests = [];
        recordedFeedback = [];

        const mockTransmit: Partial<CanTransmitService> = {
            transmit: async (req: CanTransmitRequest) => {
                transmittedRequests.push(req);
                return true;
            },
            dispose: () => { /* no-op */ }
        };

        const mockFeedback: Partial<CanFeedbackService> = {
            recordManualFeedback: (input: ManualFeedbackInput) => {
                recordedFeedback.push(input);
                return {} as FeedbackEvent;
            },
            dispose: () => { /* no-op */ }
        };

        container.bind(CanTransmitService).toConstantValue(mockTransmit as CanTransmitService);
        container.bind(CanFeedbackService).toConstantValue(mockFeedback as CanFeedbackService);
        container.bind(CanPythonRunner).to(CanPythonRunnerImpl).inSingletonScope();

        runner = container.get<CanPythonRunnerImpl>(CanPythonRunner);
    });

    afterEach(() => {
        runner.dispose();
    });

    it('should correctly handle incoming SEND_FRAME JSON line from script', () => {
        const line = JSON.stringify({
            type: 'SEND_FRAME',
            frame: { id: 0x120, extended: false, rtr: false, dlc: 8, data: [1, 2, 3, 4, 5, 6, 7, 8], timestamp: 10, interface: 'vcan0' }
        });

        runner.handleScriptLine(line);

        expect(transmittedRequests).to.have.lengthOf(1);
        expect(transmittedRequests[0].sourceKind).to.equal('SCRIPT');
        expect(transmittedRequests[0].frame.id).to.equal(0x120);
    });

    it('should correctly handle SET_VARIABLE and GET_VARIABLE from script', () => {
        runner.handleScriptLine(JSON.stringify({
            type: 'SET_VARIABLE',
            name: 'targetRpm',
            value: 4500
        }));

        expect(runner.getVariable('targetRpm')).to.equal(4500);
    });

    it('should correctly handle EMIT_FEEDBACK and forward to feedback service', () => {
        runner.handleScriptLine(JSON.stringify({
            type: 'EMIT_FEEDBACK',
            feedbackType: 'WAKE',
            kind: 'POSITIVE',
            comment: 'Script identified instrument cluster wake-up'
        }));

        expect(recordedFeedback).to.have.lengthOf(1);
        expect(recordedFeedback[0].kind).to.equal('POSITIVE');
        expect(recordedFeedback[0].feedbackType).to.equal('WAKE');
    });

    it('should handle STOP_EXPERIMENT command from script', () => {
        runner.handleScriptLine(JSON.stringify({
            type: 'STOP_EXPERIMENT',
            reason: 'Sequence complete'
        }));

        expect(runner.getState()).to.equal('STOPPED');
    });
});
