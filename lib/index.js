import { SitespeedioPlugin } from '@sitespeed.io/plugin';
import { HarAnalyzer } from './harAnalyzer.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
const fsp = fs.promises;

// https://www.sitespeed.io/documentation/sitespeed.io/plugins/#create-your-own-plugin
// node bin\sitespeed.js -b edge -n 1 --plugins.add analysisstorer --plugins.add ../../../plugin-javascript/lib/index.js --browsertime.chrome.includeResponseBodies all https://webperf.se

const pluginname = 'webperf-plugin-javascript'

export default class JavascriptPlugin extends SitespeedioPlugin {
  constructor(options, context, queue) {
    super({ name: pluginname, options, context, queue });
  }

  async open(context, options) {
    this.make = context.messageMaker(pluginname).make;
    this.harAnalyzer = new HarAnalyzer();
    this.isWebperfCorePluginPresent = false;
    const libFolder = fileURLToPath(new URL('..', import.meta.url));
    this.pluginFolder = path.resolve(libFolder);
    this.options = options;
    this.log = context.log;

    this.pug = await fsp.readFile(
      path.resolve(this.pluginFolder, 'pug', 'index.pug'),
      'utf8'
    );
  }

  async processMessage(message, queue) {
    // const filterRegistry = this.filterRegistry;
    switch (message.type) {
      case 'browsertime.setup': {
        // check https://github.com/sitespeedio/dashboard.sitespeed.io/blob/main/config/emulatedMobile.json for inspiration
        queue.postMessage(this.make('browsertime.config', {
          "chrome": {
            "includeResponseBodies": "all",
          },
          "firefox": {
            "includeResponseBodies": "all"
          }
        }));
        break;
      }
      case 'sitespeedio.setup': {
        // Let other plugins know that our plugin is alive
        queue.postMessage(this.make(pluginname + '.setup', {
          'version': this.version,
          'dependencies': this.dependencies
        }));
        // Add the HTML pugs
        queue.postMessage(
          this.make('html.pug', {
            id: pluginname,
            name: 'Javascript',
            pug: this.pug,
            type: 'pageSummary'
          })
        );
        queue.postMessage(
          this.make('html.pug', {
            id: pluginname,
            name: 'Javascript',
            pug: this.pug,
            type: 'run'
          })
        );
        break;
      }
      case 'plugin-webperf-core.setup': {
        this.isWebperfCorePluginPresent = true;
        break;
      }
      case 'browsertime.har': {
        const url = message.url;
        const group = message.group;
        const harData = message.data;
        var data = await this.harAnalyzer.analyzeData(url, harData, group);

        if (this.isWebperfCorePluginPresent) {
          super.sendMessage(
            // The WebPerf plugin will pickup every message names *.webPerfCoreSummary
            // and publish the data under pageInfo.data.*.pageSummary
            pluginname + '.webPerfCoreSummary',
            data,
            {
              url,
              group
            }
          );
        } else {
          super.sendMessage(
            // The HTML plugin will pickup every message names *.pageSummary
            // and publish the data under pageInfo.data.*.pageSummary
            // in this case pageInfo.data.gpsi.pageSummary
            pluginname + '.pageSummary',
            data,
            {
              url,
              group
            }
          );
        }
        break;
      }
      case 'sitespeedio.summarize': {
        const summary = this.harAnalyzer.getSummary();
        for (let group of Object.keys(summary.groups)) {
          super.sendMessage(pluginname + '.summary', summary.groups[group], {
            group
          });

          if (this.options.javascript && this.options.javascript.terminal && this.options.javascript.terminal.showresults) {
            this.log.info('plugin-javascript', group, JSON.stringify(summary.groups[group], false, '   '));
          }
        }
        break;
      }
    }
  }
  // close(options, errors) {
  //   // Cleanup if necessary
  // }
}
