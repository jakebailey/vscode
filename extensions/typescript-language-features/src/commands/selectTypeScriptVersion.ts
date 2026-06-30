/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getEffectiveTsNativeExtension, IJsTsServerSelectionService, LanguageServerPreference } from '../tsServer/serverSelectionTypes';
import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { Lazy } from '../utils/lazy';
import { Command } from './commandManager';

export class SelectTypeScriptVersionCommand implements Command {
	public static readonly id = 'typescript.selectTypeScriptVersion';
	public readonly id = SelectTypeScriptVersionCommand.id;

	public constructor(
		private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost> | undefined,
		private readonly serverSelectionService?: IJsTsServerSelectionService,
	) { }

	public async execute(): Promise<void> {
		if (!this.serverSelectionService || this.serverSelectionService.selection.kind === 'tsserver') {
			this.lazyClientHost?.value.serviceClient.showVersionPicker();
			return;
		}

		await this.showServerPreferencePicker();
	}

	private async showServerPreferencePicker(): Promise<void> {
		if (!this.serverSelectionService) {
			return;
		}

		interface PreferencePick extends vscode.QuickPickItem {
			readonly preference: LanguageServerPreference;
		}

		const currentPreference = this.serverSelectionService.selection.preference;
		const nativeExtension = getEffectiveTsNativeExtension();
		const items: PreferencePick[] = [
			{
				label: (currentPreference === 'auto' ? '• ' : '') + vscode.l10n.t("Use VS Code's Default"),
				description: vscode.l10n.t("Auto"),
				preference: 'auto',
			},
			{
				label: (currentPreference === 'preferTsserver' ? '• ' : '') + vscode.l10n.t("Prefer TypeScript Server"),
				description: vscode.l10n.t("Classic"),
				preference: 'preferTsserver',
			},
			{
				label: (currentPreference === 'preferLsp' ? '• ' : '') + vscode.l10n.t("Prefer Native TypeScript Server"),
				description: nativeExtension?.packageJSON?.version ?? vscode.l10n.t("Native"),
				preference: 'preferLsp',
			},
		];

		const selected = await vscode.window.showQuickPick(items, {
			placeHolder: vscode.l10n.t("Select the TypeScript version used for JavaScript and TypeScript language features"),
		});
		if (selected) {
			await this.serverSelectionService.setPreference(selected.preference);
		}
	}
}
