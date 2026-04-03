
/*
 * publication-transforms.ts
 *
 * Registry of named HTML post-processing transforms for the publication pipeline.
 * DOM transforms operate on a live HTMLElement before serialization.
 * String transforms operate on the serialized HTML string afterward.
 *
 * These transforms replace the Ogen/Opub Alfred scripts.
 */

import { TransformId } from './global';

export type DOMTransform = (body: HTMLElement) => void;
export type StringTransform = (html: string) => string;

export interface TransformDefinition {
    id: TransformId;
    label: string;
    description: string;
    phase: 'dom' | 'string';
    domFn?: DOMTransform;
    stringFn?: StringTransform;
}

// ── DOM transforms ────────────────────────────────────────────────────────────

function removeDirAuto(body: HTMLElement): void {
    body.querySelectorAll('[dir="auto"]').forEach(el => el.removeAttribute('dir'));
}

function stripExternalLinkAttributes(body: HTMLElement): void {
    body.querySelectorAll('a').forEach(a => {
        // Strip rel="noopener nofollow" class="...-link" target="_blank" pattern
        // and the second variant: target="_blank" rel="noopener-nofollow"
        a.removeAttribute('rel');
        a.removeAttribute('target');
        // Remove classes ending in -link that Obsidian adds to external links
        if (a.className) {
            const classes = a.className.split(' ').filter(c => !c.endsWith('-link'));
            if (classes.length === 0) {
                a.removeAttribute('class');
            } else {
                a.className = classes.join(' ');
            }
        }
    });
}

function stripAdmonitionSVGIcons(body: HTMLElement): void {
    // Remove style attribute and SVG from admonition divs
    body.querySelectorAll('div[class*="admonition"]').forEach(div => {
        div.removeAttribute('style');
        div.querySelectorAll('svg').forEach(svg => svg.remove());
    });
}

function normalizeCodeBlockClasses(body: HTMLElement): void {
    body.querySelectorAll('pre').forEach(pre => {
        // Strip leading space from class: " language-X" → "language-X"
        if (pre.className) {
            pre.className = pre.className.trim();
        }
        pre.removeAttribute('tabindex');
        // Fix the inner code element: remove "is-loaded" suffix
        const code = pre.querySelector('code');
        if (code && code.className) {
            code.className = code.className.replace(/\s+is-loaded$/, '').trim();
        }
    });
}

function stripSyntaxHighlightSpans(body: HTMLElement): void {
    // Replace all token spans inside pre>code with their text content
    body.querySelectorAll('pre code').forEach(codeEl => {
        // Repeatedly unwrap token spans until none remain (handles nesting)
        let found = true;
        while (found) {
            found = false;
            codeEl.querySelectorAll('span[class*="token"]').forEach(span => {
                const text = document.createTextNode(span.textContent || '');
                span.parentNode?.replaceChild(text, span);
                found = true;
            });
        }
        // Also remove any remaining bare <span> tags left over (orphaned closing tags
        // don't appear in DOM, but handle any non-token spans that crept in)
        codeEl.querySelectorAll('span').forEach(span => {
            const text = document.createTextNode(span.textContent || '');
            span.parentNode?.replaceChild(text, span);
        });
    });
}

function removeCopyCodeButtons(body: HTMLElement): void {
    body.querySelectorAll('button.copy-code-button').forEach(btn => btn.remove());
}

