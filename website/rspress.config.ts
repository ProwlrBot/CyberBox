import * as path from 'node:path';
import { pluginSass } from '@rsbuild/plugin-sass';
import { pluginSvgr } from '@rsbuild/plugin-svgr';
import { defineConfig } from '@rspress/core';
import { pluginLlms } from '@rspress/plugin-llms';
import { pluginSitemap } from '@rspress/plugin-sitemap';
import { pluginTwoslash } from '@rspress/plugin-twoslash';
import {
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
} from '@shikijs/transformers';
import { pluginGoogleAnalytics } from 'rsbuild-plugin-google-analytics';
import { pluginOpenGraph } from 'rsbuild-plugin-open-graph';
import { pluginFontOpenSans } from 'rspress-plugin-font-open-sans';

const siteUrl = 'https://prowlrbot.com/cyberbox';

export default defineConfig({
  root: path.join(__dirname, 'docs'),
  lang: 'en',
  title: 'CyberBox',
  description:
    'CyberBox — all-in-one Docker security workspace with 160+ tools, dual AI, Caido proxy, and plugin marketplace',
  icon: '/brand/favicon.svg',
  logo: {
    dark: '/brand/logo-dark.svg',
    light: '/brand/logo-light.svg',
  },
  themeDir: path.join(__dirname, 'theme'),
  route: {
    cleanUrls: true,
  },
  markdown: {
    shiki: {
      langAlias: {
        Bash: 'shellscript',
        Shell: 'shellscript',
        Dockerfile: 'docker',
        Python: 'python',
      },
      langs: ['shellscript', 'docker', 'python'],
      transformers: [
        transformerNotationDiff(),
        transformerNotationErrorLevel(),
        transformerNotationHighlight(),
        transformerNotationFocus(),
      ],
    },
    link: {
      checkDeadLinks: false,
    },
  },
  plugins: [
    pluginTwoslash(),
    pluginFontOpenSans(),
    pluginSitemap({
      siteUrl,
    }),
    pluginLlms(),
  ],
  base: process.env.BASE_URL ?? '/',
  outDir: 'doc_build',
  builderConfig: {
    html: {
      template: 'public/index.html',
    },
    plugins: [
      pluginSass(),
      pluginSvgr({ svgrOptions: { exportType: 'default' } }),
      pluginGoogleAnalytics({ id: 'G-VDPJE6PYSN' }),
      pluginOpenGraph({
        url: siteUrl,
        image: `${siteUrl}/og-image.png`,
        description:
          'All-in-One Docker security workspace with 160+ tools, dual AI, Caido proxy, and a plugin marketplace — for hunters and agents.',
        twitter: {
          card: 'summary_large_image',
        },
      }),
    ],
  },
  locales: [
    {
      lang: 'en',
      label: 'English',
      title: 'CyberBox',
      description: 'All-in-One Docker security workspace for hunters and agents',
    },
  ],
  themeConfig: {
    // hideNavbar: 'auto',
    socialLinks: [
      {
        icon: 'github',
        mode: 'link',
        content: 'https://github.com/ProwlrBot/CyberBox',
      },
    ],
    footer: {
      message: 'CyberBox · ProwlrBot © 2026',
    },
    locales: [
      {
        lang: 'en',
        label: 'English',
        editLink: {
          docRepoBaseUrl:
            'https://github.com/ProwlrBot/CyberBox/tree/main/website/docs',
          text: '📝 Edit this page on GitHub',
        },
        searchPlaceholderText: 'Search',
        searchPanelCancelText: 'Cancel',
        searchNoResultsText: 'No matching results',
        searchSuggestedQueryText: 'Try searching for different keywords',
      },
    ],
  },
  languageParity: {
    enabled: false,
    include: [],
    exclude: [],
  },
});
