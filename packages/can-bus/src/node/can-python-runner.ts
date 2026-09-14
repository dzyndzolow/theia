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
import { isAbsolute } from 'path';
import { ScriptToHostMessage, HostToScriptMessage } from '../common/can-script-protocol';
import { CanTransmitService } from './can-transmit-service';
import { CanFeedbackService } from './can-feedback-service';
import { CanFrame } from '../common/can-protocol';

const MAX_SCRIPT_BYTES = 1024 * 1024;
const MAX_IPC_LINE_BYTES = 64 * 1024;
const MAX_LOG_MESSAGE_BYTES = 16 * 1024;
const PROCESS_STOP_GRACE_MS = 1000;
const MIN_HEARTBEAT_TIMEOUT_MS = 500;
const MAX_HEARTBEAT_TIMEOUT_MS = 60_000;
export const MAX_SCRIPT_VARIABLES = 10_000;
export const MAX_STDIN_BUFFER_BYTES = 64 * 1024;

export type SendToScriptResult = 'SENT' | 'DROPPED_BACKPRESSURE' | 'STOPPING';

export interface PythonIpcDiagnostics {
    readonly maxStdinBufferBytes: number;
    readonly currentWritableLength: number;
    readonly isBackpressured: boolean;
    readonly droppedFramesCount: number;
    readonly overloadEventsCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidFrame(value: unknown): value is CanFrame {
    if (!isRecord(value) || !Number.isInteger(value.id) || typeof value.extended !== 'boolean'
        || typeof value.rtr !== 'boolean' || !Number.isInteger(value.dlc)
        || !Array.isArray(value.data) || typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)
        || typeof value.interface !== 'string' || value.interface.length === 0 || value.interface.length > 256) {
        return false;
    }
    const maxId = value.extended ? 0x1FFFFFFF : 0x7FF;
    return (value.id as number) >= 0 && (value.id as number) <= maxId
        && (value.dlc as number) >= 0 && (value.dlc as number) <= 64
        && value.data.length === value.dlc
        && value.data.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 0xFF);
}

function parseScriptMessage(value: unknown): ScriptToHostMessage | undefined {
    if (!isRecord(value) || typeof value.type !== 'string') {
        return undefined;
    }
    switch (value.type) {
        case 'HEARTBEAT':
            return { type: 'HEARTBEAT' };
        case 'SEND_FRAME':
            return isValidFrame(value.frame)
                && (value.sequenceIndex === undefined || Number.isSafeInteger(value.sequenceIndex) && (value.sequenceIndex as number) >= 0)
                ? value as unknown as ScriptToHostMessage : undefined;
        case 'SUBSCRIBE_RX':
            return (value.ids === undefined || Array.isArray(value.ids)
                && value.ids.length <= 2048
                && value.ids.every(id => Number.isInteger(id) && id >= 0 && id <= 0x1FFFFFFF))
                ? value as unknown as ScriptToHostMessage : undefined;
        case 'SET_VARIABLE':
            return typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 128
                && typeof value.value === 'number' && Number.isFinite(value.value)
                ? value as unknown as ScriptToHostMessage : undefined;
        case 'GET_VARIABLE':
            return typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 128
                ? value as unknown as ScriptToHostMessage : undefined;
        case 'EMIT_FEEDBACK':
            return ['POSITIVE', 'NEGATIVE', 'UNCERTAIN'].includes(String(value.kind))
                && ['WAKE', 'LAMP', 'DISPLAY', 'SOUND', 'POWER', 'CAN_ACTIVITY', 'OTHER'].includes(String(value.feedbackType))
                && (value.comment === undefined || typeof value.comment === 'string' && value.comment.length <= 4096)
                ? value as unknown as ScriptToHostMessage : undefined;
        case 'LOG_MESSAGE':
            return ['info', 'warn', 'error'].includes(String(value.level))
                && typeof value.message === 'string' && Buffer.byteLength(value.message, 'utf8') <= MAX_LOG_MESSAGE_BYTES
                ? value as unknown as ScriptToHostMessage : undefined;
        case 'STOP_EXPERIMENT':
            return value.reason === undefined || typeof value.reason === 'string' && value.reason.length <= 1024
                ? value as unknown as ScriptToHostMessage : undefined;
        default:
            return undefined;
    }
}