function convertOrbitBlocks(body: HTMLElement): void {
    // Orbit flashcard blocks are rendered as:
    //   <pre class="language-orbit ..."><code class="language-orbit ...">
    //     &lt;script ...&gt;&lt;/script&gt;
    //     &lt;orbit-reviewarea color="..."&gt;
    //       &lt;orbit-prompt ...&gt;&lt;/orbit-prompt&gt;
    //     &lt;/orbit-reviewarea&gt;
    //   </code></pre>
    // We convert to proper HTML elements.
    body.querySelectorAll('pre').forEach(pre => {
        if (!pre.className.includes('language-orbit')) return;
        const code = pre.querySelector('code');
        if (!code) return;

        // textContent gives us the decoded text (entities already unescaped by DOM)
        const text = code.textContent || '';

        // Extract script src
        const scriptMatch = text.match(/<script\s+type="module"\s+src="([^"]+)"><\/script>/);
        // Extract orbit-reviewarea color and inner content
        const reviewareaMatch = text.match(/<orbit-reviewarea\s+color="([^"]+)">([\s\S]*?)<\/orbit-reviewarea>/);

        if (!reviewareaMatch) return;

        const fragment = document.createDocumentFragment();

        if (scriptMatch) {
            const script = document.createElement('script');
            script.type = 'module';
            script.src = scriptMatch[1];
            fragment.appendChild(script);
        }

        const reviewarea = document.createElement('orbit-reviewarea') as HTMLElement;
        reviewarea.setAttribute('color', reviewareaMatch[1]);
        // Inner content contains <orbit-prompt> tags — set as innerHTML
        reviewarea.innerHTML = reviewareaMatch[2];
        fragment.appendChild(reviewarea);

        pre.parentNode?.replaceChild(fragment, pre);
    });
}

function normalizeHeadingIds(body: HTMLElement): void {
    body.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
        const dataHeading = heading.getAttribute('data-heading');
        if (dataHeading !== null) {
            heading.id = dataHeading.replace(/ /g, '-');
            heading.removeAttribute('data-heading');
        }
    });
}

function convertObsidianAnchorLinks(body: HTMLElement): void {
    body.querySelectorAll('a[data-href]').forEach(a => {
        const dataHref = a.getAttribute('data-href') || '';
        if (dataHref.startsWith('#')) {
            a.setAttribute('href', '#' + dataHref.slice(1).replace(/ /g, '-'));
        }
        a.removeAttribute('data-href');
        // Remove any remaining Obsidian-specific link attributes
        a.removeAttribute('aria-label');
        a.removeAttribute('data-tooltip-position');
    });
}

function removeDoubledParagraphs(body: HTMLElement): void {
    // Transcludes sometimes produce <p>\n<p>text</p></p> — unwrap the inner p
    body.querySelectorAll('p > p').forEach(innerP => {
        const outerP = innerP.parentElement;
        if (!outerP) return;
        outerP.parentNode?.replaceChild(innerP, outerP);
    });
}

function removeAdmonitionStyles(body: HTMLElement): void {
    // Admonition plugins inject <style> elements; remove them
    body.querySelectorAll('div[class*="admonition"] style').forEach(s => s.remove());
    // Also catch bare <style> elements added at body level by admonition plugins
    body.querySelectorAll('style').forEach(s => s.remove());
}

function removeTooltipAttributes(body: HTMLElement): void {
    body.querySelectorAll('[data-tooltip-position]').forEach(el => el.removeAttribute('data-tooltip-position'));
}

function removeAriaLabels(body: HTMLElement): void {
    body.querySelectorAll('[aria-label]').forEach(el => el.removeAttribute('aria-label'));
}

function convertCollapsibleBlocks(body: HTMLElement): void {
    // Collapsible blocks are written as:
    //   <pre><code>collapsible "Title" h2 extra-attrs
    //   content
    //   end-collapsible</code></pre>
    // Convert to <details extra-attrs><summary><h2>Title</h2></summary>content</details>
    body.querySelectorAll('pre > code').forEach(code => {
        const text = code.textContent || '';
        const match = text.match(/^collapsible "(.*?)" h(\d+)(.*?)\n([\s\S]*?)\nend-collapsible$/);
        if (!match) return;
        const [, title, level, attrs, content] = match;
        const pre = code.parentElement as HTMLPreElement;

        const details = document.createElement('details');
        if (attrs.trim()) {
            // attrs is a space-separated list of attribute string fragments
            details.setAttribute('data-collapsible-attrs', attrs.trim());
        }
        const summary = document.createElement('summary');
        const heading = document.createElement(`h${level}`);
        heading.textContent = title;
        summary.appendChild(heading);
        details.appendChild(summary);

        // Inner content is HTML — create a temp div to parse it
        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = content;
        while (contentDiv.firstChild) {
            details.appendChild(contentDiv.firstChild);
        }

        pre.parentNode?.replaceChild(details, pre);
    });
}

