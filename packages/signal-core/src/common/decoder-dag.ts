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

export class CyclicDependencyException extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CyclicDependencyException';
    }
}

export interface DAGNode {
    readonly decoder: DecoderProvider;
    readonly inDegree: number;
}

/**
 * Kahn's Algorithm for topological sorting of Decoder Providers.
 * Operates strictly iteratively in O(V + E) time without recursion to guarantee zero stack overflow.
 */
export class DecoderDAG {

    /**
     * Resolves decoders into a topologized execution sequence using Kahn's Algorithm.
     * Throws CyclicDependencyException if a cycle is detected.
     */
    public static sortTopologically(decoders: readonly DecoderProvider[]): readonly DecoderProvider[] {
        if (decoders.length === 0) {
            return [];
        }

        const idToDecoder = new Map<string, DecoderProvider>();
        const inDegree = new Map<string, number>();
        const adjacency = new Map<string, Set<string>>();

        // 1. Initialize maps
        for (const decoder of decoders) {
            const id = String(decoder.id);
            idToDecoder.set(id, decoder);
            inDegree.set(id, 0);
            adjacency.set(id, new Set<string>());
        }

        // 2. Build graph edges based on inputType matching outputType of predecessor decoders
        for (const producer of decoders) {
            const producerId = String(producer.id);
            for (const consumer of decoders) {
                const consumerId = String(consumer.id);
                if (producerId !== consumerId && producer.outputType === consumer.inputType) {
                    const edgeSet = adjacency.get(producerId)!;
                    if (!edgeSet.has(consumerId)) {
                        edgeSet.add(consumerId);
                        inDegree.set(consumerId, (inDegree.get(consumerId) || 0) + 1);
                    }
                }
            }
        }

        // 3. Kahn's Algorithm: Queue of nodes with in-degree 0
        const queue: string[] = [];
        for (const [id, deg] of inDegree.entries()) {
            if (deg === 0) {
                queue.push(id);
            }
        }

        const sortedResult: DecoderProvider[] = [];

        while (queue.length > 0) {
            const currentId = queue.shift()!;
            const decoder = idToDecoder.get(currentId);
            if (decoder) {
                sortedResult.push(decoder);
            }

            const neighbors = adjacency.get(currentId) || new Set<string>();
            for (const neighborId of neighbors) {
                const updatedInDegree = (inDegree.get(neighborId) || 0) - 1;
                inDegree.set(neighborId, updatedInDegree);
                if (updatedInDegree === 0) {
                    queue.push(neighborId);
                }
            }
        }

        // 4. Cycle detection
        if (sortedResult.length !== decoders.length) {
            throw new CyclicDependencyException(
                `Cyclic dependency detected in Decoder DAG. Resolved ${sortedResult.length} of ${decoders.length} decoders.`
            );
        }

        return Object.freeze(sortedResult);
    }
}
