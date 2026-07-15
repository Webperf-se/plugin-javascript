import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import securityConfig from '../configurations/security.mjs';
import standardConfig from '../configurations/standard.mjs';

export class HarAnalyzer {
    constructor() {
        this.groups = {};

        // Create a shared ESLint instance
        this.eslintSecurity = new ESLint({
            overrideConfigFile: true,
            overrideConfig: securityConfig
        });
        this.securityRules = securityConfig[0].rules;
        this.eslintStandard = new ESLint({
            overrideConfigFile: true,
            overrideConfig: standardConfig
        });
        this.standardRules = standardConfig[0].rules;

        const libFolder = fileURLToPath(new URL('..', import.meta.url));
        this.pluginFolder = path.resolve(libFolder, '..');
        const packagePath = path.resolve(libFolder, 'package.json');
        this.package = JSON.parse(readFileSync(packagePath, 'utf8'));
        this.dependencies = this.package.dependencies;
        this.version = this.package.version;
    }
    getFirstPageEntries(url, harData) {
        if ('log' in harData) {
            harData = harData['log'];
        }

        const entries = harData.entries;
        if (!Array.isArray(entries)) {
            return [];
        }

        // A HAR can contain more than one page, for example when a concurrent
        // browsertime run ends up in the same browser session (crossed DevTools
        // port) and navigates to another website mid-recording. Requests made
        // by other pages must not be attributed to the tested website, and if
        // the recording doesn't even start with the tested website nothing in
        // it can be trusted.
        if (url && entries.length > 0) {
            const firstUrl = entries[0].request && entries[0].request.url;
            if (firstUrl) {
                try {
                    if (new URL(firstUrl).hostname !== new URL(url).hostname) {
                        return [];
                    }
                } catch {
                    // Unparsable URLs are handled by the entry loops as before
                }
            }
        }

        const pages = harData.pages;
        if (!Array.isArray(pages) || pages.length === 0) {
            return entries;
        }
        const firstPageId = pages[0].id;
        if (firstPageId === undefined) {
            return entries;
        }
        return entries.filter(entry =>
            entry.pageref === undefined || entry.pageref === firstPageId);
    }

    transform2SimplifiedData(harData, url) {
        const data = {
            'url': url,
            'security-rules': this.configSecurity,
            'standard-rules': this.configStandard,
            'htmls': [],
            'all-scripts': [],
            'script-elements': [],
            'script-attributes': [],
            'script-files': []
        };

        let reqIndex = 1;

        for (const entry of this.getFirstPageEntries(url, harData)) {
            const req = entry.request;
            const res = entry.response;
            const reqUrl = req.url;

            if (!res.content || !res.content.text || !res.content.mimeType || !res.content.size || res.content.size <= 0 || !res.status) {
                continue;
            }

            const obj = {
                'url': reqUrl,
                'content': res.content.text,
                'index': reqIndex
            };
            if (res.content.mimeType.includes('html')) {
                data.htmls.push(obj);
            }
            else if (res.content.mimeType.includes('javascript')) {
                data['all-scripts'].push(obj);
                data['script-files'].push(obj);
            }

            reqIndex++;
        }

        // Extract <script> elements from HTML content
        for (const htmlObj of data.htmls) {
            const dom = new JSDOM(htmlObj.content);
            const styleElements = dom.window.document.querySelectorAll('script');
            styleElements.forEach((styleElement) => {
                const styleElementObj = {
                    'url': htmlObj.url,
                    'content': styleElement.textContent,
                    'index': htmlObj.index
                };

                // Only include if content is not empty
                if (styleElementObj.content && styleElementObj.content.trim() !== '') {
                    data['all-scripts'].push(styleElementObj);
                    data['script-elements'].push(styleElementObj);
                }
            });
        }

        return data;
    }

