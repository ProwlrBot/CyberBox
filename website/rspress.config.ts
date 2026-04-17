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
        image: 'https://rspress.rs/og-image.png',
        description: 'Rsbuild based static site generator',
        twitter: {
          site: '@rspack_dev',
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
    {
      lang: 'zh',
      label: '简体中文',
      title: 'CyberBox',
      description: '面向安全研究与 AI Agent 的一体化 Docker 沙盒',
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
      {
        lang: 'zh',
        label: '简体中文',
        editLink: {
          docRepoBaseUrl:
            'https://github.com/ProwlrBot/CyberBox/tree/main/website/docs',
          text: '📝 在 GitHub 上编辑此页',
        },
        searchPlaceholderText: '搜索',
        searchPanelCancelText: '取消',
        searchNoResultsText: '未找到匹配的结果',
        searchSuggestedQueryText: '尝试搜索其他关键词',
        overview: {
          filterNameText: '过滤',
          filterPlaceholderText: '输入关键词',
          filterNoResultText: '未找到匹配的 API',
        },
      },
    ],
  },
  languageParity: {
    enabled: false,
    include: [],
    exclude: [],
  },
});
