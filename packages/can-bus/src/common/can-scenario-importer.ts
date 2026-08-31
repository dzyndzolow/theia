// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { CanFrame } from './can-protocol';
import { CanScenarioPackage } from './can-scenario-schema';

export class CanScenarioLogParser {
    /**
     * Parses standard Linux candump logs.
     * Supports formats:
     * - "(1600000000.123456) can0 123#1122334455667788"
     * - "can0 123#11223344"
     * - "vcan0 18DA00F1#021001" (extended 29-bit ID)
     * - "can0 123#R" (RTR)
     */
    static parseCandump(content: string, defaultIface = 'vcan0'): CanFrame[] {
        const lines = content.split(/\r?\n/);
        const frames: CanFrame[] = [];

        // Regex matches optional timestamp, interface, id and payload
        // e.g. (1600000000.123456) can0 123#11223344 or can0 123#11223344
        const lineRegex = /^(?:\(([0-9.]+)\)\s+)?(\w+)\s+([0-9a-fA-F]+)#([0-9a-fA-F]*)(?:#([0-9a-fA-F]*))?/;

        let firstTs: number | undefined;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
                continue;
            }

            const match = lineRegex.exec(trimmed);
            if (!match) {
                continue;
            }

            const rawTsStr = match[1];
            const iface = match[2] || defaultIface;
            const idHex = match[3];
            const dataHex = match[4];

            const id = parseInt(idHex, 16);
            const extended = idHex.length > 3 || id > 0x7FF;
            const rtr = dataHex.toUpperCase() === 'R';

            const data: number[] = [];
            if (!rtr && dataHex) {
                for (let i = 0; i < dataHex.length; i += 2) {
                    data.push(parseInt(dataHex.slice(i, i + 2), 16));
                }
            }

            let timestamp = 0;
            if (rawTsStr) {
                const sec = parseFloat(rawTsStr);
                if (firstTs === undefined) {
                    firstTs = sec;
                }
                timestamp = Math.round((sec - firstTs) * 1000);
            }

            frames.push({
                id,
                extended,
                rtr,
                dlc: data.length,
                data,
                timestamp,
                interface: iface
            });
        }

        return frames;
    }

    /**
     * Parses CSV log files with columns (timestamp, id, dlc, data).
     */
    static parseCsv(csvContent: string, defaultIface = 'vcan0'): CanFrame[] {
        const lines = csvContent.split(/\r?\n/);
        const frames: CanFrame[] = [];

        let isFirstLine = true;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }

            const cols = trimmed.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
            if (isFirstLine && (cols[0].toLowerCase().includes('time') || cols[1].toLowerCase().includes('id'))) {
                isFirstLine = false;
                continue;
            }
            isFirstLine = false;

            if (cols.length < 2) {
                continue;
            }

            const timestamp = parseFloat(cols[0]) || 0;
            const idStr = cols[1];
            const id = idStr.startsWith('0x') || idStr.startsWith('0X') ? parseInt(idStr, 16) : parseInt(idStr, 10);
            const extended = id > 0x7FF;

            const data: number[] = [];
            if (cols.length >= 4) {
                const hexClean = cols[3].replace(/[\s:-]/g, '');
                for (let i = 0; i < hexClean.length; i += 2) {
                    data.push(parseInt(hexClean.slice(i, i + 2), 16));
                }
            }

            frames.push({
                id,
                extended,
                rtr: false,
                dlc: data.length,
                data,
                timestamp,
                interface: defaultIface
            });
        }

        return frames;
    }

    /**
     * Parses a JSON scenario package.
     */
    static parseJsonScenario(jsonContent: string): CanScenarioPackage {
        const parsed = JSON.parse(jsonContent);
        if (!parsed.name || !Array.isArray(parsed.frames)) {
            throw new Error('Invalid CAN scenario package format: missing name or frames array');
        }
        return parsed as CanScenarioPackage;
    }
}
