import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  developerSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Foundations',
      items: ['foundations/mental-model', 'foundations/agent-neutrality', 'foundations/security-model'],
    },
    {
      type: 'category',
      label: 'Build with CUP',
      items: ['build/installation', 'build/first-resource', 'build/read-data', 'build/execute-action'],
    },
    {
      type: 'category',
      label: 'Policies and access',
      items: ['policies/authorization', 'policies/scopes-and-redaction', 'policies/delegation', 'policies/conditions-and-expiration'],
    },
    {
      type: 'category',
      label: 'External runtimes',
      items: ['runtimes/agent-resources', 'runtimes/runtime-adapters', 'runtimes/mcp-server'],
    },
    {
      type: 'category',
      label: 'Architecture and persistence',
      items: ['architecture/source-architecture', 'architecture/data-model'],
    },
    {
      type: 'category',
      label: 'Operations',
      items: ['operations/receipts', 'operations/subscriptions', 'operations/testing', 'operations/production-checklist'],
    },
    'api-reference',
  ],
};

export default sidebars;
