
/*
 * settings.ts
 *
 * Creates the settings UI
 *
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import PandocPlugin from './main';
import { TransformId } from './global';
import { TRANSFORM_REGISTRY } from './publication-transforms';

export default class PandocPluginSettingTab extends PluginSettingTab {
    plugin: PandocPlugin;
    errorMessages: { [key: string]: string } = {
        pandoc: "Pandoc is not installed or accessible on your PATH. This plugin's functionality will be limited.",
        latex: "LaTeX is not installed or accessible on your PATH. Please install it if you want PDF exports via LaTeX.",
    }

    constructor(app: App, plugin: PandocPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        containerEl.createEl('h3', {text: 'Pandoc Plugin'});

        const createError = (text: string) =>
            containerEl.createEl('p', { cls: 'pandoc-plugin-error', text });
        
        for (const binary in this.plugin.features) {
            const path = this.plugin.features[binary];
            if (path === undefined) {
                createError(this.errorMessages[binary]);
            }
        }

        new Setting(containerEl)
            .setName("Custom CSS file for HTML output")
            .setDesc("This local CSS file will be read and injected into HTML exports. Use an absolute path or a path relative to the vault.")
            .addText(text => text
                .setPlaceholder('File name')
                .setValue(this.plugin.settings.customCSSFile)
                .onChange(async (value: string) => {
                    if (!value.length) this.plugin.settings.customCSSFile = null;
                    else this.plugin.settings.customCSSFile = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Inject app CSS (HTML output only)")
            .setDesc("This applies app & plugin CSS to HTML exports, but the files become a little bigger.")
            .addDropdown(dropdown => dropdown
                .addOptions({
                    "current": "Current theme",
                    "none": "Neither theme",
                    "light": "Light theme",
                    "dark": "Dark theme",
                })
                .setValue(this.plugin.settings.injectAppCSS)
                .onChange(async (value: string) => {
                    this.plugin.settings.injectAppCSS = value as 'current' | 'none' | 'light' | 'dark';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Internal link processing")
            .setDesc("This controls how [[wiki-links]] are formatted. Doesn't affect HTML output.")
            .addDropdown(dropdown => dropdown
                .addOptions({
                    "text": "Turn into text",
                    "link": "Leave as links",
                    "strip": "Remove links",
                    "unchanged": "Leave unchanged",
                })
                .setValue(this.plugin.settings.linkStrippingBehaviour)
                .onChange(async (value: string) => {
                    this.plugin.settings.linkStrippingBehaviour = value as 'strip' | 'text' | 'link' | 'unchanged';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Export files from HTML or markdown?")
            .setDesc("Export from markdown, or from the HTML visible in Obsidian? HTML supports fancy plugin features, markdown supports Pandoc features like citations.")
            .addDropdown(dropdown => dropdown
                .addOptions({
                    "html": "HTML",
                    "md": "Markdown",
                })
                .setValue(this.plugin.settings.exportFrom)
                .onChange(async (value: string) => {
                    this.plugin.settings.exportFrom = value as 'html' | 'md';
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Export folder")
            .setDesc("Absolute path to an export folder, like 'C:\Users\Example\Documents' or '/home/user/zettelkasten'. If left blank, files are saved next to where they were exported from.")
            .addText(text => text
                .setPlaceholder('same as target')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async (value: string) => {
                    this.plugin.settings.outputFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Show Pandoc command line interface commands")
            .setDesc("Doesn't apply to HTML exports. Using the CLI will have slightly different results due to how this plugin works.")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showCLICommands)
                .onChange(async (value: boolean) => {
                    this.plugin.settings.showCLICommands = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Pandoc path")
            .setDesc("Optional override for Pandoc's path if you have command not found issues. On Mac/Linux use the output of 'which pandoc' in a terminal; on Windows use the output of 'Get-Command pandoc' in powershell.")
            .addText(text => text
                .setPlaceholder('pandoc')
                .setValue(this.plugin.settings.pandoc)
                .onChange(async (value: string) => {
                    this.plugin.settings.pandoc = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("PDFLaTeX path")
            .setDesc("Optional override for pdflatex's path. Same as above but with 'which pdflatex'")
            .addText(text => text
                .setPlaceholder('pdflatex')
                .setValue(this.plugin.settings.pdflatex)
                .onChange(async (value: string) => {
                    this.plugin.settings.pdflatex = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Extra Pandoc arguments")
            .setDesc("Add extra command line arguments so you can use templates or bibliographies. Newlines are turned into spaces")
            .addTextArea(text => text
                .setPlaceholder('Example: --bibliography "Zotero Exports\My Library.json" or --template letter')
                .setValue(this.plugin.settings.extraArguments)
                .onChange(async (value: string) => {
                    this.plugin.settings.extraArguments = value;
                    await this.plugin.saveSettings();
                })
                .inputEl.style.minHeight='150px');

        // ── Publication profiles ──────────────────────────────────────────────

        containerEl.createEl('h3', { text: 'Publication Profiles' });
        containerEl.createEl('p', {
            text: 'Configure publication targets for the "Publish to..." commands. ' +
                  'Each profile maps to a git repository and controls which HTML transforms are applied. ' +
                  'Adding or removing profiles requires reloading the plugin to update the command palette.',
            cls: 'setting-item-description',
        });

        for (let i = 0; i < this.plugin.settings.publication.profiles.length; i++) {
            const profile = this.plugin.settings.publication.profiles[i];

            containerEl.createEl('h4', { text: profile.name });

            new Setting(containerEl)
                .setName("Profile name")
                .setDesc("Display name used in the command palette (e.g. \"WordPress\", \"Personal Site\").")
                .addText(text => text
                    .setValue(profile.name)
                    .onChange(async (value: string) => {
                        this.plugin.settings.publication.profiles[i].name = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName("Git repositories base path")
                .setDesc("Absolute path to the folder containing your git repositories. The 'repository' front matter field is appended to this path. Use ~ for home directory.")
                .addText(text => text
                    .setPlaceholder('~/src')
                    .setValue(profile.gitReposBasePath)
                    .onChange(async (value: string) => {
                        this.plugin.settings.publication.profiles[i].gitReposBasePath = value;
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('p', {
                text: 'Custom transforms: place a custom-transforms.js file at ' +
                      '.obsidian/plugins/obsidian-pandoc/custom-transforms.js in your vault. ' +
                      'It should export functions with signature (html: string) => string.',
                cls: 'setting-item-description',
            });

            containerEl.createEl('p', {
                text: 'Enabled transforms (applied in order):',
                cls: 'setting-item-description',
            });

            for (const transform of TRANSFORM_REGISTRY) {
                new Setting(containerEl)
                    .setName(transform.label)
                    .setDesc(transform.description)
                    .addToggle(toggle => toggle
                        .setValue(profile.enabledTransforms.includes(transform.id))
                        .onChange(async (value: boolean) => {
                            const current = this.plugin.settings.publication.profiles[i].enabledTransforms;
                            if (value && !current.includes(transform.id)) {
                                current.push(transform.id);
                            } else if (!value) {
                                this.plugin.settings.publication.profiles[i].enabledTransforms =
                                    current.filter((id: TransformId) => id !== transform.id);
                            }
                            await this.plugin.saveSettings();
                        }));
            }
        }
    }
}
