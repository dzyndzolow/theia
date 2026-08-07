// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ProtocolAnnotation } from './contracts';
import { AnnotationValidator } from './annotation-validator';

export enum CircuitState {
    CLOSED = 'CLOSED',
    OPEN = 'OPEN',
    HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerOptions {
    /** Number of consecutive failures before tripping circuit to OPEN. Default: 3 */
    readonly failureThreshold?: number;
    /** Time in milliseconds to remain OPEN before attempting HALF_OPEN trial. Default: 100ms */
    readonly resetTimeoutMs?: number;
}

interface DecoderCircuit {
    state: CircuitState;
    consecutiveFailures: number;
    lastStateChangeTime: number;
}

export class DecoderCircuitBreaker {
    private readonly circuits = new Map<string, DecoderCircuit>();
    private readonly failureThreshold: number;
    private readonly resetTimeoutMs: number;

    constructor(options: CircuitBreakerOptions = {}) {
        this.failureThreshold = options.failureThreshold ?? 3;
        this.resetTimeoutMs = options.resetTimeoutMs ?? 100;
    }

    public getState(decoderId: string): CircuitState {
        const circuit = this.circuits.get(decoderId);
        if (!circuit) {
            return CircuitState.CLOSED;
        }

        const now = Date.now();
        if (circuit.state === CircuitState.OPEN && now - circuit.lastStateChangeTime >= this.resetTimeoutMs) {
            circuit.state = CircuitState.HALF_OPEN;
            circuit.lastStateChangeTime = now;
        }

        return circuit.state;
    }

    /**
     * Executes a decoder operation safely. If circuit is OPEN, returns a DECODER_FAULT annotation
     * without invoking the faulting decoder.
     */
    public async execute<T extends ProtocolAnnotation[]>(
        decoderId: string,
        startTimeNs: bigint,
        endTimeNs: bigint,
        action: () => Promise<T>
    ): Promise<ProtocolAnnotation[]> {
        const state = this.getState(decoderId);

        if (state === CircuitState.OPEN) {
            return [
                AnnotationValidator.createDecoderFaultAnnotation(
                    decoderId,
                    startTimeNs,
                    endTimeNs,
                    `Circuit breaker is OPEN due to repeated failures.`
                )
            ];
        }

        try {
            const result = await action();
            this.recordSuccess(decoderId);
            return result;
        } catch (error) {
            this.recordFailure(decoderId);
            const err = error instanceof Error ? error : new Error(String(error));
            return [
                AnnotationValidator.createDecoderFaultAnnotation(
                    decoderId,
                    startTimeNs,
                    endTimeNs,
                    err
                )
            ];
        }
    }

    public reset(decoderId: string): void {
        this.circuits.delete(decoderId);
    }

    public resetAll(): void {
        this.circuits.clear();
    }

    private getOrCreateCircuit(decoderId: string): DecoderCircuit {
        let circuit = this.circuits.get(decoderId);
        if (!circuit) {
            circuit = {
                state: CircuitState.CLOSED,
                consecutiveFailures: 0,
                lastStateChangeTime: Date.now()
            };
            this.circuits.set(decoderId, circuit);
        }
        return circuit;
    }

    private recordSuccess(decoderId: string): void {
        const circuit = this.getOrCreateCircuit(decoderId);
        circuit.consecutiveFailures = 0;
        if (circuit.state === CircuitState.HALF_OPEN) {
            circuit.state = CircuitState.CLOSED;
            circuit.lastStateChangeTime = Date.now();
        }
    }

    private recordFailure(decoderId: string): void {
        const circuit = this.getOrCreateCircuit(decoderId);
        circuit.consecutiveFailures++;
        if (circuit.consecutiveFailures >= this.failureThreshold) {
            circuit.state = CircuitState.OPEN;
            circuit.lastStateChangeTime = Date.now();
        }
    }
}