export interface ScriptExecutionOptions {
    readonly scriptContent: string;
    readonly pythonExecutable?: string;
    readonly heartbeatTimeoutMs?: number;
    readonly environmentVariables?: Record<string, string>;
    /** Defaults to untrusted. Trusted execution requires an explicit caller decision. */
    readonly trust?: 'trusted' | 'untrusted';
}

/**
 * Administrator-provided system sandbox launcher. Arguments configure the
 * isolation profile and the Python command is appended after them. No shell is
 * involved. Example launch shape: sandbox [...profileArguments] python -u -c script.
 */
export interface ScriptSandboxProfile {
    readonly profileId: string;
    readonly launcherExecutable: string;
    readonly profileArguments: readonly string[];
}

export type ScriptRunnerState = 'IDLE' | 'STARTING' | 'RUNNING' | 'STOPPED' | 'ERROR';

export const CanPythonRunner = Symbol('CanPythonRunner');

export interface CanPythonRunner extends Disposable {
    readonly onStateChanged: Event<ScriptRunnerState>;
    readonly onLogMessage: Event<{ level: string; message: string }>;
    configureSandboxProfile(profile: ScriptSandboxProfile | undefined): void;
    start(options: ScriptExecutionOptions): Promise<void>;
    hotReload(newScriptContent: string): Promise<void>;
    stop(reason?: string): void;
    getState(): ScriptRunnerState;
    forwardRxFrame(frame: CanFrame): void;
    setVariable(name: string, value: number): void;
    getVariable(name: string): number | undefined;
    getVariableCount(): number;
    getIpcDiagnostics?(): PythonIpcDiagnostics;
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

    protected process?: ChildProcess;
    private state: ScriptRunnerState = 'IDLE';
    private currentOptions?: ScriptExecutionOptions;
    private lastHeartbeatNs = 0n;
    private watchdogTimer?: NodeJS.Timeout;
    private readonly variables = new Map<string, number>();
    private isDisposed = false;
    protected transmitLease?: Readonly<{ ownerId: string; generation: number }>;
    protected processGeneration = 0;
    private sandboxProfile?: ScriptSandboxProfile;
    protected isStdinBackpressured = false;
    protected hasDrainListener = false;
    protected drainListener?: () => void;
    protected droppedFramesCount = 0;
    protected overloadEventsCount = 0;
    protected isStopping = false;

    getIpcDiagnostics(): PythonIpcDiagnostics {
        return {
            maxStdinBufferBytes: MAX_STDIN_BUFFER_BYTES,
            currentWritableLength: this.process?.stdin?.writableLength || 0,
            isBackpressured: this.isStdinBackpressured,
            droppedFramesCount: this.droppedFramesCount,
            overloadEventsCount: this.overloadEventsCount
        };
    }

    configureSandboxProfile(profile: ScriptSandboxProfile | undefined): void {
        if (this.process) {
            throw new Error('Cannot change the Python sandbox profile while a script is running.');
        }
        if (profile) {
            this.validateSandboxProfile(profile);
            this.sandboxProfile = {
                ...profile,
                profileArguments: [...profile.profileArguments]
            };
        } else {
            this.sandboxProfile = undefined;
        }
    }

