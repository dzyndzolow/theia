// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { expect } from 'chai';
import { WidgetInstanceNumbers } from './widget-instance-numbers';

describe('WidgetInstanceNumbers', () => {
    it('reuses the lowest number released by a closed widget', () => {
        const numbers = new WidgetInstanceNumbers();
        expect(numbers.allocate()).to.equal(1);
        expect(numbers.allocate()).to.equal(2);
        expect(numbers.allocate()).to.equal(3);

        numbers.release(2);
        expect(numbers.allocate()).to.equal(2);
    });
});
