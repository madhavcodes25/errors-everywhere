// The first-time welcome: three skippable steps and a sample-data button
// (switches the app to its built-in sample data so nothing needs installing).

import strings from "../copy/strings";

export function WelcomeSteps({ onSkip, onSampleData, sampleActive }) {
  return (
    <section className="welcome fade-up" aria-label="Welcome">
      <h2 className="panel-title">{strings.welcome.title}</h2>
      <div className="welcome-steps">
        {strings.welcome.steps.map((step, i) => (
          <div key={i}>
            <div className="welcome-step-num">{i + 1}</div>
            <div className="welcome-step-title">{step.title}</div>
            <div className="welcome-step-body">{step.body}</div>
          </div>
        ))}
      </div>
      <div className="welcome-actions">
        <button className="btn btn-primary" onClick={onSampleData} disabled={sampleActive}>
          {sampleActive ? strings.welcome.sample + " — on" : strings.welcome.sample}
        </button>
        <button className="btn" onClick={onSkip}>
          {strings.welcome.skip}
        </button>
      </div>
    </section>
  );
}
