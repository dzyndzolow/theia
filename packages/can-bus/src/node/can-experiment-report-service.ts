// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { ExperimentArchivePackage } from '../common/can-experiment-archive';

export const CanExperimentReportService = Symbol('CanExperimentReportService');

export interface CanExperimentReportService {
    generateMarkdownReport(archive: ExperimentArchivePackage): string;
}

@injectable()
export class CanExperimentReportServiceImpl implements CanExperimentReportService {
    generateMarkdownReport(archive: ExperimentArchivePackage): string {
        const lines: string[] = [];

        lines.push(`# Experiment Execution Report: ${archive.sessionId}`);
        lines.push('');
        lines.push(`- **Exported At:** ${archive.exportedAtIso}`);
        lines.push(`- **Target Device:** ${archive.targetDevice || 'Unknown / General DUT'}`);
        lines.push(`- **Seed:** ${archive.initialSeed !== undefined ? archive.initialSeed : 'N/A'}`);
        lines.push(`- **Total Journal Events:** ${archive.journalEvents.length}`);
        const allowedStr = Array.isArray(archive.safetyConfig.allowedIds)
            ? archive.safetyConfig.allowedIds.map((id: number) => `0x${id.toString(16).toUpperCase()}`).join(', ')
            : archive.safetyConfig.allowedIds;
        lines.push(`- **Allowed IDs:** ${allowedStr}`);
        lines.push(`- **Max FPS Limit:** ${archive.safetyConfig.maxFps} fps`);
        lines.push('');

        lines.push('## Candidate Identification & Evidence');
        lines.push('');

        if (archive.rankingReport && archive.rankingReport.candidates.length > 0) {
            lines.push('| CAN ID | Confidence Score | Observations | Positive Hits | Negative Hits |');
            lines.push('|---|---|---|---|---|');
            for (const cand of archive.rankingReport.candidates) {
                const idHex = `0x${cand.id.toString(16).toUpperCase()}`;
                const score = `${(cand.score * 100).toFixed(1)}%`;
                const obs = `${cand.totalTrials} trials`;
                const pos = `${cand.positiveHits}`;
                const neg = `${cand.negativeHits}`;
                lines.push(`| \`${idHex}\` | **${score}** | ${obs} | ${pos} | ${neg} |`);
            }
        } else {
            lines.push('*No evidence candidates recorded.*');
        }

        lines.push('');
        lines.push('## Safety Audit & Fault Summary');
        lines.push('');

        const faultEvents = archive.journalEvents.filter(ev => ev.type === 'ERROR' || ev.type === 'STATE_CHANGE' && ev.newState === 'FAULT');
        if (faultEvents.length > 0) {
            lines.push(`Found **${faultEvents.length}** safety/fault events during session:`);
            lines.push('');
            for (const ev of faultEvents) {
                const ts = new Date(ev.wallClockIso).toLocaleTimeString();
                if (ev.type === 'ERROR') {
                    lines.push(`- [${ts}] **${ev.code}**: ${ev.message}`);
                } else if (ev.type === 'STATE_CHANGE') {
                    lines.push(`- [${ts}] State transitioned to **${ev.newState}** (reason: ${ev.reason || 'N/A'})`);
                }
            }
        } else {
            lines.push('✅ No safety policy violations or fault events recorded during this session.');
        }

        return lines.join('\n');
    }
}
