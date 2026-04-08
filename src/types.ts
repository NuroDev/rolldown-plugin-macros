export interface MacroPluginOptions {
	/**
	 * Custom filter to determine which files should be scanned for macro imports.
	 * By default, all .js, .ts, .jsx, .tsx, .mjs, .mts files are scanned.
	 */
	filter?: (id: string) => boolean;
}

/** Mapping from local binding name to the exported name from the macro module. */
export interface MacroBinding {
	exportedName: string;
	localName: string;
	moduleSpecifier: string;
}

/** A detected macro callsite to be replaced. */
export interface MacroCallsite {
	/** The local binding name used at the callsite. */
	binding: MacroBinding;
	/** End position in source (for replacement). */
	end: number;
	/** Start position in source (for replacement). */
	start: number;
	/** The statically-evaluated arguments to pass to the macro function. */
	staticArgs: Array<unknown>;
}

/** Info about a macro import declaration in source. */
export interface MacroImportInfo {
	bindings: Array<MacroBinding>;
	/** End position of the full import declaration (for removal). */
	end: number;
	moduleSpecifier: string;
	/** Start position of the full import declaration (for removal). */
	start: number;
}
