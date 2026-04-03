# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal fork of an abandoned Obsidian Pandoc export plugin. It adds command palette options to export notes to multiple formats (Word, PDF, ePub, HTML, PowerPoint, LaTeX, etc.). The fork was created primarily to fix embed/wikilink handling issues.

## Build Commands

```bash
npm install          # Install dependencies
npm run dev          # Development build with esbuild watch mode
npm run build        # Production build (no sourcemaps)
```

There are no lint or test commands. The build output is `main.js` (CommonJS bundle consumed by Obsidian).

## Architecture

The plugin has seven main modules with clear separation of concerns:

**`main.ts`** — Plugin entry point. Extends Obsidian's `Plugin` class, registers command palette entries for each export format and publication profile, checks system dependencies (`pandoc`, `pdflatex` via `lookpath`), and orchestrates the export and publish flows.

**`renderer.ts`** — The most complex module. Converts Obsidian markdown to HTML using Obsidian's internal `MarkdownRenderer`, then post-processes the DOM to handle Obsidian-specific syntax: embed resolution (recursive), wikilink conversion, image src fixing, Mermaid diagram SVG→PNG conversion, YAML frontmatter stripping, and CSS injection (app, theme, custom, MathJax).

**`pandoc.ts`** — Spawns and communicates with the Pandoc binary via `child_process.spawn()`. Constructs CLI arguments based on format specs, handles stdin/stdout streaming, and manages temporary metadata YAML files.

**`settings.ts`** — Obsidian `PluginSettingTab` UI for export options (CSS injection, link behavior, export source, binary paths, extra Pandoc args) and publication profile configuration.

**`global.ts`** — Shared TypeScript interfaces (`PandocPluginSettings`, `PublicationProfile`, `PublicationSettings`), `DEFAULT_SETTINGS`, transform ID types, and utility functions.

**`publication-transforms.ts`** — Registry of 17 named HTML post-processing transforms that replace the Ogen Alfred script. Transforms run in two phases:
- **DOM phase** (14 transforms): operate on a re-parsed `HTMLElement` before serialization — strip `dir="auto"`, external link attributes, admonition SVG icons, syntax highlighting spans, copy-code buttons; normalize code block classes and heading IDs; convert Orbit flashcard blocks and collapsible blocks; remove doubled paragraphs, admonition styles, tooltip attributes, aria labels.
- **String phase** (3 transforms): handle WordPress block comment syntax (`<!-- wp:... -->`) which doesn't survive DOM round-trips — converts `language-shortcode`, `language-reusable-block`, and `language-wordpress` pre/code blocks to raw WordPress HTML.

**`publisher.ts`** — Orchestrates the publication pipeline that replaces the Opub Alfred script: calls `render()`, extracts body HTML, applies DOM then string transforms, loads optional `custom-transforms.js`, reads `repo` and `file` from note front matter, git-pulls the target repo, writes the output file (with YAML front matter prepended), git-commits and pushes, then updates `needs-published-update` and `last-published-date` in the source note via `vault.modify()`.

## Export Flow

1. User invokes a command palette export action
2. `main.ts` calls `startPandocExport()`
3. If `exportFrom` setting is `"html"`: `renderer.ts` renders the note to HTML + extracts YAML metadata, then `pandoc.ts` pipes HTML through Pandoc to the target format
4. If `exportFrom` setting is `"md"`: `pandoc.ts` converts the raw markdown directly

## Publication Flow

1. User invokes "Publish to [Profile]" from the command palette
2. `main.ts` calls `startPublish()` → `publisher.ts publishNote()`
3. `render()` produces a standalone HTML document; body content is extracted
4. Enabled DOM transforms run on a re-parsed fragment, then enabled string transforms run on the serialized result
5. Optional `custom-transforms.js` functions run (vault path: `.obsidian/plugins/obsidian-pandoc/custom-transforms.js`)
6. Front matter fields `repo` and `file` are read from the note to determine the output path
7. `git pull` → write file (YAML front matter + HTML body) → `git add/commit/push`
8. Source note `needs-published-update` and `last-published-date` fields are updated

## Key Patterns

- **Recursive embed handling**: `renderer.ts` calls `render()` recursively to inline `[[embedded notes]]`, with circular reference guards tracked via a `Set` of visited file paths.
- **Post-processing DOM**: After Obsidian renders markdown to an HTML element, the plugin queries and mutates that DOM tree before serializing to a string — be careful about element selectors when modifying this code.
- **Component lifecycle**: Obsidian's `MarkdownRenderer.renderMarkdown()` requires a `Component` instance. The plugin manually calls `component.unload()` after rendering to prevent memory leaks (see recent commit history for why this matters).
- **Third-party post-processor tolerance**: Errors from Obsidian post-processors (e.g., admonitions, dataview) are caught and ignored so they don't abort the export.
- **Publication transform registry**: `TRANSFORM_REGISTRY` in `publication-transforms.ts` is the single source of truth for both the pipeline logic and the settings UI checkboxes. Add new transforms there; they appear in settings automatically.
- **WordPress HTML comment round-trip**: WordPress block syntax (`<!-- wp:... -->`) can't be represented as DOM comment nodes that survive `innerHTML` serialization reliably, so those three transforms run as string regexes after DOM serialization rather than as DOM mutations.

## Publication Profile Front Matter Fields

Notes must have these fields for the publish command to work:

```yaml
repo: my-blog-repo        # git repo name, relative to profile.gitReposBasePath
file: content/posts/x.md  # output file path, relative to repo root
```

These fields are updated after a successful publish:
```yaml
needs-published-update: false  # cleared (never used to skip publishing)
last-published-date: 20240101  # set to today in YYYYMMDD format
```
