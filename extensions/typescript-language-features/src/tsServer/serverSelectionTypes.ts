/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { readUnifiedConfig } from '../utils/configuration';

export const tsNativeExtensionId = 'typescriptteam.vscode-typescript';
export const legacyTsNativeExtensionId = 'typescriptteam.native-preview';
export const languageServerPreferenceConfig = 'languageServer.preference';
export const useWorkspaceTsdkStorageKey = 'typescript.useWorkspaceTsdk';

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
	update(): void;
	setPreference(preference: LanguageServerPreference): Thenable<void>;
}

export function getTsNativeExtension(): vscode.Extension<unknown> | undefined {
	return vscode.extensions.getExtension(tsNativeExtensionId) ?? vscode.extensions.getExtension(legacyTsNativeExtensionId);
}

export function readLanguageServerPreference(): LanguageServerPreference {
	const preference = readUnifiedConfig<LanguageServerPreference>(languageServerPreferenceConfig, 'auto', { fallbackSection: 'typescript' });
	if (preference === 'auto' || preference === 'preferTsserver' || preference === 'preferLsp') {
		return preference;
	}
	return 'auto';
}
