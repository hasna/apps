/** Families we can mask. Anything else is returned untouched. */
export type CommentSyntax = "c-like" | "hash" | "none";
/**
 * Which comment syntax a path uses.
 *
 * Two families are deliberately "none", and both are load-bearing:
 *
 * `.json` — JSON has no comments and JSONC does. Guessing wrong would hide a
 * reference in the one format that actually carries dependency edges.
 *
 * `.jsx`/`.tsx` — JSX text is not lexable without a real parser, and guessing
 * costs a FALSE NEGATIVE rather than a false positive. `<code>src/*</code>`
 * opens what looks like a block comment, which then runs to the next `*&#47;`
 * anywhere in the file and masks every import in between. A bare URL in a text
 * node does the same to one line. So JSX is scanned exactly as it was before
 * comment masking existed: noisier, never blind.
 */
export declare function commentSyntaxForPath(path: string): CommentSyntax;
/**
 * A span of the source that is not code: a comment, or a string/template
 * literal.
 *
 * The masker needs the comments. The guard-test mention audit needs the
 * literals and the bracket they sit inside, which is why one lexer produces
 * both rather than two state machines drifting apart.
 */
export interface SourceToken {
    kind: "comment" | "literal";
    start: number;
    /** Exclusive. */
    end: number;
    /**
     * Callees of every unclosed call this token sits inside, innermost last.
     * `null` entries are groupings and control heads, which call nothing.
     */
    callees?: ReadonlyArray<string | null>;
    /** A template chunk that RESUMES after `${…}`, so its own text is spliced with computed values. */
    interpolated?: true;
}
/**
 * The text with comments replaced by spaces, same length, same line numbers.
 *
 * Fails open to the original text: an unparseable file is scanned exactly as
 * it was before this module existed.
 */
export declare function maskComments(text: string, syntax: CommentSyntax): string;
/** Convenience: mask by file path. */
export declare function maskCommentsForPath(text: string, path: string): string;
/**
 * Can this source only MENTION `moduleName`, never load it?
 *
 * Answers the one question the guard-test exemption rests on. The exemption
 * exists because the mandated guard test must name the retired runtime in order
 * to assert its absence; it must not become a way to load it. So every literal
 * occurrence has to sit somewhere that provably cannot resolve a specifier:
 * bound to a variable, an element of an array, a property value, or an argument
 * to one of `INERT_CALLEES`.
 *
 * Fails CLOSED — `false` — on anything it cannot read: a JSX file, a lexer that
 * lost the thread, an interpolated template chunk, an occurrence outside every
 * literal. A false positive costs a repo one line; a false negative costs the
 * gate its meaning.
 */
export declare function mentionsCannotLoad(text: string, path: string, moduleName: string): boolean;
/**
 * A constant data structure spelled out in source: a literal array, a literal
 * record, or a string.
 *
 * WHY THIS EXISTS. A bundler that inlines a dependency copies that
 * dependency's constants into the consumer's output verbatim. The consumer did
 * not write them and cannot delete them. Deciding what to do about that needs
 * the STRUCTURE the names sit in, because that is the only place the answer
 * lives: a filename cannot tell a copied constant from a hand-written one, and
 * the presence or absence of import specifiers elsewhere in the file cannot
 * either — a bundle that inlines `package.json` carries a whole `dependencies`
 * map with no specifier anywhere near it.
 *
 * Deliberately NOT a JS parser. It reads one shape only: collections whose
 * leaves are all string literals. That shape can hold data and nothing else —
 * no call, no identifier, no computed member, no template with a substitution.
 * Anything else makes the parse fail, and a failed parse yields no region, so
 * the caller learns nothing and scans the text as it stands.
 */
export type InlineDataNode = {
    kind: "string";
    value: string;
    start: number;
    end: number;
} | {
    kind: "array";
    items: readonly InlineDataNode[];
    start: number;
    end: number;
} | {
    kind: "record";
    entries: ReadonlyMap<string, InlineDataNode>;
    start: number;
    end: number;
};
/** An outermost inert collection, with the name it is bound to if it has one. */
export interface InlineDataRegion {
    root: InlineDataNode;
    /**
     * The identifier this collection is assigned to — `RUNTIME_PATTERNS` in
     * `var RUNTIME_PATTERNS = [...]`. `null` when the collection is not assigned
     * to anything, which is also the answer when we could not read a name.
     */
    boundName: string | null;
    start: number;
    end: number;
}
/**
 * The outermost inert collections that contain any of `needles`.
 *
 * Driven from the occurrences rather than from every bracket in the file. A
 * file that names none of them costs one substring search per needle and
 * nothing else; a file that names one adds a single O(text) lex, which is what
 * tells a stored constant from a call ARGUMENT. Everything after that is
 * proportional to how many times the caller's names appear — a handful — and
 * not to the size of a bundle.
 *
 * OUTERMOST matters for `boundName`: the record `{ pattern: "…" }` is an
 * element of `RUNTIME_PATTERNS`, and it is the array that carries the name a
 * later `require(NAME[0])` would have to use.
 */
export declare function inlineDataRegions(text: string, needles: readonly string[]): InlineDataRegion[];
/** Every node in a region, outermost first. */
export declare function inlineDataNodes(node: InlineDataNode): InlineDataNode[];
/**
 * Does a load call in this text mention `name`?
 *
 * The companion to `isInertPosition`: that one refuses to explain away a
 * collection something reads a member out of ON THE SPOT, and this one refuses
 * when the collection was stored under a name and a load call names it —
 * `var X = [...]; __require(X[0]);`.
 *
 * Bounded to the argument list, because a load call is the only place a
 * specifier can arrive.
 */
