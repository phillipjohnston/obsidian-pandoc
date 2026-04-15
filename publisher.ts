
/*
 * publisher.ts
 *
 * Orchestrates the publication pipeline:
 *   render → DOM transforms → string transforms → custom JS → write → git → update front matter
 *
 * Reads target repo and file path from the note's YAML front matter:
 *   repo: my-blog                 (relative to profile.gitReposBasePath)
 *   file: content/posts/x.md     (relative to repo root)
 *   needs-published-update: true  (cleared to false after publish)
 *   last-published-date: 20240101 (updated to today after publish)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import * as YAML from 'yaml';
import { FileSystemAdapter, Notice, TFile } from 'obsidian';

import PandocPlugin from './main';
import render from './renderer';
import { PublicationProfile } from './global';
import { TRANSFORM_REGISTRY } from './publication-transforms';

// ── Git helpers ───────────────────────────────────────────────────────────────

function spawnGit(args: string[], cwd: string, extraEnv: Record<string, string> = {}): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const env = Object.assign({}, process.env, extraEnv);
        const proc = spawn('git', args, { cwd, env });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => stdout += d.toString());
        proc.stderr.on('data', (d: Buffer) => stderr += d.toString());
        proc.on('close', code => {
            if (code === 0) {
                resolve({ stdout, stderr });
            } else {
                reject(new Error(`git ${args[0]} failed (exit ${code}): ${stderr}`));
            }
        });
        proc.on('error', reject);
    });
}

const SUBLIME_PATH = '/usr/local/bin/subl';

async function sublimeIsAvailable(): Promise<boolean> {
    try {
        await fs.promises.access(SUBLIME_PATH, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

// ── Front matter helpers ──────────────────────────────────────────────────────

function extractFrontMatterBlock(markdown: string): string {
    const trimmed = markdown.trimStart();
    if (!trimmed.startsWith('---')) return '';
    const rest = trimmed.slice(3);
    const end = rest.indexOf('\n---');
    if (end === -1) return '';
    return '---' + rest.slice(0, end + 4); // includes closing ---
}

function parseFrontMatter(markdown: string): Record<string, any> {
    const block = extractFrontMatterBlock(markdown);
    if (!block) return {};
    const inner = block.slice(3, block.lastIndexOf('---')).trim();
    try {
        return YAML.parse(inner) || {};
    } catch {
        return {};
    }
}

function updateFrontMatterFields(markdown: string, updates: Record<string, any>): string {
    let result = markdown;
    for (const [key, value] of Object.entries(updates)) {
        // Replace existing key: value or key: "value"
        const keyEscaped = key.replace(/[-]/g, '\\$&');
        const re = new RegExp(`(^|\\n)(${keyEscaped}):[ \\t]*[^\\n]*`, '');
        if (re.test(result)) {
            result = result.replace(re, `$1${key}: ${value}`);
        }
        // If key not found, don't add it — only update existing fields
    }
    return result;
}

// ── Custom transforms ─────────────────────────────────────────────────────────

async function loadCustomTransforms(vaultBasePath: string): Promise<Array<(html: string) => string>> {
    const customPath = path.join(vaultBasePath, '.obsidian', 'plugins', 'obsidian-pandoc', 'custom-transforms.js');
    try {
        await fs.promises.access(customPath, fs.constants.F_OK);
    } catch {
        return []; // file doesn't exist, silently skip
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require(customPath);
        return Object.values(mod).filter((v): v is (html: string) => string => typeof v === 'function');
    } catch (e) {
        console.warn('Pandoc plugin: failed to load custom-transforms.js:', e);
        return [];
    }
}

// ── Shared render + transform pipeline ───────────────────────────────────────

async function renderAndTransform(
    plugin: PandocPlugin,
    inputFile: string,
    markdown: string,
    profile: PublicationProfile
): Promise<string> {
    // 1. Render to standalone HTML using the existing render pipeline
    const { html: standaloneHTML } = await render(plugin, markdown, inputFile, 'html');

    // 2. Extract body content from the standalone document
    const doc = new DOMParser().parseFromString(standaloneHTML, 'text/html');
    const bodyHTML = doc.body.innerHTML;

    // 3. Re-parse as a fragment for DOM transforms
    const container = document.createElement('div');
    container.innerHTML = bodyHTML;

    // 4. Run enabled DOM transforms in registry order
    const enabledIds = new Set(profile.enabledTransforms);
    for (const transform of TRANSFORM_REGISTRY) {
        if (transform.phase !== 'dom') continue;
        if (!enabledIds.has(transform.id)) continue;
        try {
            transform.domFn!(container);
        } catch (e) {
            console.warn(`Pandoc plugin: DOM transform "${transform.id}" threw:`, e);
        }
    }

    // 5. Serialize back to string
    let html = container.innerHTML;

    // 6. Run enabled string transforms in registry order
    for (const transform of TRANSFORM_REGISTRY) {
        if (transform.phase !== 'string') continue;
        if (!enabledIds.has(transform.id)) continue;
        try {
            html = transform.stringFn!(html);
        } catch (e) {
            console.warn(`Pandoc plugin: string transform "${transform.id}" threw:`, e);
        }
    }

    // 7. Run custom JS transforms from vault plugin directory
    const customFns = await loadCustomTransforms(plugin.vaultBasePath());
    for (const fn of customFns) {
        try {
            html = fn(html);
        } catch (e) {
            console.warn('Pandoc plugin: custom transform threw:', e);
        }
    }

    return html;
}

// ── Clipboard copy function ───────────────────────────────────────────────────

export async function copyNoteToClipboard(
    plugin: PandocPlugin,
    inputFile: string,
    markdown: string,
    profile: PublicationProfile
): Promise<void> {
    const html = await renderAndTransform(plugin, inputFile, markdown, profile);
    await navigator.clipboard.writeText(html);
}

// ── Core publication function ─────────────────────────────────────────────────

export async function publishNote(
    plugin: PandocPlugin,
    inputFile: string,
    markdown: string,
    profile: PublicationProfile
): Promise<void> {

    // 1–7. Render HTML and run all transforms
    let html = await renderAndTransform(plugin, inputFile, markdown, profile);

    // 8. Read front matter fields from source note
    const frontMatter = parseFrontMatter(markdown);
    const repository: string | undefined = frontMatter['repo'];
    const filepath: string | undefined = frontMatter['file'];

    if (!repository) throw new Error('Note front matter is missing "repo" field.');
    if (!filepath) throw new Error('Note front matter is missing "file" field.');

    // 9. Resolve repo and output paths
    const reposBase = profile.gitReposBasePath.replace(/^~/, os.homedir());
    const repoDir = path.join(reposBase, repository);
    const outputFile = path.join(repoDir, filepath);

    // 10. Ensure repo dir exists
    try {
        await fs.promises.access(repoDir, fs.constants.F_OK);
    } catch {
        throw new Error(`Git repository directory not found: ${repoDir}`);
    }

    // 11. git pull to get latest before overwriting
    await spawnGit(['pull'], repoDir);

    // 12. Preserve existing front matter from the output file in the repo.
    // The repo file has its own metadata (ID, post_title, layout, etc.) that
    // must not be overwritten. We read it, keep its front matter, and replace
    // only the HTML body that follows it.
    let existingFrontMatterBlock = '';
    try {
        const existing = await fs.promises.readFile(outputFile, 'utf8');
        existingFrontMatterBlock = extractFrontMatterBlock(existing);
    } catch {
        // File doesn't exist yet — no existing front matter to preserve
    }

    const outputContent = existingFrontMatterBlock
        ? existingFrontMatterBlock + '\n' + html
        : html;

    // 13. Write output file
    await fs.promises.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.promises.writeFile(outputFile, outputContent, 'utf8');

    // 14. Git commit (opens Sublime Text for review) and push
    await spawnGit(['add', filepath], repoDir);
    if (!await sublimeIsAvailable()) {
        new Notice(
            `Publish: file written and staged in ${repoDir}, but Sublime Text was not found at ${SUBLIME_PATH}. ` +
            `Please commit manually.`,
            20000
        );
        return;
    }
    await spawnGit(['commit', '-v'], repoDir, { GIT_EDITOR: `${SUBLIME_PATH} -w` });
    await spawnGit(['push'], repoDir);

    // 15. Update source note front matter
    const today = new Date();
    const dateStr = today.getFullYear().toString()
        + String(today.getMonth() + 1).padStart(2, '0')
        + String(today.getDate()).padStart(2, '0');

    const updatedMarkdown = updateFrontMatterFields(markdown, {
        'needs-published-update': false,
        'last-published-date': dateStr,
    });

    if (updatedMarkdown !== markdown) {
        const adapter = plugin.app.vault.adapter as FileSystemAdapter;
        const vaultRelativePath = inputFile.replace(adapter.getBasePath() + path.sep, '');
        const tFile = plugin.app.vault.getAbstractFileByPath(vaultRelativePath.replace(/\\/g, '/'));
        if (tFile instanceof TFile) {
            await plugin.app.vault.modify(tFile, updatedMarkdown);
        }
    }
}
