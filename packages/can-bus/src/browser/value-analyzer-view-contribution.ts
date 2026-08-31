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
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { CommandRegistry, MenuModelRegistry, MAIN_MENU_BAR } from '@theia/core/lib/common';
import { VALUE_ANALYZER_WIDGET_ID, VALUE_ANALYZER_WIDGET_LABEL, ValueAnalyzerWidget } from './value-analyzer-widget';

export const CanValueCommands = {
    OPEN_VALUE_ANALYZER: 'can-bus:open-value-analyzer',
    NEW_VALUE_ANALYZER: 'can-bus:new-value-analyzer'
} as const;

@injectable()
export class CanValueViewContribution extends AbstractViewContribution<ValueAnalyzerWidget> {

    constructor() {
        super({
            widgetId: VALUE_ANALYZER_WIDGET_ID,
            widgetName: VALUE_ANALYZER_WIDGET_LABEL,
            defaultWidgetOptions: {
                area: 'main'
            },
            toggleCommandId: CanValueCommands.OPEN_VALUE_ANALYZER
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand({ id: CanValueCommands.NEW_VALUE_ANALYZER, label: 'New CAN Value Plot' }, {
            execute: () => this.openNewValueAnalyzer()
        });
    }

    protected async openNewValueAnalyzer(): Promise<void> {
        const widget = await this.widgetManager.getOrCreateWidget<ValueAnalyzerWidget>(VALUE_ANALYZER_WIDGET_ID, {
            id: `${VALUE_ANALYZER_WIDGET_ID}:${Date.now()}`
        });
        await this.shell.addWidget(widget, { area: 'main' });
        await this.shell.activateWidget(widget.id);
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        const analyzerMenuPath = [...MAIN_MENU_BAR, 'sample-menu'];
        menus.registerMenuAction(analyzerMenuPath, {
            commandId: CanValueCommands.NEW_VALUE_ANALYZER,
            order: '3'
        });
    }
}
