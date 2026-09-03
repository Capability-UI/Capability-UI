import type {ReactNode} from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';

export default function Home(): ReactNode {
  return (
    <Layout title="Developer documentation" description="Build permission-aware software with the Capability UI Protocol">
      <main className="container margin-vert--xl">
        <header className="hero hero--primary padding-vert--lg">
          <div className="container">
            <p className="hero__subtitle">Capability UI Protocol v0.1</p>
            <h1 className="hero__title">Build with data, actions, and explicit permissions.</h1>
            <p className="hero__subtitle">CUP gives applications a typed contract for what people and external assistants may discover, read, and do.</p>
            <Link className="button button--secondary button--lg" to="/docs/intro">Read the developer guide</Link>
          </div>
        </header>
        <section className="row margin-top--xl">
          <div className="col col--4"><h2>Agent-neutral</h2><p>Use CUP around any existing assistant, workflow runtime, or ordinary application code. CUP governs access. It does not create or manage agents.</p></div>
          <div className="col col--4"><h2>Runtime-safe</h2><p>Separate discovery, reading, preparation, confirmation, execution, and receipts. Re-check consequential actions immediately before they run.</p></div>
          <div className="col col--4"><h2>Copyable examples</h2><p>Every guide includes complete TypeScript examples with imports, definitions, policy, runtime calls, and error handling.</p></div>
        </section>
      </main>
    </Layout>
  );
}
