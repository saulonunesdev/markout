import { sequence, debugging, matchAll, normalizeString } from '/markout/lib/helpers.js';
import { encodeEntities, tokenize as tokenize$1 } from '/markup/dist/tokenizer.browser.js';

// export const MarkupSourceTypeAttribute = 'source-type';
// export const MarkupModeAttribute = 'markup-mode';
// export const MarkupOptionsAttribute = 'markup-options';
// export const MarkupSyntaxAttribute = 'markup-syntax';

class ComposableList extends Array {
	toString(
		listInset = this.listInset || '',
		listType = this.listType || 'ul',
		listStyle = this.listStyle,
		listStart = this.listStart,
	) {
		const attributes = `${
			// TODO: Explore using type attribute instead
			(listStyle && `style="list-style: ${listStyle}"`) || ''
		} ${
			// TODO: Check if guard against invalid start is needed
			(listStart && `start="${listStart}"`) || ''
		}`.trim();

		const listRows = [`${listInset}<${listType}${(attributes && ` ${attributes}`) || ''}>`];
		for (const item of this) {
			if (item && typeof item === 'object') {
				if (item instanceof ComposableList) {
					const last = listRows.length - 1;
					const row = listRows[last];
					last > 0
						? (listRows[listRows.length - 1] = `${row.slice(0, -5)}\n${item.toString(
								`${listInset}\t\t`,
						  )}\n${listInset}\t</li>`)
						: listRows.push(`${listInset}\t<li>\n${item.toString(`${listInset}\t\t`)}\n${listInset}\t</li>`);
				} else {
					const insetText = `${item}`;
					let text = insetText;
					for (const character of listInset) {
						if (!text.startsWith(character)) break;
						text = text.slice(1);
					}
					listRows.push(text);
				}
			} else {
				const [, checkbox, content] = /^\s*(?:\[([xX]| )\] |)(.+?)\s*$/.exec(item);

				content &&
					listRows.push(
						checkbox
							? `${listInset}\t<label><input type=checkbox ${checkbox === ' ' ? '' : ' checked'}/>${content}</label>`
							: `${listInset}\t<li>${content}</li>`,
					);
			}
		}
		listRows.push(`${listInset}</${listType}>`);
		return `\n${listRows.join('\n')}\n`;
	}
}

ComposableList.SQUARE = /^[-](?=\s|$)/;
ComposableList.DISC = /^[*](?=\s|$)/;
ComposableList.DECIMAL = /^0*\d+\./;
ComposableList.LATIN = /^[a-z]\./i;
ComposableList.ROMAN = /^[ivx]+\./i;
ComposableList.ORDERED = /^(?:0+[1-9]\d*|\d+|[ivx]+|[a-z])(?=\. |$)/i;
ComposableList.UNORDERED = /^[-*](?= |$)/i;

ComposableList.ORDERED_STYLE = /^(?:(0+[1-9]\d*)|(\d+)|([ivx]+)|([a-z]))(?=\. )|/i;
ComposableList.ORDERED_STYLE.key = ['decimal-leading-zero', 'decimal', 'roman', 'latin'];

ComposableList.orderedStyleOf = (marker, variant, fallback) => {
	const category =
		ComposableList.ORDERED_STYLE.key[
			ComposableList.ORDERED_STYLE.exec(marker)
				.slice(1)
				.findIndex(Boolean)
		];
	return (
		(category !== undefined &&
			(category === 'latin' || category === 'roman'
				? `${
						variant === 'lower' || (variant !== 'upper' && marker === marker.toLowerCase()) ? 'lower' : 'upper'
				  }-${category}`
				: category === 'decimal'
				? variant !== 'leading-zero'
					? 'decimal'
					: 'decimal-leading-zero'
				: variant !== 'decimal'
				? 'decimal-leading-zero'
				: 'decimal')) ||
		fallback
	);
};

ComposableList.markerIsLike = (marker, expected) =>
	expected in ComposableList.LIKE ? ComposableList.LIKE[expected].test(marker) : undefined;

ComposableList.LIKE = {
	['square']: ComposableList.SQUARE,
	['disc']: ComposableList.DISC,
	['decimal']: ComposableList.DECIMAL,
	['decimal-leading-zero']: ComposableList.DECIMAL,
	['roman']: ComposableList.ROMAN,
	['lower-roman']: ComposableList.ROMAN,
	['upper-roman']: ComposableList.ROMAN,
	['latic']: ComposableList.LATIN,
	['lower-latic']: ComposableList.LATIN,
	['upper-latic']: ComposableList.LATIN,
	['ul']: ComposableList.UNORDERED,
	['ol']: ComposableList.ORDERED,
};

