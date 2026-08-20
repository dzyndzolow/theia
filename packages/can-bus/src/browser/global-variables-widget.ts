// *****************************************************************************
// Copyright (C) 2026 EclipseSource and others.
//
// This program and the accompanying materials are made available under the
// terms of the Eclipse Public License v. 2.0 which is available at
// http://www.eclipse.org/legal/epl-2.0.
//
// SPDX-License-Identifier: EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0
// *****************************************************************************

import '../../src/browser/style/can-widget.css';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, Message } from '@theia/core/lib/browser';
import { Disposable } from '@theia/core/lib/common';
import {
    GlobalVariable,
    GlobalVariableRegistry,
    VariableType
} from '@theia/signal-core';

export const GLOBAL_VARIABLES_WIDGET_ID = 'global-variables-widget';
export const GLOBAL_VARIABLES_WIDGET_LABEL = 'Global Variables';

export const VARIABLE_TYPES: readonly VariableType[] = [
    'BOOL', 'UINT8', 'INT8', 'UINT16', 'INT16', 'UINT32', 'INT32',
    'FLOAT32', 'FLOAT64', 'STRING', 'BYTES'
];

@injectable()
export class GlobalVariablesWidget extends BaseWidget {

    static readonly ID = GLOBAL_VARIABLES_WIDGET_ID;
    static readonly LABEL = GLOBAL_VARIABLES_WIDGET_LABEL;

    @inject(GlobalVariableRegistry)
    protected readonly registry!: GlobalVariableRegistry;

    protected toolbar!: HTMLElement;
    protected searchInput!: HTMLInputElement;
    protected addDialog!: HTMLElement;
    protected tableContainer!: HTMLElement;
    protected tableBody!: HTMLTableSectionElement;
    protected statusSummary!: HTMLElement;

    protected readonly rowElements = new Map<string, {
        row: HTMLTableRowElement;
        valueCell: HTMLTableCellElement;
        valueInput?: HTMLInputElement;
        qualityBadge: HTMLElement;
        updatedCell: HTMLTableCellElement;
        versionCell: HTMLTableCellElement;
    }>();

    protected disposables: Disposable[] = [];
    protected filterQuery = '';
    protected renderScheduled = false;

    @postConstruct()
    protected init(): void {
        this.id = GlobalVariablesWidget.ID;
        this.title.label = GlobalVariablesWidget.LABEL;
        this.title.caption = GlobalVariablesWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-tags';

        this.addClass('global-variables-widget');
        this.addClass('theia-can-widget');

        this.buildLayout();

        this.disposables.push(
            this.registry.onDidDefinitionChange(() => this.scheduleFullRender()),
            this.registry.onDidVariableChange(event => this.updateVariableRow(event.id))
        );

        this.renderTable();
    }

