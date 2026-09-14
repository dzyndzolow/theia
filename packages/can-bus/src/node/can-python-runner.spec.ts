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
import { ChildProcess } from 'child_process';
import { CanPythonRunner, CanPythonRunnerImpl } from './can-python-runner';
import { CanTransmitService, CanTransmitRequest } from './can-transmit-service';
import { CanFeedbackService } from './can-feedback-service';
import { FeedbackEvent } from '../common/can-experiment-protocol';
import { ManualFeedbackInput } from '../common/can-feedback';

class TestableCanPythonRunner extends CanPythonRunnerImpl {
    authorizeTransmitForTest(): void {
        this.transmitLease = this.transmitService.getLease();
    }

    getProcessGeneration(): number {
        return this.processGeneration;
    }

    getEnvironmentForTest(extra?: Record<string, string>): NodeJS.ProcessEnv {
        return this.createProcessEnvironment(extra);
    }

    async stopForTest(reason?: string): Promise<void> {
        return this.stopAndWait(reason);
    }

    getProcessForTest(): ChildProcess | undefined {
        return this.process;
    }
}

describe('SA-420: CanPythonRunner (Capability IPC Protocol & Lifecycle)', () => {
    let container: Container;
    let runner: TestableCanPythonRunner;
    let transmittedRequests: CanTransmitRequest[];
    let recordedFeedback: ManualFeedbackInput[];

    beforeEach(() => {
        container = new Container();
        transmittedRequests = [];
        recordedFeedback = [];

        const mockTransmit: Partial<CanTransmitService> = {
            getLease: () => ({ ownerId: 'python-test', generation: 1 }),
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
        container.bind(CanPythonRunner).to(TestableCanPythonRunner).inSingletonScope();

        runner = container.get<TestableCanPythonRunner>(CanPythonRunner);
        runner.authorizeTransmitForTest();
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
        expect(runner.getVariableCount()).to.equal(1);
    });

    it('clears variables on stopAndWait', async () => {
        runner.setVariable('varA', 1);
        runner.setVariable('varB', 2);
        expect(runner.getVariableCount()).to.equal(2);

        await runner.stopForTest('Test clear');
        expect(runner.getVariableCount()).to.equal(0);
        expect(runner.getVariable('varA')).to.be.undefined;
    });

    it('caps variables to MAX_SCRIPT_VARIABLES with LRU eviction', () => {
        const { MAX_SCRIPT_VARIABLES } = require('./can-python-runner');
        for (let i = 0; i < MAX_SCRIPT_VARIABLES + 50; i++) {
            runner.setVariable(`var_${i}`, i);
        }
        expect(runner.getVariableCount()).to.equal(MAX_SCRIPT_VARIABLES);
        // The earliest variables (0..49) should have been evicted
        expect(runner.getVariable('var_0')).to.be.undefined;
        expect(runner.getVariable('var_49')).to.be.undefined;
        // The latest variables should exist
        expect(runner.getVariable(`var_${MAX_SCRIPT_VARIABLES + 49}`)).to.equal(MAX_SCRIPT_VARIABLES + 49);
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

    it('rejects malformed or unknown IPC messages without transmitting', () => {
        const warnings: string[] = [];
        runner.onLogMessage(message => {
            if (message.level === 'warn') {
                warnings.push(message.message);
            }
        });

        runner.handleScriptLine('null');
        runner.handleScriptLine(JSON.stringify({
            type: 'SEND_FRAME',
            frame: { id: 0x800, extended: false, rtr: false, dlc: 1, data: [0], timestamp: 0, interface: 'vcan0' }
        }));

        expect(transmittedRequests).to.be.empty;
        expect(warnings).to.have.lengthOf(2);
    });

    describe('R04: Lifecycle, Environment Allowlist and Stale Callback Hardening', () => {
        it('validates script content length and rejects empty or oversized scripts', async () => {
            let emptyError: Error | undefined;
            try {
                await runner.start({ scriptContent: '' });
            } catch (err) {
                emptyError = err as Error;
            }
            expect(emptyError?.message).to.include('must be between 1 byte and 1 MiB');

            let oversizedError: Error | undefined;
            try {
                await runner.start({ scriptContent: 'x'.repeat(1024 * 1024 + 1) });
            } catch (err) {
                oversizedError = err as Error;
            }
            expect(oversizedError?.message).to.include('must be between 1 byte and 1 MiB');
        });

        it('validates heartbeat timeout limits and environment variable names', async () => {
            let timeoutError: Error | undefined;
            try {
                await runner.start({ scriptContent: 'pass', heartbeatTimeoutMs: 100 });
            } catch (err) {
                timeoutError = err as Error;
            }
            expect(timeoutError?.message).to.include('heartbeatTimeoutMs must be in 500..60000');

            let envKeyError: Error | undefined;
            try {
                await runner.start({
                    scriptContent: 'pass',
                    environmentVariables: { '123_INVALID': 'val' }
                });
            } catch (err) {
                envKeyError = err as Error;
            }
            expect(envKeyError?.message).to.include("Invalid Python environment variable '123_INVALID'");
        });

        it('restricts process environment to allowlist and includes PYTHONUNBUFFERED', () => {
            process.env.TEST_UNTRUSTED_VAR = 'should_not_leak';
            try {
                const env = runner.getEnvironmentForTest({ CUSTOM_SAFE: 'safe_value' });
                expect(env.PYTHONUNBUFFERED).to.equal('1');
                expect(env.CUSTOM_SAFE).to.equal('safe_value');
                expect(env.TEST_UNTRUSTED_VAR).to.be.undefined;
            } finally {
                delete process.env.TEST_UNTRUSTED_VAR;
            }
        });

        it('increments process generation on stopAndWait to invalidate stale callbacks', async () => {
            const initialGen = runner.getProcessGeneration();
            await runner.stopForTest('Testing generation increment');
            const newGen = runner.getProcessGeneration();
            expect(newGen).to.be.greaterThan(initialGen);
            expect(runner.getState()).to.equal('STOPPED');
        });

        it('fails closed and rejects untrusted scripts without a system sandbox profile', async () => {
            let untrustedError: Error | undefined;
            try {
                await runner.start({ scriptContent: 'pass', trust: 'untrusted' });
            } catch (err) {
                untrustedError = err as Error;
            }
            expect(untrustedError?.message).to.include('require a configured system sandbox profile');
        });

        it('validates and accepts a compliant system sandbox profile for untrusted execution', () => {
            expect(() => runner.configureSandboxProfile({
                profileId: 'test-sandbox',
                launcherExecutable: 'relative/path/sandbox',
                profileArguments: ['--isolated']
            })).to.throw('must be an absolute path');

            expect(() => runner.configureSandboxProfile({
                profileId: 'valid-sandbox',
                launcherExecutable: process.platform === 'win32' ? 'C:\\sandbox\\isolate.exe' : '/usr/bin/bwrap',
                profileArguments: ['--ro-bind', '/']
            })).to.not.throw();
        });

        it('enforces 64 KiB hard limit on stdin queue when a real child process does not read stdin', async function (): Promise<void> {
            this.timeout(15000);
            await runner.start({
                scriptContent: 'import time\ntime.sleep(60)\n',
                trust: 'trusted',
                heartbeatTimeoutMs: 30000
            });

            expect(runner.getState()).to.equal('RUNNING');
            const child = runner.getProcessForTest();
            expect(child).to.not.be.undefined;

            const frame = {
                id: 0x100,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [1, 2, 3, 4, 5, 6, 7, 8],
                timestamp: 1000,
                interface: 'vcan0'
            };

            // Flood frames to overwhelm stdin buffer
            for (let i = 0; i < 5000; i++) {
                runner.forwardRxFrame({ ...frame, timestamp: 1000 + i });
            }

            const diag = runner.getIpcDiagnostics!();
            expect(diag.currentWritableLength).to.be.at.most(65536);
            expect(diag.isBackpressured).to.be.true;
            expect(diag.droppedFramesCount).to.be.greaterThan(0);

            // Verify drain listener count does not grow beyond 1
            if (child?.stdin) {
                expect(child.stdin.listenerCount('drain')).to.be.at.most(1);
            }

            // Stopping should be clean and idempotent
            await runner.stopForTest('End of test');
            expect(runner.getState()).to.equal('STOPPED');
            await runner.stopForTest('Idempotent second stop');
            expect(runner.getState()).to.equal('STOPPED');
        });

        it('fails closed with IPC_BACKPRESSURE when control message cannot be sent under backpressure', async function (): Promise<void> {
            this.timeout(15000);
            await runner.start({
                scriptContent: 'import time\ntime.sleep(60)\n',
                trust: 'trusted',
                heartbeatTimeoutMs: 30000
            });

            const frame = {
                id: 0x100,
                extended: false,
                rtr: false,
                dlc: 8,
                data: [1, 2, 3, 4, 5, 6, 7, 8],
                timestamp: 1000,
                interface: 'vcan0'
            };

            // Flood to force backpressure
            for (let i = 0; i < 5000; i++) {
                runner.forwardRxFrame({ ...frame, timestamp: 1000 + i });
            }

            const diagBefore = runner.getIpcDiagnostics!();
            expect(diagBefore.isBackpressured).to.be.true;

            // Trigger control message while backpressured -> must stop session fail-closed
            runner.setVariable('pressureTest', 999);

            // Wait briefly for stopAndWait to complete
            await new Promise(resolve => setTimeout(resolve, 500));

            expect(runner.getState()).to.equal('STOPPED');
            const diagAfter = runner.getIpcDiagnostics!();
            expect(diagAfter.overloadEventsCount).to.be.greaterThan(0);
        });
    });
});
