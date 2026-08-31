// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { ExperimentEvent, CanExperimentSessionConfig } from './can-experiment-protocol';
import { CandidateRankingReport } from './can-candidate-ranker';

export interface ExperimentArchivePackage {
    readonly schemaVersion: '1.0';
    readonly sessionId: string;
    readonly exportedAtIso: string;
    readonly initialSeed?: number;
    readonly targetDevice?: string;
    readonly safetyConfig: CanExperimentSessionConfig;
    readonly journalEvents: readonly ExperimentEvent[];
    readonly rankingReport?: CandidateRankingReport;
    readonly metadata?: Readonly<Record<string, string>>;
}

export class CanExperimentArchive {
    static serialize(archive: ExperimentArchivePackage): string {
        return JSON.stringify(archive, (key, value) => {
            if (typeof value === 'bigint') {
                return value.toString();
            }
            return value;
        }, 2);
    }

    static deserialize(jsonString: string): ExperimentArchivePackage {
        let parsed: unknown;
        try {
            parsed = JSON.parse(jsonString);
        } catch {
            throw new Error('Invalid JSON format in experiment archive package');
        }

        if (!parsed || typeof parsed !== 'object') {
            throw new Error('Experiment archive must be a valid JSON object');
        }

        const pkg = parsed as Partial<ExperimentArchivePackage>;

        if (pkg.schemaVersion !== '1.0') {
            throw new Error(`Unsupported archive schema version: ${pkg.schemaVersion}`);
        }

        if (!pkg.sessionId || !Array.isArray(pkg.journalEvents) || !pkg.safetyConfig) {
            throw new Error('Missing mandatory fields (sessionId, safetyConfig, journalEvents) in experiment package');
        }

        // Restore BigInt timestamps in journal events
        const restoredJournal: ExperimentEvent[] = pkg.journalEvents.map(ev => {
            const copy = { ...ev };
            if (typeof copy.timestampMonotonicNs === 'string') {
                copy.timestampMonotonicNs = BigInt(copy.timestampMonotonicNs);
            }
            return copy as ExperimentEvent;
        });

        return {
            ...pkg,
            schemaVersion: '1.0',
            sessionId: pkg.sessionId,
            exportedAtIso: pkg.exportedAtIso || new Date().toISOString(),
            safetyConfig: pkg.safetyConfig,
            journalEvents: restoredJournal
        };
    }
}
