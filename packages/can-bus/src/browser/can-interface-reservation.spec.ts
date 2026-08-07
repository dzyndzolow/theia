// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { CanInterfaceReservation } from './can-interface-reservation';

describe('CanInterfaceReservation', () => {
    it('keeps an interface unavailable to other widgets and releases it on close', () => {
        const reservation = new CanInterfaceReservation();
        expect(reservation.reserve('widget-1', 'demo')).to.equal(true);
        expect(reservation.isReservedByOther('widget-2', 'demo')).to.equal(true);
        expect(reservation.reserve('widget-2', 'demo')).to.equal(false);

        reservation.release('widget-1');
        expect(reservation.reserve('widget-2', 'demo')).to.equal(true);
    });
});
