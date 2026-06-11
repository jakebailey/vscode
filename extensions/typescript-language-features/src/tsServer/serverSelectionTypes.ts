/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export const tsNativeExtensionId = 'typescriptteam.native-preview';
export const languageServerPreferenceConfig = 'languageServer.preference';

export type LanguageServerPreference = 'auto' | 'preferTsserver' | 'preferLsp';
export type JsTsServerKind = 'tsserver' | 'lsp';
export type JsTsServerSource = 'bundled' | 'user' | 'workspace';

export interface JsTsServerSelection {
	readonly kind: JsTsServerKind;
	readonly source: JsTsServerSource;
	readonly tsdk: string | undefined;
	readonly preference: LanguageServerPreference;
	readonly reason: string;
}

export interface IJsTsServerSelectionService {
	readonly selection: JsTsServerSelection;
	readonly onDidChangeSelection: vscode.Event<JsTsServerSelection>;
	setPreference(preference: LanguageServerPreference): Thenable<void>;
}
