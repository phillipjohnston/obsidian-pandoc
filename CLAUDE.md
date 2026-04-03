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

The plugin has five main modules with clear separation of concerns:

**`main.ts`** — Plugin entry point. Extends Obsidian's `Plugin` class, registers command palette entries for each export format, checks system dependencies (`pandoc`, `pdflatex` via `lookpath`), and orchestrates the export flow.

**`renderer.ts`** — The most complex module. Converts Obsidian markdown to HTML using Obsidian's internal `MarkdownRenderer`, then post-processes the DOM to handle Obsidian-specific syntax: embed resolution (recursive), wikilink conversion, image src fixing, Mermaid diagram SVG→PNG conversion, YAML frontmatter stripping, and CSS injection (app, theme, custom, MathJax).

**`pandoc.ts`** — Spawns and communicates with the Pandoc binary via `child_process.spawn()`. Constructs CLI arguments based on format specs, handles stdin/stdout streaming, and manages temporary metadata YAML files.

**`settings.ts`** — Obsidian `PluginSettingTab` UI for 10+ user-configurable options (CSS injection, link behavior, export source, binary paths, extra Pandoc args).

**`global.ts`** — Shared TypeScript interfaces (`PandocPluginSettings`), `DEFAULT_SETTINGS`, and utility functions (`replaceFileExtension`, `fileExists`).

## Export Flow

1. User invokes a command palette export action
2. `main.ts` calls `startPandocExport()`
3. If `exportFrom` setting is `"html"`: `renderer.ts` renders the note to HTML + extracts YAML metadata, then `pandoc.ts` pipes HTML through Pandoc to the target format
4. If `exportFrom` setting is `"md"`: `pandoc.ts` converts the raw markdown directly

## Key Patterns

- **Recursive embed handling**: `renderer.ts` calls `render()` recursively to inline `[[embedded notes]]`, with circular reference guards tracked via a `Set` of visited file paths.
- **Post-processing DOM**: After Obsidian renders markdown to an HTML element, the plugin queries and mutates that DOM tree before serializing to a string — be careful about element selectors when modifying this code.
- **Component lifecycle**: Obsidian's `MarkdownRenderer.renderMarkdown()` requires a `Component` instance. The plugin manually calls `component.unload()` after rendering to prevent memory leaks (see recent commit history for why this matters).
- **Third-party post-processor tolerance**: Errors from Obsidian post-processors (e.g., admonitions, dataview) are caught and ignored so they don't abort the export.