const {
	/** Attempts to overcome **__** */

	'markout-render-merged-marking': MERGED_MARKING = true,
} = import.meta;

const MATCHES = Symbol('matches');
const ALIASES = 'aliases';
const BLOCKS = 'blocks';

const NormalizableBlocks = /(?:^|\n)([> \t]*(?:\`\`\`|\~\~\~))[^]+?(?:(?:\n\1[ \t]*)+\n?|$)|([^]+?(?:(?=\n[> \t]*(?:\`\`\`|\~\~\~))|$))/g;
const NormalizableParagraphs = /^((?:[ \t]*\n([> \t]*))+)((?:(?!(?:\d+\. |[a-z]\. |[ivx]+\. |[-*] ))[^\-#>|~\n].*(?:\n[> \t]*$)+|$)+)/gm;
const RewritableParagraphs = /^([ \t]*[^\-\*#>\n].*?)(\b.*[^:\n\s>]+|\b)[ \t]*\n[ \t>]*(?=(\b|\[.*?\][^:\n]?|[^#`\[\n]))/gm;
const NormalizableLists = /(?=(\n[> \t]*)(?:[-*] |[1-9]+\d*\. |[a-z]\. |[ivx]+\. ))((?:\1(?:[-*] |[1-9]+\d*\. |[a-z]\. |[ivx]+\. |   ?)+[^\n]+(?:\n[> \t]*)*(?=\1|$))+)/g;
const NormalizableListItem = /^([> \t]*)([-*] |[1-9]+\d*\. |[a-z]\. |[ivx]+\. |)([^\n]+(?:\n\1(?:   ?|\t ?)(?![ \t]|[-*] |\d+\. |[a-z]\. |[ivx]+\. ).*)*)$/gm;
const NormalizableReferences = /\!?\[(\S.+?\S)\](?:\((\S[^\n()\[\]]*?\S)\)|\[(\S[^\n()\[\]]*\S)\])/g;
const RewritableAliases = /^([> \t]*)\[(\S.+?\S)\]:\s+(\S+)(?:\s+"([^\n]*)"|\s+'([^\n]*)'|)(?=\s*$)/gm;
const NormalizableLink = /\s*((?:\s?[^'"\(\)\]\[\s\n]+)*)(?:\s+["']([^\n]*)["']|)/;

class MarkoutBlockNormalizer {
	/**
	 * @param {string} sourceText
	 * @param {{ aliases?: { [name: string]: alias } }} [state]
	 */
	normalizeBlocks(sourceText, state = {}) {
		const {sources = (state.sources = []), [ALIASES]: aliases = (state[ALIASES] = {})} = state;

		const source = {sourceText, [BLOCKS]: [], [ALIASES]: {}};
		sources.push(source);

		Blocks: {
			const {
				sourceText,
				[BLOCKS]: sourceBlocks,
				[BLOCKS]: {
					[MATCHES]: matchedBlocks = (sourceBlocks[MATCHES] = []),
					[MATCHES]: {fenced: fenced = (matchedBlocks.fenced = []), unfenced: unfenced = (matchedBlocks.unfenced = [])},
				},
				[ALIASES]: sourceAliases,
				[ALIASES]: {
					[MATCHES]: matchedAliases = (sourceAliases[MATCHES] = []),
					[MATCHES]: {aliased = (matchedAliases.aliased = []), unaliased = (matchedAliases.unaliased = [])},
				},
			} = source;
			let match = (NormalizableBlocks.lastIndex = null);

			const replaceAlias = (text, indent, alias, href, title, index) => {
				const match = {text, indent, alias, href, title, index};

				// TODO: Figure out anchors: https://www.w3.org/TR/2017/REC-html52-20171214/links.html
				return alias && alias.trim()
					? (aliased.push((sourceAliases[alias] = aliases[alias] = match)),
					  `<a hidden rel="alias" name="${alias}" href="${href}">${title || ''}</a>`)
					: (unaliased.push(match), text);
			};

			while ((match = NormalizableBlocks.exec(sourceText))) {
				matchedBlocks.push(([match.text, match.fence, match.unfenced] = match));
				if (match.fence) {
					fenced.push(match);
				} else {
					unfenced.push(match);
					match.text = match.text.replace(RewritableAliases, replaceAlias);
				}
			}
		}

		Normalization: {
			const {[BLOCKS]: sourceBlocks} = source;
			for (const {text, fence, unfenced} of sourceBlocks[MATCHES]) {
				sourceBlocks.push(
					fence
						? text
						: this.normalizeParagraphs(
								this.normalizeBreaks(this.normalizeLists(this.normalizeReferences(text, state))),
						  ),
				);
			}
			source.normalizedText = sourceBlocks.join('\n');
			import.meta['debug:markout:block-normalization'] && console.log('normalizeSourceText:', state);
		}

		return source.normalizedText;
	}

	/**
	 * @param {string} sourceText
	 * @param {{ aliases?: { [name: string]: alias } }} [state]
	 */
	normalizeReferences(sourceText, state = {}) {
		const debugging = import.meta['debug:markout:anchor-normalization'];
		const {aliases = (state.aliases = {})} = state;

		return sourceText.replace(NormalizableReferences, (m, text, link, alias, index) => {
			const reference = (alias && (alias = alias.trim())) || (link && (link = link.trim()));

			if (reference) {
				let href, title;
				// debugging && console.log(m, {text, link, alias, reference, index});
				if (link) {
					[, href = '#', title] = NormalizableLink.exec(link);
				} else if (alias && alias in aliases) {
					({href = '#', title} = aliases[alias]);
				}
				debugging && console.log(m, {href, title, text, link, alias, reference, index});
				if (m[0] === '!') {
					return ` <img src="${href}"${text || title ? ` title="${text || title}"` : ''} /> `;
				} else {
					text = text || encodeEntities(href);
					return ` <a href="${href}"${title ? ` title="${title}"` : ''}>${text || reference}</a>`;
				}
			}
			return m;
		});
	}

	normalizeBlockquotes(sourceText) {
		// TODO: Normalize block quotes
		return sourceText;
	}

	/**
	 * @param {string} sourceText
	 */
	normalizeLists(sourceText) {
		return sourceText.replace(NormalizableLists, (m, feed, body) => {
			let match, indent;
			indent = feed.slice(1);
			let top = new ComposableList();
			let list = top;
			const lists = [top];
			NormalizableListItem.lastIndex = 0;
			while ((match = NormalizableListItem.exec(m))) {
				let [, matchedInset, matchedMarker, matchedLine] = match;
				let like;
				if (!matchedLine.trim()) continue;

				if (matchedMarker) {
					let depth = matchedInset.length;
					if (depth > list.listDepth) {
						const parent = list;
						list.push((list = new ComposableList()));
						list.parent = parent;
					} else if (depth < list.listDepth) {
						while ((list = list.parent) && depth < list.listDepth);
					} else if (
						'listStyle' in list &&
						!(like = ComposableList.markerIsLike(matchedMarker, list.listStyle))
						// ((like = ComposableList.markerIsLike(marker, list.listStyle)) === undefined
						// 	? (like = ComposableList.markerIsLike(marker, list.listType))
						// 	: like)
					) {
						const parent = list.parent;
						((list = new ComposableList()).parent = parent) ? parent.push(list) : lists.push((top = list));
					}

					if (!list) break;

					'listInset' in list ||
						((list.listInset = matchedInset),
						(list.listDepth = depth),
						(list.listType = matchedMarker === '* ' || matchedMarker === '- ' ? 'ul' : 'ol') === 'ol' &&
							(list.listStart = matchedMarker.replace(/\W/g, '')));

					'listStyle' in list ||
						(list.listStyle =
							(list.listType === 'ul' && ((matchedMarker === '* ' && 'disc') || 'square')) ||
							ComposableList.orderedStyleOf(matchedMarker));

					matchedLine = matchedLine.replace(/[ \t]*\n[> \t]*/g, ' ');
					list.push(matchedLine);
				} else {
					if (list.length) {
						const index = list.length - 1;
						list[index] += `<p>${matchedLine}</p>`;
					} else {
						list.push(new String(m));
					}
				}
			}

			return lists.map(list => list.toString(indent)).join('\n');
		});
	}

	/**
	 * @param {string} sourceText
	 */
	normalizeParagraphs(sourceText) {
		return (
			sourceText
				// .replace(MalformedParagraphs, (m, a, b, c, index, sourceText) => {
				// 	// console.log('normalizeParagraphs:\n\t%o%o\u23CE%o [%o]', a, b, c, index);
				// 	return `${a}${b}${(MERGED_MARKING && '\u{23CE}') || ''} `;
				// })
				.replace(NormalizableParagraphs, (m, feed, inset, body) => {
					const paragraphs = body
						.trim()
						.split(/^(?:[> \t]*\n)+[> \t]*/m)
						.filter(Boolean);
					import.meta['debug:markout:paragraph-normalization'] &&
						console.log('normalizeParagraphs:', {m, feed, inset, body, paragraphs});

					// return `${feed}<p>${paragraphs.join(`</p>${feed}<p>${feed}`)}</p>`;
					return `${feed}<p>${paragraphs.join(`</p>\n${inset}<p>`)}</p>\n`;
				})
		);
	}

	normalizeBreaks(sourceText) {
		return sourceText.replace(RewritableParagraphs, (m, a, b, c, index, sourceText) => {
			import.meta['debug:markout:break-normalization'] &&
				console.log('normalizeBreaks:\n\t%o%o\u23CE%o [%o]', a, b, c, index);
			return `${a}${b}${MERGED_MARKING ? '<tt class="normalized-break"> \u{035C}</tt>' : ' '}`;
		});
	}
}

// 'listStyle' in list ||
// 	(list.listStyle =
// 		(list.listType === 'ul' && ((marker[0] === '*' && 'disc') || 'square')) ||
// 		(marker[0] === '0' && 'decimal-leading-zero') ||
// 		(marker[0] > 0 && 'decimal') ||
// 		`${marker === marker.toLowerCase() ? 'lower' : 'upper'}-${
// 			/^[ivx]+\. $/i.test(marker) ? 'roman' : 'latin'
// 		}`);

class Segmenter extends RegExp {
	/**
	 * @param {string | RegExp} pattern
	 * @param {string} [flags]
	 * @param {(string|undefined)[]} [types]
	 */
	constructor(pattern, flags, types) {
		(pattern &&
			pattern.types &&
			Symbol.iterator in pattern.types &&
			((!types && (types = pattern.types)) || types === pattern.types)) ||
			Object.freeze((types = (types && Symbol.iterator in types && [...types]) || []));
		const {LOOKAHEAD = Segmenter.LOOKAHEAD, INSET = Segmenter.INSET, UNKNOWN = Segmenter.UNKNOWN} = new.target;
		Object.defineProperties(super(pattern, flags), {
			types: {value: types, enumerable: true},
			LOOKAHEAD: {value: LOOKAHEAD},
			INSET: {value: INSET},
			UNKNOWN: {value: UNKNOWN},
			// lookaheads: {value: (typeof LOOKAHEAD === 'symbol' && types.indexOf(LOOKAHEAD) + 1) || false},
			// insets: {value: (typeof insets === 'symbol' && types.indexOf(INSET) + 1) || false},
		});
	}

	/**
	 * @param {RegExpExecArray} match
	 */
	matchType(text, index) {
		return index > 0 && text !== undefined && match.types[index - 1] != null;
	}

	capture(text, index, match) {
		// let typeOf;
		if (index === 0 || text === undefined) return;

		const typeIndex = index - 1;
		const type = this.types[typeIndex];

		if (type === INSET) {
			match.inset = text;
			return;
		} else if (type === LOOKAHEAD) {
			match.lookahead = text;
			return;
		} else if (type !== UNKNOWN) {
			switch (typeof type) {
				case 'string':
					if (match.typeIndex > -1) return;
					match.type = type;
					match.typeIndex = typeIndex;
				case 'symbol':
					match[type] = text;
					return;
				case 'function':
					type(text, index, match);
					return;
			}
		}
	}

	/**
	 * @param {RegExpExecArray} match
	 * @returns {typeof match & {slot: number, type: string}}
	 */
	exec(source) {
		const match = super.exec(source);
		match &&
			((match.typeIndex = -1),
			match.forEach(this.capture || Segmenter.prototype.capture, this),
			match.typeIndex > -1 || ((match.type = 'unknown'), (match.typeIndex = -1)),
			null);

		return match;
  }

	static define(factory, flags) {
		const types = [];
		const RegExp = (this && (this.prototype === Segmenter || this.prototype instanceof Segmenter) && this) || Segmenter;
    const pattern = factory(type => (types.push((type != null || undefined) && type), ''));

    flags = `${(flags == null ? pattern && pattern.flags : flags) || ''}`;

		return new RegExp(pattern, flags, types);
	}
}

const {INSET, UNKNOWN, LOOKAHEAD} = Object.defineProperties(Segmenter, {
	INSET: {value: Symbol.for('INSET'), enumerable: true},
	UNKNOWN: {value: Symbol.for('UNKNOWN'), enumerable: true},
	LOOKAHEAD: {value: Symbol.for('LOOKAHEAD'), enumerable: true},
});

// import dynamicImport from '/browser/dynamicImport.js';

// console.log(import.meta.url);

globalThis.$mo = async function debug(specifier = '/markout/examples/markdown-testsuite.md') {
	// const {MarkoutSegments} = await import(`/markout/lib/experimental/markout-segmenter.js${timestamp}`);
	const url = new URL(specifier, location);
	const response = await fetch(url);
	if (!response.ok) console.warn(Error(`Failed to fetch ${url}`));
	const sourceText = await response.text();
	// console.log(dynamicImport);
	// const {debugSegmenter} = await dynamicImport('/modules/segmenter/segmenter.debug.js');
	const {debugSegmenter} = await (0, eval)('specifier => import(specifier)')('/modules/segmenter/segmenter.debug.js');
	debugSegmenter(MarkoutSegments, sourceText);
};

const MarkoutSegments = (() => {
	const MarkoutLists = sequence`[-*]|[1-9]+\d*\.|[ivx]+\.|[a-z]\.`;
	const MarkoutMatter = sequence`---(?=\n.+)(?:\n.*)+?\n---`;
	const MarkoutStub = sequence`<!--[^]*?-->|<!.*?>|<\?.*?\?>|<%.*?%>|<(?:\b|\/).*(?:\b|\/)>.*`;
	const MarkoutStart = sequence`(?!(?:${MarkoutLists}) )(?:[^#${'`'}~<>|\n\s]|${'`'}{1,2}(?!${'`'})|~{1, 2}(?!~))`;
	const MarkoutLine = sequence`(?:${MarkoutStart})(?:${MarkoutStub}|.*)*$`;
	// const MarkoutDivider = sequence`-(?:[ \t]*-)+|=(?:=[ \t]*)+`;
	const MarkoutDivider = sequence`-{2,}|={2,}|\*{2,}|(?:- ){2,}-|(?:= ){2,}=|(?:\* ){2,}\*`;
	const MarkoutATXHeading = sequence`#{1,6}(?= +${MarkoutLine})`;
	const MarkoutTextHeading = sequence`${MarkoutStart}.*\n(?=\2\={3,}\n|\2\-{3,}\n)`;

	const MarkoutSegments = Segmenter.define(
		type =>
			sequence`^
		  (?:
		    ${type(UNKNOWN)}(${MarkoutMatter}$|[ \t]*(?:${MarkoutStub})[ \t]*$)|
		    (?:
		      ${type(INSET)}((?:  |\t)*?(?:> ?)*?(?:> ?| *))
		      (?:
		        ${type('fence')}(?:(${'```'}|~~~)(?=.*\n)[^]*?\n\2\3.*$)|
		        ${type('table')}(?:([|](?=[ :-]).+[|]$)(?:\n\2[|].+[|]$)+)|
		        ${type('heading')}(?:(${MarkoutATXHeading}|${MarkoutTextHeading}).*$)|
		        ${type('list')}(?:(${MarkoutLists}) +${MarkoutLine}(?:\n\2 {2,4}${MarkoutLine})*$)|
		        ${type('alias')}(?:(\[.+?\]: .+)$)|
		        ${type('divider')}(?:(${MarkoutDivider})$)|
		        ${type('feed')}(?:([ \t]*(?:\n\2[ \t])*)$)|
		        ${type('paragraph')}(?:(${MarkoutLine}(?:\n\2 {0,2}${MarkoutLine})*)$)
		      )|
		      ${type(UNKNOWN)}(.+?$)
		    )
		  )(?=${type(LOOKAHEAD)}(\n?^.*$)?)
		`,
		'gmi',
	);
	return MarkoutSegments;
})();

const ALIASES$1 = 'aliases';

class MarkoutSegmentNormalizer extends MarkoutBlockNormalizer {
	/**
	 * @param {string} sourceText
	 * @param {{ aliases?: { [name: string]: alias } }} [state]
	 */
	normalizeSegments(sourceText, state = {}) {
		const {sources = (state.sources = []), [ALIASES$1]: aliases = (state[ALIASES$1] = {})} = state;

		// for (const segment of matchAll(sourceText, MarkoutSegments)) {}

		try {
			state.segments = [...matchAll(sourceText, MarkoutSegments)];

			return this.normalizeBlocks(sourceText, state);
		} finally {
			import.meta['debug:markout:segment-normalization'] && console.log('normalizeSegments:', state);
		}

		Normalization: {
			// const {[BLOCKS]: sourceBlocks} = source;
			// for (const {text, fence, unfenced} of sourceBlocks[MATCHES]) {
			// 	sourceBlocks.push(
			// 		fence
			// 			? text
			// 			: this.normalizeParagraphs(
			// 					this.normalizeBreaks(this.normalizeLists(this.normalizeReferences(text, state))),
			// 			  ),
			// 	);
			// }
			// source.normalizedText = sourceBlocks.join('\n');
			import.meta['debug:markout:block-normalization'] && console.log('normalizeSourceText:', state);
		}

		// return source.normalizedText;
	}
}

debugging('markout', import.meta, [
	// import.meta.url.includes('/markout/lib/') ||
	typeof location === 'object' && /[?&]debug(?=[&#]|=[^&]*\bmarkout|$)\b/.test(location.search),
	'segment-normalization',
	'block-normalization',
	'paragraph-normalization',
	'anchor-normalization',
	'break-normalization',
]);

class MarkoutNormalizer extends MarkoutSegmentNormalizer {
	normalizeSourceText(sourceText) {
		const {normalized = (this.normalized = new Map())} = this;
		let normalizedText = normalized.get(sourceText);
		normalizedText !== undefined ||
			normalized.set(
				sourceText,
				(normalizedText = normalizeString(this.normalizeSegments(normalizeString(sourceText)))),
			);
		return normalizedText;
	}
}

const SourceTypeAttribute = 'source-type';
const MarkupModeAttribute = 'markup-mode';
const MarkupSyntaxAttribute = 'markup-syntax';

const {
	// Attempts to overcome **__**
	'markout-render-span-restacking': SPAN_RESTACKING = true,
	'markout-render-newline-consolidation': NEWLINE_CONSOLIDATION = false,
} = import.meta;

const normalize = sourceText => {
	const {normalizer = (normalize.normalizer = new MarkoutNormalizer())} = normalize;
	return normalizer.normalizeSourceText(sourceText);
};

const render = tokens => {
	const {
		punctuators = (render.punctuators = createPunctuators()),
		renderer = (render.renderer = new MarkoutRenderer({punctuators})),
	} = render;
	return renderer.renderTokens(tokens);
};

const tokenize = sourceText => tokenize$1(`${sourceText.trim()}\n}`, {sourceType: 'markdown'});

const FencedBlockHeader = /^(?:(\w+)(?:\s+(.*?)\s*|)$|)/m;

class MarkoutRenderingContext {
	constructor(renderer) {
		({punctuators: this.punctuators} = this.renderer = renderer);

		[
			this.passthru,
			this.block,
			this.fenced,
			this.header,
			this.indent,
			this.newlines,
			this.comment,
		] = this.renderedText = '';

		SPAN_RESTACKING && createSpanStack(this);
	}
}

class MarkoutRenderer {
	constructor({punctuators = createPunctuators()} = {}) {
		this.punctuators = punctuators;
	}
	renderTokens(tokens, context = new MarkoutRenderingContext(this)) {
		let text, type, punctuator, lineBreaks, hint, previous, body, tag, classes, before, after, details;
		context.tokens = tokens;

		const {punctuators} = context;
		const {renderClasses} = this;

		for (const token of context.tokens) {
			if (!token || !(body = token.text)) continue;
			({text, type = 'text', punctuator, lineBreaks, hint = 'text', previous} = token);
			tag = classes = before = after = details = undefined;

			if (context.passthru || context.fenced) {
				if (context.fenced) {
					if (context.fenced === context.passthru) {
						context.header += text;
						lineBreaks && ((context.header = context.header.trimRight()), (context.passthru = ''));
					} else if (punctuator === 'closer' && text === '```') {
						let sourceType, sourceAttributes;
						if (context.header) {
							[, sourceType = 'markup', sourceAttributes] = FencedBlockHeader.exec(context.header);
							import.meta['debug:fenced-block-header-rendering'] &&
								console.log('fenced-block-header', {
									fenced: context.fenced,
									header: context.header,
									passthru: context.passthru,
									sourceType,
									sourceAttributes,
									context,
								});
						}
						// passthru rendered code
						context.renderedText += `<${context.block} class="markup code" ${SourceTypeAttribute}="${sourceType ||
							'markup'}"${
							// sourceParameters ? ` ${SourceParameters}="${sourceParameters}"` : ''
							(sourceAttributes && ` ${sourceAttributes}`) || ''
						}>${encodeEntities(context.passthru)}</${context.block}>`;
						context.header = context.indent = context.fenced = context.passthru = '';
					} else {
						// passthru code
						context.passthru += body.replace(context.indent, '');
					}
					// continue;
				} else {
					// passthru body
					context.passthru += body;
					if (punctuator === 'closer' || (context.comment && punctuator === 'comment')) {
						// passthru body rendered
						context.renderedText += context.passthru;
						context.passthru = '';
					}
				}
				continue;
			}

			tag = 'span';
			classes = hint.split(/\s+/);

			if (hint === 'markdown' || hint.startsWith('markdown ') || hint.includes('in-markdown')) {
				(type === 'text' && lineBreaks) ||
					(!text.trim() && (type = 'whitespace')) ||
					(text in punctuators.entities && (body = punctuators.entities[text]));

				if (punctuator) {
					context.passthru =
						(((context.comment = punctuator === 'comment' && text) || punctuators.tags.has(text)) && text) || '';
					if (context.passthru) continue;
					// SPAN_RESTACKING && punctuator === 'opener' && context.stack[text] >= 0 && (punctuator = 'closer');
					if (punctuator === 'opener') {
						if ((context.fenced = text === '```' && text)) {
							context.block = 'pre';
							context.passthru = context.fenced;
							[context.indent = ''] = /^[ \t]*/gm.exec(previous.text);
							context.indent && (context.indent = new RegExp(String.raw`^${context.indent}`, 'mg'));
							context.header = '';
							// punctuator opener fence
							continue;
						} else if (text in punctuators.spans) {
							if (SPAN_RESTACKING && (before = context.stack.open(text, body, classes)) === undefined) continue;
							before || ((before = `<${punctuators.spans[text]}${renderClasses(classes)}>`), classes.push('opener'));
						} else if (text === '<!' || text === '<%') {
							// Likely <!doctype …> || Processing instruction
							let next;
							while (
								(next = context.tokens.next().value) &&
								(body += next.text) &&
								!(
									(next.punctuator === 'opener' && /^</.test(next.text)) ||
									(next.punctuator === 'closer' && />$/.test(next.text))
								)
							);
							context.passthru = body;
							continue;
						}
					} else if (punctuator === 'closer') {
						if (text === '```') {
							context.block = punctuators.blocks['```'] || 'pre';
						} else if (text in punctuators.spans) {
							if (SPAN_RESTACKING && (after = context.stack.close(text, body, classes)) === undefined) continue;
							after || ((after = `</${punctuators.spans[text]}>`), classes.push('closer'));
						}
					}
					(before || after) && (tag = 'tt');
					classes.push(`${punctuator}-token`);
				} else {
					if (lineBreaks) {
						(!context.block && (tag = 'br')) || ((after = `</${context.block}>`) && (context.block = body = ''));
					} else if (type === 'sequence') {
						if (text[0] === '`') {
							tag = 'code';
							body = text.replace(/(``?)(.*)\1/, '$2');
							let fence = '`'.repeat((text.length - body.length) / 2);
							body = encodeEntities(body.replace(/&nbsp;/g, '\u202F'));
							fence in punctuators.entities && (fence = punctuators.entities[fence]);
							classes.push('fenced-code');
							classes.push('code');
						} else if (text.startsWith('---') && !/[^\-]/.test(text)) {
							tag = 'hr';
						} else if (!context.block && (context.block = punctuators.blocks[text])) {
							let previous = token;
							let inset = '';
							while ((previous = previous.previous)) {
								if (previous.lineBreaks) break;
								inset = `${previous.text}${inset}`;
							}
							if (!/[^> \t]/.test(inset)) {
								before = `<${context.block}${renderClasses(classes)}>`;
								tag = 'tt';
								classes.push('opener', `${type}-token`);
							} else {
								body = text;
							}
						} else {
							// sequence
							body = text;
						}
					} else if (type === 'whitespace') {
						// if (span === 'code') body.replace(/\xA0/g, '&nbsp;');
						tag = '';
					} else {
						// debug(`${type}:token`)(type, token);
						classes.push(`${type}-token`);
						body = text;
					}
				}
			}

			details =
				tag &&
				[
					punctuator && `punctuator="${punctuator}"`,
					type && `token-type="${type}"`,
					hint && `token-hint="${hint}"`,
					lineBreaks && `line-breaks="${lineBreaks}"`,
				].join(' ');

			before && (context.renderedText += before);
			tag === 'br' || (context.newlines = 0)
				? (!NEWLINE_CONSOLIDATION && (context.renderedText += '\n')) ||
				  (context.newlines++ && (context.renderedText += '\n')) ||
				  (context.renderedText += '<br/>')
				: tag === 'hr'
				? (context.renderedText += '<hr/>')
				: body &&
				  (tag
						? (context.renderedText += `<${tag} ${details}${renderClasses(classes)}>${body}</${tag}>`)
						: (context.renderedText += body));
			after && (context.renderedText += after);
		}

		return context.renderedText;
		// return (context.output = new MarkoutOutput(context));
	}

	renderClasses(classes) {
		return ((classes = [...classes].filter(Boolean).join(' ')) && ` class="${classes}"`) || '';
	}
}

