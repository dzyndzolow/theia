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
import { CanScenarioLogParser } from './can-scenario-importer';

describe('SA-417 & SA-423: CanScenarioLogParser (candump, CSV, JSON)', () => {
    it('should parse Linux candump log lines with standard and extended IDs', () => {
        const candumpLog = `
(1600000000.000000) vcan0 123#DEADBEEF
(1600000000.050000) vcan0 18DA00F1#021001
        `.trim();

        const frames = CanScenarioLogParser.parseCandump(candumpLog);
        expect(frames).to.have.lengthOf(2);

        // Frame 1: Standard ID 0x123
        expect(frames[0].id).to.equal(0x123);
        expect(frames[0].extended).to.be.false;
        expect(frames[0].data).to.deep.equal([0xDE, 0xAD, 0xBE, 0xEF]);
        expect(frames[0].timestamp).to.equal(0);

        // Frame 2: Extended ID 0x18DA00F1
        expect(frames[1].id).to.equal(0x18DA00F1);
        expect(frames[1].extended).to.be.true;
        expect(frames[1].data).to.deep.equal([0x02, 0x10, 0x01]);
        expect(frames[1].timestamp).to.equal(50); // 50ms delta
    });

    it('should parse CSV log files with header', () => {
        const csvContent = `
timestamp,id,dlc,data
0,0x200,8,01 02 03 04 05 06 07 08
10,0x201,2,AABB
        `.trim();

        const frames = CanScenarioLogParser.parseCsv(csvContent);
        expect(frames).to.have.lengthOf(2);
        expect(frames[0].id).to.equal(0x200);
        expect(frames[0].data).to.deep.equal([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(frames[1].id).to.equal(0x201);
        expect(frames[1].data).to.deep.equal([0xAA, 0xBB]);
    });

    it('should parse declarative JSON scenario package', () => {
        const jsonContent = JSON.stringify({
            schemaVersion: '1.0',
            name: 'Cluster Wakeup Scenario',
            frames: [
                { id: 0x100, data: [1, 2, 3] },
                { id: 0x101, data: [4, 5, 6], delayBeforeMs: 20 }
            ]
        });

        const pkg = CanScenarioLogParser.parseJsonScenario(jsonContent);
        expect(pkg.name).to.equal('Cluster Wakeup Scenario');
        expect(pkg.frames).to.have.lengthOf(2);
        expect(pkg.frames[0].id).to.equal(0x100);
    });
});
