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
import { CanScpiPowerFeedbackProvider } from './can-scpi-feedback-provider';
import { CanGpioFeedbackProvider } from './can-gpio-feedback-provider';
import { FeedbackEvent } from '../common/can-experiment-protocol';

describe('SA-422: CanFeedbackSensors (SCPI Power & GPIO)', () => {
    it('should detect current jump ΔI above threshold and emit POWER feedback', async () => {
        const scpiProvider = new CanScpiPowerFeedbackProvider();
        scpiProvider.configure({
            baselineCurrentA: 0.04, // 40mA sleep
            deltaCurrentThresholdA: 0.10 // 100mA jump threshold
        });

        const receivedEvents: FeedbackEvent[] = [];
        await scpiProvider.startMonitoring('sess-scpi-1', fb => receivedEvents.push(fb));

        // Sample 1: 50mA (ΔI = 10mA < 100mA) -> no event
        const ev1 = await scpiProvider.processCurrentSample(0.05);
        expect(ev1).to.be.undefined;
        expect(receivedEvents).to.have.lengthOf(0);

        // Sample 2: 250mA (ΔI = 210mA >= 100mA) -> triggers POSITIVE POWER feedback
        const ev2 = await scpiProvider.processCurrentSample(0.25);
        expect(ev2).to.not.be.undefined;
        expect(ev2?.source).to.equal('SCPI_POWER');
        expect(ev2?.feedbackType).to.equal('POWER');
        expect(ev2?.kind).to.equal('POSITIVE');
        expect(receivedEvents).to.have.lengthOf(1);

        await scpiProvider.stopMonitoring();
        scpiProvider.dispose();
    });

    it('should detect GPIO rising edge and emit GPIO feedback', async () => {
        const gpioProvider = new CanGpioFeedbackProvider();
        const receivedEvents: FeedbackEvent[] = [];
        await gpioProvider.startMonitoring('sess-gpio-1', fb => receivedEvents.push(fb));

        // Pin transitions from 0 to 1
        const ev = gpioProvider.processPinTransition(1);
        expect(ev).to.not.be.undefined;
        expect(ev?.source).to.equal('GPIO');
        expect(ev?.kind).to.equal('POSITIVE');
        expect(receivedEvents).to.have.lengthOf(1);

        await gpioProvider.stopMonitoring();
        gpioProvider.dispose();
    });
});