    async start(options: ScriptExecutionOptions): Promise<void> {
        if (this.isDisposed) {
            return;
        }
        this.validateOptions(options);
        await this.stopAndWait('Starting new script session');
        const generation = ++this.processGeneration;
        this.currentOptions = options;
        this.transmitLease = this.transmitService.getLease();
        this.droppedFramesCount = 0;
        this.overloadEventsCount = 0;
        this.isStdinBackpressured = false;
        this.hasDrainListener = false;
        this.drainListener = undefined;
        this.setState('STARTING');

        const pythonExe = options.pythonExecutable || 'python';
        const heartbeatTimeout = options.heartbeatTimeoutMs || 3000;

        try {
            const launch = this.createLaunchCommand(options, pythonExe);
            const child = this.launchProcess(
                launch.executable,
                launch.arguments,
                this.createProcessEnvironment(options.environmentVariables)
            );
            this.process = child;
            child.stdin?.on('error', () => {
                // Prevent unhandled EPIPE when child process terminates with unflushed buffer
            });

            this.lastHeartbeatNs = process.hrtime.bigint();
            this.setState('RUNNING');

            // Setup line reader for stdout
            let stdoutBuffer = '';
            child.stdout?.on('data', (chunk: Buffer) => {
                if (generation !== this.processGeneration || child !== this.process) {
                    return;
                }
                stdoutBuffer += chunk.toString('utf8');
                if (Buffer.byteLength(stdoutBuffer, 'utf8') > MAX_IPC_LINE_BYTES) {
                    this.onLogMessageEmitter.fire({ level: 'error', message: 'Python IPC line exceeded the 64 KiB limit.' });
                    this.stopAndWait('IPC line limit exceeded').catch(error => console.error('Failed to stop Python runner:', error));
                    return;
                }
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';
                for (const line of lines) {
                    if (Buffer.byteLength(line, 'utf8') > MAX_IPC_LINE_BYTES) {
                        this.onLogMessageEmitter.fire({ level: 'error', message: 'Python IPC line exceeded the 64 KiB limit.' });
                        this.stopAndWait('IPC line limit exceeded').catch(error => console.error('Failed to stop Python runner:', error));
                        return;
                    }
                    this.handleScriptLine(line.trim());
                }
            });

            child.stderr?.on('data', (chunk: Buffer) => {
                if (generation !== this.processGeneration || child !== this.process) {
                    return;
                }
                this.onLogMessageEmitter.fire({
                    level: 'error',
                    message: chunk.subarray(0, MAX_LOG_MESSAGE_BYTES).toString('utf8').trim()
                });
            });

            child.on('error', (err: Error) => {
                if (generation !== this.processGeneration || child !== this.process) {
                    return;
                }
                this.clearWatchdog();
                this.process = undefined;
                this.setState('ERROR');
                this.onLogMessageEmitter.fire({
                    level: 'error',
                    message: `Python process failed: ${err.message}`
                });
            });

            child.on('exit', (code, signal) => {
                if (generation !== this.processGeneration || child !== this.process) {
                    return;
                }
                this.clearWatchdog();
                this.process = undefined;
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
                if (generation !== this.processGeneration || child !== this.process) {
                    return;
                }
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

        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            this.onLogMessageEmitter.fire({
                level: 'info',
                message: `[Script Output]: ${line.slice(0, MAX_LOG_MESSAGE_BYTES)}`
            });
            return;
        }

        const msg = parseScriptMessage(parsed);
        if (!msg) {
            this.onLogMessageEmitter.fire({ level: 'warn', message: 'Rejected invalid Python IPC message.' });
            return;
        }

        switch (msg.type) {
            case 'HEARTBEAT':
                this.lastHeartbeatNs = process.hrtime.bigint();
                this.sendToScript({ type: 'HEARTBEAT_ACK' });
                break;

            case 'SEND_FRAME':
                if (this.transmitLease) {
                    this.transmitService.transmit({
                        frame: msg.frame,
                        sourceKind: 'SCRIPT',
                        sequenceIndex: msg.sequenceIndex,
                        ...this.transmitLease
                    });
                }
                break;

            case 'SET_VARIABLE':
                this.recordVariable(msg.name, msg.value);
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

    protected recordVariable(name: string, value: number): void {
        if (this.variables.has(name)) {
            this.variables.delete(name);
        } else if (this.variables.size >= MAX_SCRIPT_VARIABLES) {
            const oldest = this.variables.keys().next().value;
            if (oldest !== undefined) {
                this.variables.delete(oldest);
            }
        }
        this.variables.set(name, value);
    }

    setVariable(name: string, value: number): void {
        this.recordVariable(name, value);
        if (this.state === 'RUNNING') {
            this.sendToScript({ type: 'ON_VARIABLE_CHANGED', name, value });
        }
    }

    getVariable(name: string): number | undefined {
        return this.variables.get(name);
    }

    getVariableCount(): number {
        return this.variables.size;
    }

    stop(reason?: string): void {
        this.stopAndWait(reason).catch(error => console.error('Failed to stop Python runner:', error));
    }

    getState(): ScriptRunnerState {
        return this.state;
    }

    private cleanupStdinDrainListener(child?: ChildProcess): void {
        if (this.hasDrainListener && this.drainListener) {
            const target = child || this.process;
            target?.stdin?.off('drain', this.drainListener);
            this.hasDrainListener = false;
            this.drainListener = undefined;
        }
    }

    private setupDrainListener(child: ChildProcess, generation: number): void {
        if (this.hasDrainListener || !child.stdin) {
            return;
        }
        this.hasDrainListener = true;
        const listener = () => {
            if (this.processGeneration !== generation || this.process !== child) {
                return;
            }
            this.hasDrainListener = false;
            this.drainListener = undefined;
            this.isStdinBackpressured = false;
        };
        this.drainListener = listener;
        child.stdin.once('drain', listener);
    }

    public sendToScript(msg: HostToScriptMessage): SendToScriptResult {
        const child = this.process;
        if (!child || !child.stdin || !child.stdin.writable || this.state !== 'RUNNING') {
            return 'STOPPING';
        }

        const serialized = JSON.stringify(msg) + '\n';
        const payloadBytes = Buffer.byteLength(serialized, 'utf8');
        const currentBuffer = child.stdin.writableLength || 0;
        const wouldOverflow = currentBuffer + payloadBytes > MAX_STDIN_BUFFER_BYTES;

        if (this.isStdinBackpressured || wouldOverflow) {
            this.isStdinBackpressured = true;
            this.setupDrainListener(child, this.processGeneration);

            if (msg.type === 'ON_RX_FRAME') {
                this.droppedFramesCount++;
                return 'DROPPED_BACKPRESSURE';
            }

            this.overloadEventsCount++;
            this.onLogMessageEmitter.fire({
                level: 'error',
                message: `Python IPC backpressure limit (${MAX_STDIN_BUFFER_BYTES} bytes) exceeded for control message '${msg.type}'. Terminating session.`
            });
            this.stopAndWait('IPC_BACKPRESSURE').catch(error => console.error('Failed to stop Python runner:', error));
            return 'STOPPING';
        }

        try {
            const ok = child.stdin.write(serialized);
            if (!ok) {
                this.isStdinBackpressured = true;
                this.setupDrainListener(child, this.processGeneration);
            }
            return 'SENT';
        } catch {
            this.isStdinBackpressured = true;
            return 'STOPPING';
        }
    }

    private validateOptions(options: ScriptExecutionOptions): void {
        if (!options || typeof options.scriptContent !== 'string'
            || Buffer.byteLength(options.scriptContent, 'utf8') === 0
            || Buffer.byteLength(options.scriptContent, 'utf8') > MAX_SCRIPT_BYTES) {
            throw new Error('Python script content must be between 1 byte and 1 MiB.');
        }
        const timeout = options.heartbeatTimeoutMs ?? 3000;
        if (!Number.isSafeInteger(timeout) || timeout < MIN_HEARTBEAT_TIMEOUT_MS || timeout > MAX_HEARTBEAT_TIMEOUT_MS) {
            throw new Error(`heartbeatTimeoutMs must be in ${MIN_HEARTBEAT_TIMEOUT_MS}..${MAX_HEARTBEAT_TIMEOUT_MS}.`);
        }
        if (options.environmentVariables) {
            for (const [key, value] of Object.entries(options.environmentVariables)) {
                if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) || typeof value !== 'string'
                    || Buffer.byteLength(value, 'utf8') > 4096) {
                    throw new Error(`Invalid Python environment variable '${key}'.`);
                }
            }
        }
        if (options.trust !== undefined && options.trust !== 'trusted' && options.trust !== 'untrusted') {
            throw new Error("Python script trust must be either 'trusted' or 'untrusted'.");
        }
        if ((options.trust ?? 'untrusted') === 'untrusted' && !this.sandboxProfile) {
            throw new Error('Untrusted Python scripts require a configured system sandbox profile; execution denied.');
        }
    }

    private validateSandboxProfile(profile: ScriptSandboxProfile): void {
        if (!profile.profileId || profile.profileId.length > 128
            || !isAbsolute(profile.launcherExecutable)
            || profile.launcherExecutable.includes('\0')
            || !Array.isArray(profile.profileArguments)
            || profile.profileArguments.length > 128
            || profile.profileArguments.some(argument => typeof argument !== 'string'
                || Buffer.byteLength(argument, 'utf8') > 4096 || argument.includes('\0'))) {
            throw new Error('Invalid Python system sandbox profile. The launcher must be an absolute path with bounded arguments.');
        }
    }

    private createLaunchCommand(
        options: ScriptExecutionOptions,
        pythonExecutable: string
    ): { executable: string; arguments: string[] } {
        const pythonArguments = ['-u', '-c', options.scriptContent];
        if ((options.trust ?? 'untrusted') === 'trusted') {
            return { executable: pythonExecutable, arguments: pythonArguments };
        }
        const profile = this.sandboxProfile;
        if (!profile) {
            // validateOptions rejects this earlier; retain a local fail-closed
            // guard so future callers cannot bypass the boundary accidentally.
            throw new Error('Untrusted Python scripts require a configured system sandbox profile; execution denied.');
        }
        return {
            executable: profile.launcherExecutable,
            arguments: [...profile.profileArguments, pythonExecutable, ...pythonArguments]
        };
    }

    protected launchProcess(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess {
        return spawn(executable, [...args], {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: false,
            windowsHide: true
        });
    }

    protected createProcessEnvironment(extra?: Record<string, string>): NodeJS.ProcessEnv {
        const allowedNames = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'LANG'];
        const environment: NodeJS.ProcessEnv = { PYTHONUNBUFFERED: '1' };
        for (const name of allowedNames) {
            if (process.env[name] !== undefined) {
                environment[name] = process.env[name];
            }
        }
        return { ...environment, ...extra };
    }

    protected async stopAndWait(reason?: string): Promise<void> {
        if (this.isStopping && !this.process) {
            return;
        }
        this.isStopping = true;
        try {
            this.clearWatchdog();
            const child = this.process;
            ++this.processGeneration;
            this.process = undefined;
            this.transmitLease = undefined;
            this.variables.clear();
            if (child) {
                const canSendStop = Boolean(child.stdin?.writable) && !this.isStdinBackpressured && ((child.stdin?.writableLength || 0) + 64 <= MAX_STDIN_BUFFER_BYTES);
                this.cleanupStdinDrainListener(child);
                this.isStdinBackpressured = false;
                if (canSendStop) {
                    try {
                        child.stdin?.write(JSON.stringify({ type: 'ON_STOP_SIGNAL', reason }) + '\n');
                    } catch {
                        // Process termination below remains the authoritative cutoff.
                    }
                }
                try {
                    child.kill('SIGTERM');
                } catch {
                    // Process may already have exited.
                }
                const exited = await this.waitForExit(child, PROCESS_STOP_GRACE_MS);
                if (!exited) {
                    try {
                        child.kill('SIGKILL');
                    } catch {
                        // Process may have exited between the timeout and forced kill.
                    }
                    await this.waitForExit(child, 250);
                }
            }
            if (this.state !== 'STOPPED') {
                this.setState('STOPPED');
            }
        } finally {
            this.isStopping = false;
        }
    }

    private waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
        if (typeof child.exitCode === 'number' || typeof child.signalCode === 'string') {
            return Promise.resolve(true);
        }
        return new Promise(resolve => {
            let settled = false;
            const finish = (value: boolean) => {
                if (!settled) {
                    settled = true;
                    clearTimeout(timer);
                    child.off('exit', onExit);
                    child.off('error', onExit);
                    resolve(value);
                }
            };
            const onExit = () => finish(true);
            const timer = setTimeout(() => finish(false), timeoutMs);
            child.once('exit', onExit);
            child.once('error', onExit);
        });
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