function normalizeNbsp(body: HTMLElement): void {
    // The browser's innerHTML serializer inserts &nbsp; at boundaries between
    // inline elements and adjacent text (e.g. <a>text</a>&nbsp;follows or
    // <code>x</code>&nbsp;– note). Replace with regular spaces everywhere
    // except inside <pre> blocks, where whitespace is significant.
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text;
    while ((node = walker.nextNode() as Text)) {
        textNodes.push(node);
    }
    for (const textNode of textNodes) {
        // Skip text nodes inside <pre> elements
        let parent: Node | null = textNode.parentNode;
        let inPre = false;
        while (parent && parent !== body) {
            if ((parent as Element).tagName === 'PRE') { inPre = true; break; }
            parent = parent.parentNode;
        }
        if (!inPre && textNode.nodeValue?.includes('\u00a0')) {
            textNode.nodeValue = textNode.nodeValue.replace(/\u00a0/g, ' ');
        }
    }
}

// ── String transforms ─────────────────────────────────────────────────────────
// These handle WordPress block comment syntax (<!-- wp:... -->) which doesn't
// survive DOM serialization cleanly.

function convertWordPressShortcodes(html: string): string {
    // language-shortcode with {"kioblocks":[]} variant
    html = html.replace(
        /<pre class="language-shortcode"[^>]*><code[^>]*>&lt;!-- wp:shortcode \{"kioblocks":\[\]\} --&gt;([\s\S]*?)&lt;!-- \/wp:shortcode --&gt;\n<\/code>.*?<\/pre>/gms,
        '<!-- wp:shortcode {"kioblocks":[]} -->$1<!-- /wp:shortcode -->'
    );
    // plain language-shortcode
    html = html.replace(
        /<pre class="language-shortcode"[^>]*><code[^>]*>&lt;!-- wp:shortcode --&gt;([\s\S]*?)&lt;!-- \/wp:shortcode --&gt;\n<\/code>.*?<\/pre>/gms,
        '<!-- wp:shortcode -->$1<!-- /wp:shortcode -->'
    );
    return html;
}

function convertReusableBlocks(html: string): string {
    return html.replace(
        /<pre class="language-reusable-block"[^>]*><code[^>]*>&lt;!--([\s\S]*?)--&gt;\n<\/code><\/pre>/gms,
        '<!--$1-->'
    );
}

