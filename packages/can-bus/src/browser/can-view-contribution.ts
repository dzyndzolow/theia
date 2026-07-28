// *****************************************************************************
// Copyright (C) 2024 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// This Source Code may also be made available under the following Secondary
// Licenses when the conditions for such availability set forth in the Eclipse
// Public License v. 2.0 are satisfied: GNU General Public License, version 2
// with the GNU Classpath Exception which is available at
// https://www.gnu.org/software/classpath/license.html.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { CommandRegistry, MenuModelRegistry } from '@theia/core/lib/common';
import { CanBusWidget } from '../common/can-protocol';

export const CanCommands = {
    TOGGLE: 'can-bus:toggle',
    START_CAPTURE: 'can-bus:start-capture',
    STOP_CAPTURE: 'can-bus:stop-capture',
    CLEAR: 'can-bus:clear'
} as const;

@injectable()
export class CanViewContribution extends AbstractViewContribution<CanBusWidget> {

    constructor() {
        super({
            widgetId: CanBusWidget.ID,
            widgetName: CanBusWidget.LABEL,
            defaultWidgetOptions: {
                area: 'bottom'
            },
            toggleCommandId: CanCommands.TOGGLE,
            toggleKeybinding: 'CtrlCmd+Shift+C'
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand({ id: CanCommands.START_CAPTURE, label: 'CAN: Start Capture' }, {
            execute: () => { /* will delegate to widget */ }
        });
        registry.registerCommand({ id: CanCommands.STOP_CAPTURE, label: 'CAN: Stop Capture' }, {
            execute: () => { /* will delegate to widget */ }
        });
        registry.registerCommand({ id: CanCommands.CLEAR, label: 'CAN: Clear Data' }, {
            execute: () => { /* will delegate to widget */ }
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(['view', 'can-bus-submenu'], {
            commandId: CanCommands.START_CAPTURE
        });
        menus.registerMenuAction(['view', 'can-bus-submenu'], {
            commandId: CanCommands.STOP_CAPTURE
        });
        menus.registerMenuAction(['view', 'can-bus-submenu'], {
            commandId: CanCommands.CLEAR
        });
    }
}