    public override dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
        this.rowElements.clear();
        super.dispose();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.renderTable();
    }

    protected buildLayout(): void {
        this.node.textContent = '';

        // --- Toolbar ---
        this.toolbar = document.createElement('div');
        this.toolbar.className = 'can-toolbar global-vars-toolbar';

        const addBtn = document.createElement('button');
        addBtn.className = 'theia-button primary';
        addBtn.innerHTML = '<i class="fa fa-plus"></i> Add Variable';
        addBtn.onclick = () => this.toggleAddDialog();

        const exportBtn = document.createElement('button');
        exportBtn.className = 'theia-button secondary';
        exportBtn.innerHTML = '<i class="fa fa-download"></i> Export Map';
        exportBtn.onclick = () => this.handleExport();

        const importBtn = document.createElement('button');
        importBtn.className = 'theia-button secondary';
        importBtn.innerHTML = '<i class="fa fa-upload"></i> Import Map';
        importBtn.onclick = () => this.handleImport();

        const exportCsvBtn = document.createElement('button');
        exportCsvBtn.className = 'theia-button secondary';
        exportCsvBtn.innerHTML = '<i class="fa fa-table"></i> Export CSV';
        exportCsvBtn.onclick = () => this.handleExportCsv();

        const clearBtn = document.createElement('button');
        clearBtn.className = 'theia-button secondary danger';
        clearBtn.innerHTML = '<i class="fa fa-trash"></i> Clear All';
        clearBtn.onclick = () => {
            if (confirm('Are you sure you want to remove all global variables?')) {
                this.registry.clear();
            }
        };

        const searchWrapper = document.createElement('div');
        searchWrapper.className = 'global-vars-search-wrapper';
        this.searchInput = document.createElement('input');
        this.searchInput.className = 'theia-input global-vars-search';
        this.searchInput.type = 'text';
        this.searchInput.placeholder = 'Filter variables (name, group, type)...';
        this.searchInput.oninput = () => {
            this.filterQuery = this.searchInput.value.trim().toLowerCase();
            this.renderTable();
        };
        searchWrapper.appendChild(this.searchInput);

        this.statusSummary = document.createElement('div');
        this.statusSummary.className = 'global-vars-summary';

        this.toolbar.append(addBtn, exportBtn, importBtn, exportCsvBtn, clearBtn, searchWrapper, this.statusSummary);

        // --- Add Dialog / Form ---
        this.addDialog = this.createAddDialog();
        this.addDialog.style.display = 'none';

        // --- Table Container ---
        this.tableContainer = document.createElement('div');
        this.tableContainer.className = 'global-vars-table-container';

        const table = document.createElement('table');
        table.className = 'theia-can-table global-vars-table';

        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');
        const headers = ['Name', 'Group', 'Type', 'Length', 'Value (Live/Editable)', 'Unit', 'Quality', 'Source', 'Updated', 'Actions'];
        for (const h of headers) {
            const th = document.createElement('th');
            th.textContent = h;
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);
        table.appendChild(thead);

        this.tableBody = document.createElement('tbody');
        table.appendChild(this.tableBody);
        this.tableContainer.appendChild(table);

        this.node.append(this.toolbar, this.addDialog, this.tableContainer);
    }

    protected createAddDialog(): HTMLElement {
        const dialog = document.createElement('div');
        dialog.className = 'global-vars-add-form';

        const title = document.createElement('h4');
        title.textContent = 'Define New Global Variable';

        const formGrid = document.createElement('div');
        formGrid.className = 'global-vars-form-grid';

        // Name
        const nameInput = document.createElement('input');
        nameInput.className = 'theia-input';
        nameInput.placeholder = 'Variable Name (e.g. engine.rpm)';

        // Group
        const groupInput = document.createElement('input');
        groupInput.className = 'theia-input';
        groupInput.placeholder = 'Group (optional)';

        // Type
        const typeSelect = document.createElement('select');
        typeSelect.className = 'theia-select';
        for (const t of VARIABLE_TYPES) {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            typeSelect.appendChild(opt);
        }

        // Length
        const lengthInput = document.createElement('input');
        lengthInput.className = 'theia-input';
        lengthInput.type = 'number';
        lengthInput.placeholder = 'Length (for STRING/BYTES)';
        lengthInput.min = '1';

        // Initial Value
        const initialValInput = document.createElement('input');
        initialValInput.className = 'theia-input';
        initialValInput.placeholder = 'Initial Value (optional)';

        // Unit
        const unitInput = document.createElement('input');
        unitInput.className = 'theia-input';
        unitInput.placeholder = 'Unit (e.g. RPM, °C, bar)';

        // Description
        const descInput = document.createElement('input');
        descInput.className = 'theia-input';
        descInput.placeholder = 'Description (optional)';

        // Writable checkbox
        const writableLabel = document.createElement('label');
        writableLabel.className = 'global-vars-checkbox-label';
        const writableCheckbox = document.createElement('input');
        writableCheckbox.type = 'checkbox';
        writableCheckbox.checked = true;
        writableLabel.append(writableCheckbox, document.createTextNode(' Writable'));

        // Buttons
        const btnRow = document.createElement('div');
        btnRow.className = 'global-vars-form-buttons';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'theia-button primary';
        saveBtn.textContent = 'Save Variable';
        saveBtn.onclick = () => {
            try {
                const name = nameInput.value.trim();
                const type = typeSelect.value as VariableType;
                const lengthVal = lengthInput.value ? parseInt(lengthInput.value, 10) : undefined;
                const initialVal = initialValInput.value !== '' ? initialValInput.value : undefined;

                this.registry.define({
                    name,
                    type,
                    length: lengthVal,
                    initialValue: initialVal,
                    writable: writableCheckbox.checked,
                    group: groupInput.value.trim() || undefined,
                    unit: unitInput.value.trim() || undefined,
                    description: descInput.value.trim() || undefined
                });

                // Clear fields and hide
                nameInput.value = '';
                groupInput.value = '';
                lengthInput.value = '';
                initialValInput.value = '';
                unitInput.value = '';
                descInput.value = '';
                dialog.style.display = 'none';
            } catch (err: unknown) {
                alert((err as Error).message);
            }
        };

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'theia-button secondary';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => {
            dialog.style.display = 'none';
        };

        btnRow.append(saveBtn, cancelBtn);

        formGrid.append(
            nameInput, groupInput, typeSelect, lengthInput,
            initialValInput, unitInput, descInput, writableLabel
        );

        dialog.append(title, formGrid, btnRow);
        return dialog;
    }

    protected toggleAddDialog(): void {
        this.addDialog.style.display = this.addDialog.style.display === 'none' ? 'block' : 'none';
    }

    protected scheduleFullRender(): void {
        if (!this.renderScheduled) {
            this.renderScheduled = true;
            requestAnimationFrame(() => {
                this.renderScheduled = false;
                this.renderTable();
            });
        }
    }

    protected renderTable(): void {
        this.tableBody.textContent = '';
        this.rowElements.clear();

        const allVars = this.registry.list();
        const filtered = allVars.filter(v => {
            if (!this.filterQuery) {
                return true;
            }
            const q = this.filterQuery;
            return v.definition.name.toLowerCase().includes(q) ||
                (v.definition.group && v.definition.group.toLowerCase().includes(q)) ||
                v.definition.type.toLowerCase().includes(q) ||
                (v.definition.description && v.definition.description.toLowerCase().includes(q));
        });

        this.statusSummary.textContent = `Total: ${allVars.length} variable(s) | Filtered: ${filtered.length}`;

        for (const variable of filtered) {
            const row = this.createTableRow(variable);
            this.tableBody.appendChild(row);
        }
    }

    protected createTableRow(variable: GlobalVariable): HTMLTableRowElement {
        const { definition, state } = variable;
        const row = document.createElement('tr');
        row.className = 'global-var-row';

        // 1. Name
        const nameCell = document.createElement('td');
        nameCell.className = 'global-var-name';
        nameCell.textContent = definition.name;
        if (definition.description) {
            nameCell.title = definition.description;
        }

        // 2. Group
        const groupCell = document.createElement('td');
        groupCell.className = 'global-var-group';
        groupCell.textContent = definition.group ?? '—';

        // 3. Type
        const typeCell = document.createElement('td');
        const typeBadge = document.createElement('span');
        typeBadge.className = `global-var-type-badge type-${definition.type.toLowerCase()}`;
        typeBadge.textContent = definition.type;
        typeCell.appendChild(typeBadge);

        // 4. Length
        const lengthCell = document.createElement('td');
        lengthCell.textContent = definition.length !== undefined ? String(definition.length) : '—';

        // 5. Value
        const valueCell = document.createElement('td');
        valueCell.className = 'global-var-value-cell';

        let valueInput: HTMLInputElement | undefined;
        if (definition.writable) {
            valueInput = document.createElement('input');
            valueInput.className = 'theia-input global-var-value-input';
            valueInput.value = this.formatValue(state.value, definition.type);
            valueInput.onchange = () => {
                try {
                    this.registry.write(definition.id, valueInput!.value, { source: 'MANUAL' });
                    valueInput!.classList.remove('input-error');
                } catch (err: unknown) {
                    valueInput!.classList.add('input-error');
                    valueInput!.title = (err as Error).message;
                }
            };
            valueCell.appendChild(valueInput);
        } else {
            valueCell.textContent = this.formatValue(state.value, definition.type);
        }

        // 6. Unit
        const unitCell = document.createElement('td');
        unitCell.textContent = definition.unit ?? '—';

        // 7. Quality
        const qualityCell = document.createElement('td');
        const qualityBadge = document.createElement('span');
        qualityBadge.className = `global-var-quality-badge quality-${state.quality.toLowerCase()}`;
        qualityBadge.textContent = state.quality;
        qualityCell.appendChild(qualityBadge);

        // 8. Source
        const sourceCell = document.createElement('td');
        sourceCell.textContent = state.source ?? '—';

        // 9. Updated
        const updatedCell = document.createElement('td');
        updatedCell.className = 'global-var-updated';
        updatedCell.textContent = this.formatTimestamp(state.timestampNs);

        // 10. Actions
        const actionsCell = document.createElement('td');
        actionsCell.className = 'global-var-actions';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'theia-button secondary icon-only';
        deleteBtn.title = 'Delete Variable';
        deleteBtn.innerHTML = '<i class="fa fa-trash"></i>';
        deleteBtn.onclick = () => {
            if (confirm(`Remove variable '${definition.name}'?`)) {
                this.registry.remove(definition.id);
            }
        };
        actionsCell.appendChild(deleteBtn);

        row.append(
            nameCell, groupCell, typeCell, lengthCell, valueCell,
            unitCell, qualityCell, sourceCell, updatedCell, actionsCell
        );

        this.rowElements.set(definition.id, {
            row,
            valueCell,
            valueInput,
            qualityBadge,
            updatedCell,
            versionCell: updatedCell
        });

        return row;
    }

    protected updateVariableRow(id: string): void {
        const variable = this.registry.get(id);
        const cached = this.rowElements.get(id);
        if (!variable || !cached) {
            return;
        }

        const { state, definition } = variable;

        if (cached.valueInput) {
            // Only update if not currently focused to avoid interrupting user input
            if (document.activeElement !== cached.valueInput) {
                cached.valueInput.value = this.formatValue(state.value, definition.type);
            }
        } else {
            cached.valueCell.textContent = this.formatValue(state.value, definition.type);
        }

        cached.qualityBadge.className = `global-var-quality-badge quality-${state.quality.toLowerCase()}`;
        cached.qualityBadge.textContent = state.quality;
        cached.updatedCell.textContent = this.formatTimestamp(state.timestampNs);
    }

    protected formatValue(value: unknown, type: VariableType): string {
        if (value === undefined || value === '') {
            return '—';
        }
        if (type === 'BYTES' && value instanceof Uint8Array) {
            return '0x' + Array.from(value).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        }
        if (type === 'BOOL') {
            return value ? 'TRUE' : 'FALSE';
        }
        return String(value);
    }

    protected formatTimestamp(tsNs: bigint): string {
        const nowMs = Date.now();
        const date = new Date(nowMs);
        return `${date.toTimeString().split(' ')[0]}.${String(date.getMilliseconds()).padStart(3, '0')}`;
    }

    protected handleExport(): void {
        const json = this.registry.exportSnapshot();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `global-variables-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    protected handleImport(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = () => {
            if (input.files && input.files[0]) {
                const file = input.files[0];
                const reader = new FileReader();
                reader.onload = () => {
                    try {
                        const content = String(reader.result);
                        this.registry.importSnapshot(content, { overwriteExisting: true });
                        this.renderTable();
                    } catch (err: unknown) {
                        alert('Import failed: ' + (err as Error).message);
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    protected handleExportCsv(): void {
        const headers = ['id', 'name', 'type', 'length', 'writable', 'description', 'unit', 'group', 'source', 'currentValue'];
        const rows = this.registry.list().map(variable => [
            variable.definition.id,
            variable.definition.name,
            variable.definition.type,
            variable.definition.length ?? '',
            variable.definition.writable,
            variable.definition.description ?? '',
            variable.definition.unit ?? '',
            variable.definition.group ?? '',
            variable.definition.source ? JSON.stringify(variable.definition.source) : '',
            this.formatValue(variable.state.value, variable.definition.type)
        ]);
        const csv = [headers, ...rows]
            .map(row => row.map(value => this.escapeCsv(String(value))).join(','))
            .join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `global-variables-${Date.now()}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
    }

    protected escapeCsv(value: string): string {
        return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    }
}
