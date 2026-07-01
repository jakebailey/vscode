/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { getBundledTypeScriptVersion, getEffectiveTsNativeExtension, IJsTsServerSelectionService, LanguageServerPreference, tsNativeNightlyExtensionId } from '../tsServer/serverSelectionTypes';
import { ITypeScriptVersionProvider } from '../tsServer/versionProvider';
import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { Lazy } from '../utils/lazy';
import { Command } from './commandManager';

export class SelectTypeScriptVersionCommand implements Command {
	public static readonly id = 'typescript.selectTypeScriptVersion';
	public readonly id = SelectTypeScriptVersionCommand.id;

	public constructor(
		private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost> | undefined,
		private readonly serverSelectionService?: IJsTsServerSelectionService,
		private readonly versionProvider?: ITypeScriptVersionProvider,
	) { }

	public async execute(): Promise<void> {
		if (!this.serverSelectionService || !this.versionProvider) {
			this.lazyClientHost?.value.serviceClient.showVersionPicker();
			return;
		}

		await this.showServerPreferencePicker();
	}

	private async showServerPreferencePicker(): Promise<void> {
		if (!this.serverSelectionService || !this.versionProvider) {
			return;
		}

		interface PreferencePick extends vscode.QuickPickItem {
			readonly preference: LanguageServerPreference;
		}

		const currentPreference = this.serverSelectionService.selection.preference;
		const versionProvider = this.versionProvider;
		const nativeExtension = getEffectiveTsNativeExtension();
		const nativeVersion = nativeExtension ? getBundledTypeScriptVersion(nativeExtension) : undefined;
		const nativeLabel = nativeExtension?.id.toLowerCase() === tsNativeNightlyExtensionId ? vscode.l10n.t("TypeScript Nightly") : vscode.l10n.t("TypeScript 7");
		const autoDescription = this.serverSelectionService.selection.source === 'bundled'
			? this.serverSelectionService.selection.kind === 'lsp'
				? nativeVersion
				: versionProvider.defaultVersion.displayName
			: this.serverSelectionService.selection.reason;
		const items: PreferencePick[] = [
			{
				label: (currentPreference === 'auto' ? '• ' : '') + vscode.l10n.t("Auto"),
				description: autoDescription,
				detail: vscode.l10n.t("Uses the recommended TypeScript version"),
				preference: 'auto',
			},
			{
				label: (currentPreference === 'preferTsserver' ? '• ' : '') + vscode.l10n.t("Bundled"),
				description: versionProvider.bundledVersion.displayName,
				detail: vscode.l10n.t("Built into VS Code"),
				preference: 'preferTsserver',
			},
			{
				label: (currentPreference === 'preferLsp' ? '• ' : '') + nativeLabel,
				description: nativeVersion,
				detail: nativeExtension?.id,
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