// render.classes = classes => ((classes = classes.filter(Boolean).join(' ')) && ` class="${classes}"`) || '';

/// Features

const createPunctuators = (
	repeats = {['*']: 2, ['`']: 3, ['#']: 6},
	entities = {['*']: '&#x2217;', ['`']: '&#x0300;'},
	aliases = {'*': ['_'], '**': ['__'], '`': ['``']},
	blocks = {['-']: 'li', ['>']: 'blockquote', ['#']: 'h*', ['```']: 'pre'},
	spans = {['*']: 'i', ['**']: 'b', ['~~']: 's', ['`']: 'code'},
	tags = ['<', '>', '<!--', '-->', '<%', '%>', '</', '/>'],
) => {
	const symbols = new Set([...Object.keys(repeats), ...Object.keys(entities)]);
	for (const symbol of symbols) {
		let n = repeats[symbol] || 1;
		const entity = entities[symbol];
		let block = blocks[symbol];
		let span = spans[symbol];
		const tag = block || span;
		const map = (block && blocks) || (span && spans);
		for (let i = 1; n--; i++) {
			const k = symbol.repeat(i);
			const b = blocks[k];
			const s = spans[k];
			const m = (b && blocks) || (s && spans) || map;
			const t = (b || s || m[k] || tag).replace('*', i);
			const e = entities[k] || (entity && entity.repeat(i));
			m[k] = t;
			e && (entities[k] = e);
			if (k in aliases) for (const a of aliases[k]) (m[a] = t), e && (entities[a] = e);
		}
	}
	for (let h = 1, c = 2080, n = 6; n--; entities['#'.repeat(h)] = `#<sup>&#x${c + h++};</sup>`);

	return {entities, blocks, spans, tags: new Set(tags)};
};