export declare function loadCallMentions(text: string, name: string): boolean;
/**
 * A span whose BYTES have been read and found to be one quoted constant.
 *
 * `constant` is not decoration — it is the claim the span carries, and
 * `blankConstantSpans` re-checks it against the text before suppressing
 * anything. So a span cannot be moved, widened, or synthesised somewhere else
 * and still be blanked: it has to keep saying what it is, and be it.
 *
 * `quotedConstantSpan` is the only function that produces one. The TYPE is part of
 * the mechanism, but it is worth being exact about how much it buys, because the
 * first wording of this comment overstated it and a review measured the gap.
 *
 * WHAT IT DOES BUY: a plain `{start, end}` is not assignable here, so `tsc`
 * rejects the specific edit that reverted this rule four times in a row —
 * pushing the ENCLOSING node's span into the span list. That edit now needs an
 * explicit cast, which is greppable.
 *
 * WHAT IT DOES NOT BUY, measured: widening the span array's own annotation back
 * to `Array<{start: number; end: number}>` and calling an unchecked blanker
 * restores the vulnerability with ZERO casts and `tsc` green. So the type is a
 * guardrail against the obvious edit, NOT a proof. What actually catches a
 * determined revert is `blankConstantSpans`'s runtime re-check, the duplicate-key
 * forges, and the mutation audit. `blankSpans` is un-exported so that route needs
 * a visible re-export rather than a one-word annotation change.
 */
export interface ConstantSpan {
    readonly start: number;
    readonly end: number;
    /** The constant these bytes were compared against, quotes excluded. */
    readonly constant: string;
}
/**
 * The span of `node`, IF the bytes it covers are exactly one quoted `expected`.
 *
 * THIS IS THE WHOLE RULE, AND IT IS A BYTE COMPARISON ON PURPOSE.
 *
 * Four evasions reached a copy of this repo's own denylist through one gap:
 * every one of them was caught, or not caught, by a check that read a PARSED
 * structure while the caller suppressed RAW BYTES. The parse is lossy — most
 * recently and most cheaply, `parseInlineData` stores a record's entries in a
 * `Map`, so a duplicate key collapses last-wins and the shadowed value is a
 * region of text nothing ever looked at. Repeating one key was the entire cost
 * of getting a credential through a blanked span.
 *
 * So the comparison and the action are now on the SAME representation. What is
 * compared is `text.slice(node.start, node.end)`; what gets blanked is
 * `node.start .. node.end`. There is no third thing in between for a shape to
 * hide in.
 *
 * WHY THIS DELETES CHECKS INSTEAD OF ADDING ONE, which is the reason to believe
 * it is not another narrowing. Three separately-tested rules are strictly
 * implied by this single line and were removed with it:
 *
 *   - "the value must be a plain string, not a nested collection" — a record's
 *     span opens with `{` and an array's with `[`, so neither can equal
 *     `quote + expected + quote`;
 *   - "the value must equal the row's value" — that IS this comparison, on the
 *     stricter representation;
 *   - "the value's kind must be `string`" — subsumed by the opening quote.
 *
 * WHAT IT NEWLY REFUSES, and the refusal is deliberate: a literal that needs an
 * escape to spell the constant. `"a\"b"` decodes to `a"b`, so the old check
 * would call it equal — while the span it authorises is two bytes longer than
 * the thing that was compared. No pattern in the table contains a quote or a
 * backslash today, so this costs nothing measurable; it is here so that the
 * guarantee does not quietly depend on that staying true. A row that one day
 * needs an escape simply stops being attributed, which is the noisy direction.
 */
export declare function quotedConstantSpan(text: string, node: InlineDataNode | undefined, expected: string): ConstantSpan | null;
/**
 * Blank verified spans, re-checking each one's claim against the text first.
 *
 * The check is not belt-and-braces on `quotedConstantSpan`; it is what makes a
 * WRONG span observable instead of silent. A caller that casts its way past
 * `ConstantSpan` — or that computes an offset from one text and blanks it in
 * another — trips this, and it trips as a thrown error in the scanner's own
 * test suite rather than as a quietly clean scan of somebody's artifact.
 *
 * It throws rather than dropping the span, because a span that does not match
 * its own claim is a bug in this file, not something an input can cause. Every
 * shape an INPUT can produce is answered by returning `null` above.
 */
export declare function blankConstantSpans(text: string, spans: readonly ConstantSpan[]): string;
/**
 * Does this text import the module — in any of the four forms that create an
 * edge — including deep imports like `@hasna/cloud/dist/adapter.js`?
 *
 * `from "x"` covers both `import ... from` and `export ... from`. The
 * whitespace after a bare `import` is optional because `import"x/register";`
 * is the same side-effect import with the space deleted.
 */
export declare function importsModule(maskedText: string, moduleName: string): boolean;
/**
 * Local names bound by importing `moduleName`.
 *
 * This is what separates a fleet package's own `registerCloudTools` — defined
 * in its own `src/mcp/cloud-tools.ts` and routed at its own service — from the
 * retired shared runtime's export of the same name. A bare identifier says
 * nothing about where it came from; the import statement says everything.
 */
export declare function importedBindings(maskedText: string, moduleName: string): Set<string>;
