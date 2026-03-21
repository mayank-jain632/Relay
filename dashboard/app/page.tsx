import Link from 'next/link';

const howItWorks = [
  {
    icon: '01',
    title: 'Task comes in from Slack',
    description: 'Turn a message or nudge into a tracked Relay task without opening another tool.'
  },
  {
    icon: '02',
    title: 'It appears inside VS Code',
    description: 'Developers see the task in their sidebar, linked to the right workspace and project context.'
  },
  {
    icon: '03',
    title: 'Start, branch, commit, PR',
    description: 'Relay carries the task from request to review so work moves forward without context switching.'
  }
];

const features = [
  {
    title: 'Slack-native task creation',
    description: 'Capture work where it starts, then keep Relay as the system of record across execution.'
  },
  {
    title: 'Auto branch creation',
    description: 'Developers can begin work from the task itself and move straight onto the right branch.'
  },
  {
    title: 'One-click PR flow',
    description: 'Open the PR path fast, push a task into review, and keep the team loop tight.'
  },
  {
    title: 'Team dashboard',
    description: 'PMs get visibility into setup, Slack connectivity, ownership, and delivery without noise.'
  }
];

const proofPoints = [
  'Built for teams that already live in Slack and VS Code',
  'Designed to reduce handoff friction between PMs and engineers',
  'Structured around developer execution rather than generic ticket churn'
];

export default function HomePage() {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <Link href="/" className="landing-brand" aria-label="Relay home">
          <span className="landing-brand-mark" />
          <span className="landing-brand-wordmark">Relay</span>
        </Link>

        <div className="landing-nav-actions">
          <Link className="button-secondary landing-nav-button" href="/login">
            Sign in
          </Link>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-kicker">Slack to merged PR, without losing the thread.</div>
          <h1 className="landing-title">From Slack message to merged PR, inside the editor.</h1>
          <p className="landing-subtitle">
            Relay turns requests from Slack into executable tasks in VS Code, then keeps branch, commit, and PR
            flow connected so teams can move without context switching.
          </p>

          <div className="landing-cta-row">
            <Link className="button-primary landing-cta-primary" href="/login">
              Get Started
            </Link>
            <Link
              className="button-secondary landing-cta-secondary"
              href="https://marketplace.visualstudio.com/items?itemName=Relay.relay-tasks"
              target="_blank"
              rel="noreferrer"
            >
              View on Marketplace
            </Link>
          </div>

          <div className="landing-proof-inline">
            <span className="landing-proof-pill">Slack-native intake</span>
            <span className="landing-proof-pill">VS Code workflow</span>
            <span className="landing-proof-pill">GitHub execution loop</span>
          </div>
        </div>

        <div className="landing-hero-visual">
          <div className="product-frame">
            <div className="product-frame-bar">
              <div className="product-frame-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="product-frame-title">Relay product demo</div>
            </div>

            <div className="product-frame-body">
              <aside className="product-sidebar">
                <div className="product-sidebar-title">Relay</div>
                <div className="product-sidebar-section">My Tasks</div>
                <div className="product-task-card active">
                  <div className="product-task-title">Fix retry logic</div>
                  <div className="product-task-meta">In review · GitHub linked</div>
                </div>
                <div className="product-task-card">
                  <div className="product-task-title">Ship billing alerts</div>
                  <div className="product-task-meta">Todo · From Slack</div>
                </div>
              </aside>

              <section className="product-main">
                <div className="product-slack-row">
                  <span className="product-badge">Slack</span>
                  <span className="product-slack-text">/nudge @mayank Fix retry logic before Friday</span>
                </div>

                <div className="product-flow-grid">
                  <div className="product-flow-step">
                    <div className="product-flow-label">Task</div>
                    <div className="product-flow-value">Appears instantly in the VS Code sidebar</div>
                  </div>
                  <div className="product-flow-step">
                    <div className="product-flow-label">Start</div>
                    <div className="product-flow-value">Creates branch ch/482-fix-retry-logic</div>
                  </div>
                  <div className="product-flow-step">
                    <div className="product-flow-label">PR</div>
                    <div className="product-flow-value">Moves to review and updates the team</div>
                  </div>
                </div>

                <div className="product-demo-note">
                  Drop a 10-second GIF or Loom capture into this frame later. The hero is already sized to convert well
                  once the real demo asset is ready.
                </div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>How it works</h2>
          <p>Relay stays close to the tools engineering already uses instead of forcing work into another disconnected app.</p>
        </div>
        <div className="landing-steps-grid">
          {howItWorks.map((step) => (
            <article key={step.icon} className="landing-step-card">
              <div className="landing-step-icon">{step.icon}</div>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-section-header">
          <h2>Feature highlights</h2>
          <p>Built around the actual execution layer between PMs, Slack, GitHub, and VS Code.</p>
        </div>
        <div className="landing-feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="landing-feature-card">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <div className="landing-quote-card">
          <div>
            <div className="landing-kicker">Built for dev teams who live in Slack</div>
            <h2>Relay closes the gap between a request and the code that ships.</h2>
          </div>
          <div className="landing-proof-list">
            {proofPoints.map((point) => (
              <div key={point} className="landing-proof-row">
                <span className="landing-proof-dot" />
                <span>{point}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="landing-final-cta">
        <div>
          <div className="landing-kicker">Ready to stop losing tasks in Slack?</div>
          <h2>Bring requests, execution, and review into one Relay workflow.</h2>
        </div>
        <Link className="button-primary landing-cta-primary" href="/login">
          Get Started
        </Link>
      </section>

      <footer className="landing-footer">
        <span>Relay</span>
        <div className="landing-footer-links">
          <Link href="/projects">Dashboard</Link>
          <Link href="https://marketplace.visualstudio.com/items?itemName=Relay.relay-tasks" target="_blank" rel="noreferrer">
            VS Code Marketplace
          </Link>
          <Link href="https://github.com/mayank-jain632/Relay" target="_blank" rel="noreferrer">
            GitHub
          </Link>
          <Link href="https://www.linkedin.com" target="_blank" rel="noreferrer">
            LinkedIn
          </Link>
        </div>
      </footer>
    </main>
  );
}
