// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { DecoderProvider } from './contracts';
import { DecoderDAG, CyclicDependencyException } from './decoder-dag';

export type PipelineUpdateListener = (orderedDecoders: readonly DecoderProvider[]) => void;

export interface Disposable {
    dispose(): void;
}

export class DecoderRegistry implements Disposable {
    private readonly decoders = new Map<string, DecoderProvider>();
    private readonly listeners = new Set<PipelineUpdateListener>();
    private cachedTopologicalOrder: readonly DecoderProvider[] | null = null;

    /**
     * Registers a decoder listener (Observer Pattern).
     */
    public onDidUpdatePipelines(listener: PipelineUpdateListener): Disposable {
        this.listeners.add(listener);
        return {
            dispose: () => this.listeners.delete(listener)
        };
    }

    /**
     * Registers a new decoder plugin. Dynamic re-evaluation of DAG pipeline occurs.
     */
    public registerDecoder(decoder: DecoderProvider): Disposable {
        const id = String(decoder.id);
        if (this.decoders.has(id)) {
            throw new Error(`Decoder with ID '${id}' is already registered.`);
        }

        this.decoders.set(id, decoder);
        this.invalidateAndNotify();

        return {
            dispose: () => this.unregisterDecoder(id)
        };
    }

    /**
     * Unregisters a decoder by ID.
     */
    public unregisterDecoder(decoderId: string): void {
        const id = String(decoderId);
        if (this.decoders.delete(id)) {
            this.invalidateAndNotify();
        }
    }

    /**
     * Retrieves all currently registered decoders.
     */
    public getDecoders(): readonly DecoderProvider[] {
        return Array.from(this.decoders.values());
    }

    /**
     * Returns decoders ordered topologically according to DAG dependencies.
     */
    public getTopologicalOrder(): readonly DecoderProvider[] {
        if (this.cachedTopologicalOrder === null) {
            this.cachedTopologicalOrder = DecoderDAG.sortTopologically(this.getDecoders());
        }
        return this.cachedTopologicalOrder;
    }

    /**
     * Checks whether the current set of decoders contains cyclic dependencies.
     */
    public hasCycle(): boolean {
        try {
            DecoderDAG.sortTopologically(this.getDecoders());
            return false;
        } catch (e) {
            if (e instanceof CyclicDependencyException) {
                return true;
            }
            throw e;
        }
    }

    /**
     * Clears all registered decoders.
     */
    public clear(): void {
        this.decoders.clear();
        this.invalidateAndNotify();
    }

    public dispose(): void {
        this.listeners.clear();
        this.decoders.clear();
        this.cachedTopologicalOrder = null;
    }

    private invalidateAndNotify(): void {
        this.cachedTopologicalOrder = null;
        let currentOrder: readonly DecoderProvider[] = [];
        try {
            currentOrder = this.getTopologicalOrder();
        } catch (e) {
            if (!(e instanceof CyclicDependencyException)) {
                throw e;
            }
        }
        for (const listener of this.listeners) {
            try {
                listener(currentOrder);
            } catch (err) {
                console.error('Error in PipelineUpdateListener:', err);
            }
        }
    }
}
