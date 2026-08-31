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
import { Disposable, Emitter, Event } from '@theia/core';
import { ChildProcess, spawn } from 'child_process';
import { ScriptToHostMessage, HostToScriptMessage } from '../common/can-script-protocol';
import { CanTransmitService } from './can-transmit-service';
import { CanFeedbackService } from './can-feedback-service';
import { CanFrame } from '../common/can-protocol';

export interface ScriptExecutionOptions {
    readonly scriptContent: string;
    readonly pythonExecutable?: string;
    readonly heartbeatTimeoutMs?: number;
    readonly environmentVariables?: Record<string, string>;
}

export type ScriptRunnerState = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPED' | 'ERROR';

export const CanPythonRunner = Symbol('CanPythonRunner');

export interface CanPythonRunner extends Disposable {
    readonly onStateChanged: Event<ScriptRunnerState>;
    readonly onLogMessage: Event<{ level: string; message: string }>;
    start(options: ScriptExecutionOptions): Promise<void>;
    hotReload(newScriptContent: string): Promise<void>;
    stop(reason?: string): void;
    getState(): ScriptRunnerState;
    forwardRxFrame(frame: CanFrame): void;
    setVariable(name: string, value: number): void;
    getVariable(name: string): number | undefined;
}

@injectable()
export class CanPythonRunnerImpl implements CanPythonRunner {
    @inject(CanTransmitService)
    protected readonly transmitService!: CanTransmitService;

    @inject(CanFeedbackService)
    protected readonly feedbackService!: CanFeedbackService;

    private readonly onStateChangedEmitter = new Emitter<ScriptRunnerState>();
    readonly onStateChanged: Event<ScriptRunnerState> = this.onStateChangedEmitter.event;

    private readonly onLogMessageEmitter = new Emitter<{ level: string; message: string }>();
    readonly onLogMessage: Event<{ level: string; message: string }> = this.onLogMessageEmitter.event;

    private process?: ChildProcess;
    private state: ScriptRunnerState = 'IDLE';
    private currentOptions?: ScriptExecutionOptions;
    private lastHeartbeatNs = 0n;
    private watchdogTimer?: NodeJS.Timeout;
    private readonly variables = new Map<string, number>();
    private isDisposed = false;

    async start(options: ScriptExecutionOptions): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        this.stop('Starting new script session');
        this.currentOptions = options;
        this.setState('STARTING');

        const pythonExe = options.pythonExecutable || 'python';
        const heartbeatTimeout = options.heartbeatTimeoutMs || 3000;

