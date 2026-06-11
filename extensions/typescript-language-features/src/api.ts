/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PluginManager } from './tsServer/plugins';
import { IJsTsServerSelectionService, JsTsServerSelection, LanguageServerPreference } from './tsServer/serverSelectionTypes';

class ApiV0 {
	public constructor(
		public readonly onCompletionAccepted: vscode.Event<vscode.CompletionItem & { metadata?: any }>,
		private readonly _pluginManager: PluginManager,
		private readonly _serverSelectionService: IJsTsServerSelectionService,
	) { }

	configurePlugin(pluginId: string, configuration: {}): void {
		this._pluginManager.setConfiguration(pluginId, configuration);
	}

	getServerSelection(): JsTsServerSelection {
		return this._serverSelectionService.selection;
	}

	get onDidChangeServerSelection(): vscode.Event<JsTsServerSelection> {
		return this._serverSelectionService.onDidChangeSelection;
	}

	setLanguageServerPreference(preference: LanguageServerPreference): Thenable<void> {
		return this._serverSelectionService.setPreference(preference);
	}
}

export interface Api {
	getAPI(version: 0): ApiV0 | undefined;
}

export function getExtensionApi(
	onCompletionAccepted: vscode.Event<vscode.CompletionItem>,
	pluginManager: PluginManager,
	serverSelectionService: IJsTsServerSelectionService,
): Api {
	return {
		getAPI(version) {
			if (version === 0) {
				return new ApiV0(onCompletionAccepted, pluginManager, serverSelectionService);
			}
			return undefined;
		},
	};
}
