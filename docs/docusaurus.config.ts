import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Capability UI Protocol',
  tagline: 'Agent-neutral permissions for data, tools, and generated interfaces',
  favicon: 'img/favicon.ico',
  url: 'https://capability-ui.github.io',
  baseUrl: '/Capability-UI/',
  organizationName: 'Capability-UI',
  projectName: 'Capability-UI',
  onBrokenLinks: 'throw',
  markdown: { mermaid: true, hooks: { onBrokenMarkdownLinks: 'throw' } },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/Capability-UI/Capability-UI/tree/main/docs/',
          showLastUpdateTime: true,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'CUP',
      items: [
        { type: 'docSidebar', sidebarId: 'developerSidebar', position: 'left', label: 'Documentation' },
        { href: 'https://github.com/Capability-UI/Capability-UI', label: 'GitHub', position: 'right' },
      ],
    },
    prism: { additionalLanguages: ['bash', 'json', 'typescript'] },
  } satisfies Preset.ThemeConfig,
};

export default config;