        try {
            // Launch isolated child process
            this.process = spawn(pythonExe, ['-u', '-c', options.scriptContent], {
                env: { ...process.env, ...options.environmentVariables, PYTHONUNBUFFERED: '1' },
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.lastHeartbeatNs = process.hrtime.bigint();
            this.setState('RUNNING');

            // Setup line reader for stdout
            let stdoutBuffer = '';
            this.process.stdout?.on('data', (chunk: Buffer) => {
                stdoutBuffer += chunk.toString('utf8');
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';
                for (const line of lines) {
                    this.handleScriptLine(line.trim());
                }
            });

            this.process.stderr?.on('data', (chunk: Buffer) => {
                this.onLogMessageEmitter.fire({ level: 'error', message: chunk.toString('utf8').trim() });
            });

            this.process.on('exit', (code, signal) => {
                this.clearWatchdog();
                if (this.state === 'RUNNING' || this.state === 'STARTING') {
                    this.setState(code === 0 ? 'STOPPED' : 'ERROR');
                    this.onLogMessageEmitter.fire({
                        level: code === 0 ? 'info' : 'error',
                        message: `Python script exited with code ${code}, signal ${signal}`
                    });
                }
            });

            // Start heartbeat watchdog
            this.watchdogTimer = setInterval(() => {
                const nowNs = process.hrtime.bigint();
                const elapsedMs = Number(nowNs - this.lastHeartbeatNs) / 1e6;
                if (elapsedMs > heartbeatTimeout) {
                    this.onLogMessageEmitter.fire({
                        level: 'error',
                        message: `Python script heartbeat lost (${elapsedMs.toFixed(0)} ms > ${heartbeatTimeout} ms). Terminating.`
                    });
                    this.stop('Heartbeat timeout');
                }
            }, 500);

        } catch (err: unknown) {
            this.setState('ERROR');
            this.onLogMessageEmitter.fire({ level: 'error', message: `Failed to spawn Python process: ${err}` });
        }
    }

    async hotReload(newScriptContent: string): Promise<void> {
        if (!this.currentOptions) {
            return;
        }
        this.onLogMessageEmitter.fire({ level: 'info', message: 'Hot-reloading Python script...' });
        const updatedOptions: ScriptExecutionOptions = {
            ...this.currentOptions,
            scriptContent: newScriptContent
        };
        await this.start(updatedOptions);
    }

    handleScriptLine(line: string): void {
        if (!line) {
            return;
        }

        let msg: ScriptToHostMessage;
        try {
            msg = JSON.parse(line);
        } catch {
            this.onLogMessageEmitter.fire({ level: 'info', message: `[Script Output]: ${line}` });
            return;
        }

        switch (msg.type) {
            case 'HEARTBEAT':
                this.lastHeartbeatNs = process.hrtime.bigint();
                this.sendToScript({ type: 'HEARTBEAT_ACK' });
                break;

            case 'SEND_FRAME':
                this.transmitService.transmit({
                    frame: msg.frame,
                    sourceKind: 'SCRIPT',
                    sequenceIndex: msg.sequenceIndex
                });
                break;

            case 'SET_VARIABLE':
                this.variables.set(msg.name, msg.value);
                this.sendToScript({ type: 'ON_VARIABLE_CHANGED', name: msg.name, value: msg.value });
                break;

            case 'GET_VARIABLE': {
                const val = this.variables.get(msg.name);
                this.sendToScript({ type: 'ON_VARIABLE_VALUE', name: msg.name, value: val });
                break;
            }

            case 'EMIT_FEEDBACK':
                this.feedbackService.recordManualFeedback({
                    kind: msg.kind,
                    feedbackType: msg.feedbackType,
                    comment: msg.comment
                });
                break;

            case 'LOG_MESSAGE':
                this.onLogMessageEmitter.fire({ level: msg.level, message: msg.message });
                break;

            case 'STOP_EXPERIMENT':
                this.stop(msg.reason);
                break;
        }
    }

    forwardRxFrame(frame: CanFrame): void {
        if (this.state === 'RUNNING') {
            this.sendToScript({ type: 'ON_RX_FRAME', frame });
        }
    }

    setVariable(name: string, value: number): void {
        this.variables.set(name, value);
        if (this.state === 'RUNNING') {
            this.sendToScript({ type: 'ON_VARIABLE_CHANGED', name, value });
        }
    }

    getVariable(name: string): number | undefined {
        return this.variables.get(name);
    }

    stop(reason?: string): void {
        this.clearWatchdog();
        if (this.process) {
            this.sendToScript({ type: 'ON_STOP_SIGNAL', reason });
            try {
                this.process.kill('SIGTERM');
            } catch {
                /* ignored */
            }
            this.process = undefined;
        }
        if (this.state !== 'STOPPED') {
            this.setState('STOPPED');
        }
    }

    getState(): ScriptRunnerState {
        return this.state;
    }

    private sendToScript(msg: HostToScriptMessage): void {
        if (this.process?.stdin?.writable) {
            try {
                this.process.stdin.write(JSON.stringify(msg) + '\n');
            } catch {
                /* ignored */
            }
        }
    }

    private clearWatchdog(): void {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = undefined;
        }
    }

    private setState(state: ScriptRunnerState): void {
        this.state = state;
        this.onStateChangedEmitter.fire(state);
    }

    dispose(): void {
        this.isDisposed = true;
        this.stop('Disposed');
        this.onStateChangedEmitter.dispose();
        this.onLogMessageEmitter.dispose();
        this.variables.clear();
    }
}
