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
import { CanSafetyPolicy } from './can-safety-policy';
import { CanExperimentSessionConfig } from './can-experiment-protocol';
import { CanFrame } from './can-protocol';

describe('SA-410: CanSafetyPolicy', () => {
    const baseConfig: CanExperimentSessionConfig = {
        sessionId: 'test-session',
        interfaceName: 'vcan0',
        bitrate: 500000,
        mode: 'CAN_2_0',
        idMode: 'STANDARD_11BIT',
        allowedIds: [0x100, 0x101, 0x120],
        maxFps: 100,
        maxBusLoadPercent: 70,
        maxDurationMs: 10000,
        allowRemoteFrames: false,
        allowDiagnosticServices: false
    };

    const validFrame: CanFrame = {
        id: 0x100,
        extended: false,
        rtr: false,
        data: [0x01, 0x02, 0x03],
        dlc: 3,
        timestamp: 100,
        interface: 'vcan0'
    };

    describe('validateTx', () => {
        it('should allow transmission when session is RUNNING and frame is on allowlist', () => {
            const result = CanSafetyPolicy.validateTx(validFrame, 'RUNNING', baseConfig);
            expect(result.valid).to.be.true;
        });

        it('should reject transmission when session is not RUNNING (e.g. DISARMED, ARMED, STOPPED)', () => {
            expect(CanSafetyPolicy.validateTx(validFrame, 'DISARMED', baseConfig).valid).to.be.false;
            expect(CanSafetyPolicy.validateTx(validFrame, 'ARMED', baseConfig).valid).to.be.false;
            expect(CanSafetyPolicy.validateTx(validFrame, 'STOPPED', baseConfig).valid).to.be.false;
            expect(CanSafetyPolicy.validateTx(validFrame, 'FAULT', baseConfig).valid).to.be.false;
        });

        it('should reject CAN ID not in allowlist', () => {
            const forbiddenFrame: CanFrame = { ...validFrame, id: 0x200 };
            const result = CanSafetyPolicy.validateTx(forbiddenFrame, 'RUNNING', baseConfig);
            expect(result.valid).to.be.false;
            expect(result.violationCode).to.equal('ID_NOT_ALLOWED');
        });

        it('should allow all 11-bit IDs when configured with ALLOW_ALL_11BIT_BENCH_ONLY', () => {
            const benchConfig: CanExperimentSessionConfig = {
                ...baseConfig,
                allowedIds: 'ALLOW_ALL_11BIT_BENCH_ONLY'
            };
            expect(CanSafetyPolicy.validateTx({ ...validFrame, id: 0x7E0 }, 'RUNNING', benchConfig).valid).to.be.true;
            // But still reject extended
            expect(CanSafetyPolicy.validateTx({ ...validFrame, id: 0x18DA00F1, extended: true }, 'RUNNING', benchConfig).valid).to.be.false;
        });

        it('should reject RTR frames when allowRemoteFrames is false', () => {
            const rtrFrame: CanFrame = { ...validFrame, rtr: true, data: [] };
            const result = CanSafetyPolicy.validateTx(rtrFrame, 'RUNNING', baseConfig);
            expect(result.valid).to.be.false;
            expect(result.violationCode).to.equal('REMOTE_FRAME_FORBIDDEN');
        });

        it('should reject 29-bit extended frames when idMode is STANDARD_11BIT', () => {
            const extFrame: CanFrame = { ...validFrame, id: 0x100, extended: true };
            const result = CanSafetyPolicy.validateTx(extFrame, 'RUNNING', baseConfig);
            expect(result.valid).to.be.false;
            expect(result.violationCode).to.equal('EXTENDED_ID_FORBIDDEN');
        });

        it('should reject restricted diagnostic/security payloads (e.g. UDS SecurityAccess 0x27) by default', () => {
            const secAccessFrame: CanFrame = {
                ...validFrame,
                data: [0x02, 0x27, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
                dlc: 8
            };
            const result = CanSafetyPolicy.validateTx(secAccessFrame, 'RUNNING', baseConfig);
            expect(result.valid).to.be.false;
            expect(result.violationCode).to.equal('DIAGNOSTIC_SERVICE_FORBIDDEN');
        });

        it('should reject when metrics indicate BUS_OFF or rate limit exceeded', () => {
            const busOffResult = CanSafetyPolicy.validateTx(validFrame, 'RUNNING', baseConfig, {
                currentFps: 10,
                estimatedBusLoadPercent: 10,
                consecutiveErrors: 5,
                isBusOff: true
            });
            expect(busOffResult.valid).to.be.false;

            const rateExceededResult = CanSafetyPolicy.validateTx(validFrame, 'RUNNING', baseConfig, {
                currentFps: 150, // max is 100
                estimatedBusLoadPercent: 10,
                consecutiveErrors: 0,
                isBusOff: false
            });
            expect(rateExceededResult.valid).to.be.false;
            expect(rateExceededResult.violationCode).to.equal('RATE_LIMIT_EXCEEDED');

            const loadExceededResult = CanSafetyPolicy.validateTx(validFrame, 'RUNNING', baseConfig, {
                currentFps: 50,
                estimatedBusLoadPercent: 85, // max is 70
                consecutiveErrors: 0,
                isBusOff: false
            });
            expect(loadExceededResult.valid).to.be.false;
            expect(loadExceededResult.violationCode).to.equal('BUS_LOAD_EXCEEDED');
        });

        it('should reject malformed IDs, DLC/payload mismatches and non-byte data', () => {
            expect(CanSafetyPolicy.validateTx({ ...validFrame, id: -1 }, 'RUNNING', baseConfig).violationCode)
                .to.equal('INVALID_FRAME');
            expect(CanSafetyPolicy.validateTx({ ...validFrame, dlc: 2 }, 'RUNNING', baseConfig).violationCode)
                .to.equal('INVALID_FRAME');
            expect(CanSafetyPolicy.validateTx({ ...validFrame, data: [1, 2, 256] }, 'RUNNING', baseConfig).violationCode)
                .to.equal('INVALID_FRAME');
        });
    });

    describe('transition', () => {
        it('should follow proper lifecycle from DISARMED -> ARMED -> RUNNING -> STOPPED', () => {
            let state = CanSafetyPolicy.transition('DISARMED', 'ARM');
            expect(state.allowed).to.be.true;
            expect(state.nextState).to.equal('ARMED');

            state = CanSafetyPolicy.transition('ARMED', 'START');
            expect(state.allowed).to.be.true;
            expect(state.nextState).to.equal('RUNNING');

            state = CanSafetyPolicy.transition('RUNNING', 'STOP');
            expect(state.allowed).to.be.true;
            expect(state.nextState).to.equal('STOPPED');
        });

        it('should not allow START directly from DISARMED without ARM', () => {
            const state = CanSafetyPolicy.transition('DISARMED', 'START');
            expect(state.allowed).to.be.false;
            expect(state.nextState).to.equal('DISARMED');
        });

        it('should transition to FAULT on error or manual fault action', () => {
            const state = CanSafetyPolicy.transition('RUNNING', 'FAULT');
            expect(state.allowed).to.be.true;
            expect(state.nextState).to.equal('FAULT');
        });
    });
});
