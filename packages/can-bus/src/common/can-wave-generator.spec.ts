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
import { CanWaveGenerator } from './can-wave-generator';

describe('SA-419: CanWaveGenerator (Sine, Triangle, Ramp, Square)', () => {
    it('should generate accurate sine wave values with amplitude and offset', () => {
        const config = {
            shape: 'SINE' as const,
            amplitude: 10,
            frequencyHz: 1, // 1 Hz (period 1s)
            offset: 50
        };

        // at t=0: offset + 10*sin(0) = 50
        expect(CanWaveGenerator.evaluateAt(config, 0)).to.be.closeTo(50, 0.001);
        // at t=0.25: offset + 10*sin(pi/2) = 60
        expect(CanWaveGenerator.evaluateAt(config, 0.25)).to.be.closeTo(60, 0.001);
        // at t=0.5: offset + 10*sin(pi) = 50
        expect(CanWaveGenerator.evaluateAt(config, 0.5)).to.be.closeTo(50, 0.001);
        // at t=0.75: offset + 10*sin(3pi/2) = 40
        expect(CanWaveGenerator.evaluateAt(config, 0.75)).to.be.closeTo(40, 0.001);
    });

    it('should generate square toggle wave between high and low values', () => {
        const config = {
            shape: 'SQUARE_TOGGLE' as const,
            amplitude: 5,
            frequencyHz: 2, // 2 Hz (period 0.5s: 0-0.25s high, 0.25-0.5s low)
            offset: 10
        };

        expect(CanWaveGenerator.evaluateAt(config, 0.1)).to.equal(15);
        expect(CanWaveGenerator.evaluateAt(config, 0.3)).to.equal(5);
    });

    it('should generate ramp wave and respect minLimit and maxLimit', () => {
        const config = {
            shape: 'RAMP' as const,
            amplitude: 100,
            frequencyHz: 1,
            offset: 0,
            maxLimit: 80
        };

        // at t=0.9 (fraction=0.9 -> 90), but capped at maxLimit 80
        expect(CanWaveGenerator.evaluateAt(config, 0.9)).to.equal(80);
    });
});