function convertWordPressBlocks(html: string): string {
    // Convert language-wordpress pre/code blocks to raw WordPress block HTML
    html = html.replace(
        /<pre class="language-wordpress"[^>]*><code[^>]*>([\s\S]*?)\n<\/code><\/pre>/gms,
        (_match, content) => content.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    );
    // Strip <p> wrapper before opening WP block comments
    html = html.replace(/<p>(<!-- wp:)/gms, '$1');
    // Strip </p> wrapper after closing WP block comments
    html = html.replace(/(<!-- \/wp:.*?-->)<\/p>/gms, '$1');
    // Fix escaped < and > inside wp blocks (two passes for nested blocks)
    const fixWpEntities = (s: string) =>
        s.replace(/(<!-- wp:[\s\S]*?)(<!-- \/wp:)/gms, (_m, inner, closing) =>
            inner.replace(/&lt;/g, '<').replace(/&gt;/g, '>') + closing
        );
    html = fixWpEntities(fixWpEntities(html));
    return html;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export const TRANSFORM_REGISTRY: TransformDefinition[] = [
    {
        id: 'removeDirAuto',
        label: 'Remove dir="auto" attributes',
        description: 'Strips dir="auto" from all elements (added by Obsidian, not needed in published HTML).',
        phase: 'dom',
        domFn: removeDirAuto,
    },
    {
        id: 'stripExternalLinkAttributes',
        label: 'Strip external link attributes',
        description: 'Removes rel, target="_blank", and Obsidian-added link classes from anchor elements.',
        phase: 'dom',
        domFn: stripExternalLinkAttributes,
    },
    {
        id: 'stripAdmonitionSVGIcons',
        label: 'Strip admonition SVG icons and inline styles',
        description: 'Removes the SVG icon elements and inline style attributes from admonition blocks.',
        phase: 'dom',
        domFn: stripAdmonitionSVGIcons,
    },
    {
        id: 'normalizeCodeBlockClasses',
        label: 'Normalize code block classes',
        description: 'Fixes <pre class=" language-X" tabindex="0"><code class="language-X is-loaded"> to the expected <pre class="language-X"><code> format.',
        phase: 'dom',
        domFn: normalizeCodeBlockClasses,
    },
    {
        id: 'stripSyntaxHighlightSpans',
        label: 'Strip syntax highlighting spans',
        description: 'Removes <span class="token ..."> elements inside code blocks, leaving plain text.',
        phase: 'dom',
        domFn: stripSyntaxHighlightSpans,
    },
    {
        id: 'removeCopyCodeButtons',
        label: 'Remove copy-code buttons',
        description: 'Removes the "copy code" button elements added by Obsidian inside code blocks.',
        phase: 'dom',
        domFn: removeCopyCodeButtons,
    },
    {
        id: 'convertOrbitBlocks',
        label: 'Convert Orbit flashcard blocks',
        description: 'Converts language-orbit pre/code blocks to proper <orbit-reviewarea> and <orbit-prompt> HTML elements.',
        phase: 'dom',
        domFn: convertOrbitBlocks,
    },
    {
        id: 'normalizeHeadingIds',
        label: 'Normalize heading IDs',
        description: 'Converts data-heading="..." attributes to id="..." with spaces replaced by dashes, for anchor link support.',
        phase: 'dom',
        domFn: normalizeHeadingIds,
    },
    {
        id: 'convertObsidianAnchorLinks',
        label: 'Convert Obsidian anchor links',
        description: 'Converts data-href="#..." anchor links to standard href="#..." format with spaces replaced by dashes.',
        phase: 'dom',
        domFn: convertObsidianAnchorLinks,
    },
    {
        id: 'removeDoubledParagraphs',
        label: 'Remove doubled paragraphs from transcludes',
        description: 'Fixes <p><p>text</p></p> nesting produced by transcluded note embeds.',
        phase: 'dom',
        domFn: removeDoubledParagraphs,
    },
    {
        id: 'removeAdmonitionStyles',
        label: 'Remove admonition <style> elements',
        description: 'Removes <style> blocks injected by admonition plugins (the target site provides its own styles).',
        phase: 'dom',
        domFn: removeAdmonitionStyles,
    },
    {
        id: 'removeTooltipAttributes',
        label: 'Remove tooltip attributes',
        description: 'Strips data-tooltip-position attributes added by Obsidian.',
        phase: 'dom',
        domFn: removeTooltipAttributes,
    },
    {
        id: 'removeAriaLabels',
        label: 'Remove aria-label attributes',
        description: 'Strips aria-label attributes that Obsidian adds to links and other elements.',
        phase: 'dom',
        domFn: removeAriaLabels,
    },
    {
        id: 'convertCollapsibleBlocks',
        label: 'Convert collapsible blocks',
        description: 'Converts collapsible "Title" hN ... end-collapsible pre/code blocks to <details><summary> HTML.',
        phase: 'dom',
        domFn: convertCollapsibleBlocks,
    },
    {
        id: 'convertWordPressShortcodes',
        label: 'Convert WordPress shortcode blocks',
        description: 'Converts language-shortcode pre/code blocks to proper <!-- wp:shortcode --> HTML comment syntax.',
        phase: 'string',
        stringFn: convertWordPressShortcodes,
    },
    {
        id: 'convertReusableBlocks',
        label: 'Convert WordPress reusable blocks',
        description: 'Converts language-reusable-block pre/code blocks to proper <!-- --> HTML comment syntax.',
        phase: 'string',
        stringFn: convertReusableBlocks,
    },
    {
        id: 'convertWordPressBlocks',
        label: 'Convert WordPress blocks',
        description: 'Converts language-wordpress pre/code blocks to raw WordPress block HTML, unescaping entities and stripping <p> wrappers around block comments.',
        phase: 'string',
        stringFn: convertWordPressBlocks,
    },
    {
        id: 'normalizeNbsp',
        label: 'Replace non-breaking spaces with regular spaces',
        description: 'Removes &nbsp; characters inserted by the browser serializer at boundaries between inline elements and text (e.g. after </a> or </code>). Skips <pre> blocks.',
        phase: 'dom',
        domFn: normalizeNbsp,
    },
];