    async createKnowledgeFromData(analyzedData, url, group) {
        let knowledgeData = {
            'url': url,
            'group': group,
            'issues': {}
        };

        if (analyzedData === undefined) {
            return knowledgeData;
        }

        if (!('htmls' in analyzedData)) {
            return knowledgeData;
        }

        if (analyzedData['htmls'].length === 0) {
            knowledgeData['issues'] = {
                'no-network': {
                    'test': 'javascript',
                    'rule': 'no-network',
                    'category': 'technical',
                    'severity': 'warning',
                    'subIssues': [
                        {
                            'url': url,
                            'rule': 'no-network',
                            'category': 'standard',
                            'severity': 'warning',
                            'text': `No HTML content found in the HAR file.`,
                            'line': 0,
                            'column': 0
                        }
                    ]
                }
            };
            return knowledgeData;
        }

        if (!('all-scripts' in analyzedData)) {
            return knowledgeData;
        }

        // Lint with both security and standard configurations
        const lintPromises = analyzedData['all-scripts'].flatMap(entry => [
            this.eslintSecurity.lintText(entry.content).then(results => {
                return results.flatMap(result =>
                    result.messages
                        .filter(message => message.ruleId !== null) // Ignore messages with null ruleId
                        .map(message => ({
                            url: entry.url,
                            rule: message.ruleId,
                            category: 'security',
                            severity: message.severity === 1 ? "warning" : message.severity === 2 ? "error" : message.severity,
                            text: message.message,
                            line: message.line,
                            column: message.column
                        }))
                );
            }),
            this.eslintStandard.lintText(entry.content).then(results => {
                return results.flatMap(result =>
                    result.messages
                        .filter(message => message.ruleId !== null) // Ignore messages with null ruleId
                        .map(message => ({
                            url: entry.url,
                            rule: message.ruleId,
                            category: 'standard',
                            severity: message.severity === 1 ? "warning" : message.severity === 2 ? "error" : message.severity,
                            text: message.message,
                            line: message.line,
                            column: message.column
                        }))
                );
            })
        ]);

        // Wait for all linting promises to resolve and flatten the results
        const lintResults = await Promise.all(lintPromises);
        const flatResults = lintResults.flat();

        // Convert issues to a set grouped by rule
        const issuesByRule = {};
        for (const issue of flatResults) {
            if (!issuesByRule[issue.rule]) {
                issuesByRule[issue.rule] = {
                    'test': 'javascript',
                    rule: issue.rule,
                    category: issue.category,
                    severity: issue.severity,
                    resources: [],
                    subIssues: []
                };
                issuesByRule[issue.rule]['resources'].push('https://eslint.org/docs/latest/rules/' + issue.rule);
            }
            issuesByRule[issue.rule].subIssues.push(issue);
        }

        // Add missing rules from securityConfig and standardConfig
        const allRules = [
            ...Object.keys(this.securityRules || {}).filter(rule => this.securityRules[rule] !== "off"),
            ...Object.keys(this.standardRules || {}).filter(rule => this.standardRules[rule] !== "off")
        ];
        
        for (const rule of allRules) {
            if (!issuesByRule[rule]) {
                issuesByRule[rule] = {
                    'test': 'javascript',
                    rule: rule,
                    category: rule in this.securityRules ? 'security' : 'standard',
                    severity: 'resolved', // Default severity for missing issues
                    resources: [],
                    subIssues: []
                };
                issuesByRule[rule]['resources'].push('https://eslint.org/docs/latest/rules/' + rule);
            }
        }

        knowledgeData.issues = issuesByRule;

        return knowledgeData;
    }

    async analyzeData(url, harData, group) {
        if (this.groups[group] === undefined) {
            this.groups[group] = {};
        }

        const analyzedData = this.transform2SimplifiedData(harData, url);
        if (!('analyzedData' in this.groups[group])) {
            this.groups[group]['analyzedData'] = []
        }
        this.groups[group]['analyzedData'].push(analyzedData);

        const knowledgeData = await this.createKnowledgeFromData(analyzedData, url, group);
        if (!('knowledgeData' in this.groups[group])) {
            this.groups[group]['knowledgeData'] = []
        }
        this.groups[group]['knowledgeData'].push(knowledgeData);

        return {
            'version': this.version,
            'dependencies': this.dependencies,
            'url': url,
            'analyzedData': analyzedData,
            'knowledgeData': knowledgeData
        };
    }

    getSummary() {
        return this;
    }
}