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
import { CanRecorderServiceImpl } from './can-recorder-service';
import { CanFrame } from '../common/can-protocol';

describe('SA-406: CanRecorderService', () => {
    let recorderService: CanRecorderServiceImpl;

    beforeEach(() => {
        recorderService = new CanRecorderServiceImpl();
    });

    afterEach(() => {
        recorderService.dispose();
    });

    it('should record frames only when in RECORDING state', () => {
        const frame: CanFrame = {
            id: 0x100,
            extended: false,
            rtr: false,
            dlc: 8,
            data: [1, 2, 3, 4, 5, 6, 7, 8],
            timestamp: 100,
            interface: 'vcan0'
        };

        recorderService.recordFrame(frame);
        expect(recorderService.getRecordedFrames()).to.have.lengthOf(0);

        recorderService.startRecording('vcan0');
        expect(recorderService.getState()).to.equal('RECORDING');

        recorderService.recordFrame(frame);
        expect(recorderService.getRecordedFrames()).to.have.lengthOf(1);

        const log = recorderService.stopRecording();
        expect(recorderService.getState()).to.equal('IDLE');
        expect(log.metadata.interfaceName).to.equal('vcan0');
        expect(log.metadata.frameCount).to.equal(1);
        expect(log.frames[0].id).to.equal(0x100);
    });
});