const createSpanStack = context => {
	const {
		punctuators: {spans},
		renderer,
	} = context;
	const stack = [];
	stack.open = (text, body, classes) => {
		const {[text]: lastIndex, length: index} = stack;
		if (lastIndex < 0) return (stack[text] = undefined); // ie continue
		if (lastIndex >= 0) return stack.close(text, body, classes);
		const span = spans[text];
		const before = `<${span}${renderer.renderClasses(classes)}>`;
		stack[text] = index;
		stack.push({text, body, span, index});
		return classes.push('opener'), before;
	};
	stack.close = (text, body, classes) => {
		const span = spans[text];
		const {[text]: index, length} = stack;
		if (index === length - 1) {
			index >= 0 && (stack.pop(), (stack[text] = undefined));
			const after = `</${span}>`;
			return classes.push('closer'), after;
		} else if (index >= 0) {
			classes.push('closer', `closer-token`);
			const details = `token-type="auto"${renderer.renderClasses(classes)}`;
			const closing = stack.splice(index, length).reverse();
			for (const {span, text, body} of closing) {
				context.renderedText += `<tt punctuator="closer" ${details}>${body}</tt></${span}>`;
				stack[text] < index || (stack[text] = -1);
			}
		} else {
			context.renderedText += text;
		}
	};
	context.stack = stack;
};

debugging('markout', import.meta, [
	// import.meta.url.includes('/markout/lib/') ||
	typeof location === 'object' && /[?&]debug(?=[&#]|=[^&]*\bmarkout|$)\b/.test(location.search),
	'block-normalization',
	'paragraph-normalization',
	'anchor-normalization',
	'break-normalization',
	'fenced-block-header-rendering',
]);

export { render as a, tokenize as b, normalize as c, SourceTypeAttribute as d, MarkupModeAttribute as e, MarkupSyntaxAttribute as f };
//# sourceMappingURL=common.js.map