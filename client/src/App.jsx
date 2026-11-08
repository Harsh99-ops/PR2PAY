import { useCallback, useEffect, useMemo, useState } from 'react';

const api = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.code = data.code;
    error.details = data.details;
    throw error;
  }
  return data;
};

const money = (amount, currency) => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(Number(amount)); }
  catch { return `${amount} ${currency}`; }
};
const dateTime = value => value ? new Date(value).toLocaleString() : '—';
const initials = value => String(value || 'PR').slice(0, 2).toUpperCase();

function Icon({ name, size = 18 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/></>,
    task: <><path d="M8 6h13M8 12h13M8 18h13"/><path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2"/></>,
    review: <><path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/></>,
    payment: <><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" transform="translate(-1 -1) scale(1.08)"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    github: <><path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 6v-3.9a3.4 3.4 0 0 0-.9-2.6c3-.3 6.1-1.5 6.1-6.7a5.2 5.2 0 0 0-1.4-3.6 4.8 4.8 0 0 0-.1-3.6s-1.2-.4-3.9 1.4a13.3 13.3 0 0 0-7 0C5.1 1.2 3.9 1.6 3.9 1.6a4.8 4.8 0 0 0-.1 3.6 5.2 5.2 0 0 0-1.4 3.6c0 5.2 3.1 6.4 6.1 6.7a3.4 3.4 0 0 0-.9 2.6V22"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    external: <><path d="M14 3h7v7M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6.5L20 12M4 12l2 5.5A7 7 0 0 0 18.4 15"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    logout: <><path d="M10 17l5-5-5-5M15 12H3"/><path d="M12 3h6a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-6"/></>
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.grid}</svg>;
}

function Login({ onLogin }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async event => {
    event.preventDefault(); setLoading(true); setError('');
    try { await onLogin(pin); } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return <div className="login-shell">
    <div className="login-card">
      <div className="brand-mark large">P<span>2</span>P</div>
      <div className="eyebrow">CONTRIBUTOR PAYMENTS</div>
      <h1>Welcome to PR2PAY.</h1>
      <p className="muted">Sign in as the project moderator to review contributions and authorize payouts.</p>
      <form onSubmit={submit} className="stack-form">
        <label>Moderator PIN<input autoFocus type="password" value={pin} onChange={e => setPin(e.target.value)} placeholder="Enter your moderator PIN" required /></label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn primary full" disabled={loading || !pin}>{loading ? 'Signing in…' : 'Unlock workspace'} <Icon name="arrow" size={16}/></button>
      </form>
      <div className="login-foot"><Icon name="lock" size={14}/> Private moderator workspace</div>
    </div>
  </div>;
}

function StatusPill({ status }) {
  const map = {
    eligible: ['Eligible', 'green'], not_eligible: ['Below threshold', 'red'], stale: ['Stale PR', 'amber'],
    approved_by_moderator: ['Approved', 'blue'], completed: ['Paid', 'green'], processing: ['Processing', 'blue'],
    submitting: ['Submitting', 'blue'], failed: ['Failed', 'red'], reconciliation_required: ['Needs review', 'amber'],
    pending: ['Pending', 'amber'], verification_failed: ['Review error', 'red']
  };
  const [label, color] = map[status] || [String(status || 'Unknown').replaceAll('_', ' '), 'gray'];
  return <span className={`status-pill ${color}`}><i/> {label}</span>;
}

function Modal({ children, onClose }) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-card">{children}</div>
  </div>;
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [view, setView] = useState('overview');
  const [health, setHealth] = useState(null);
  const [repository, setRepository] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [evaluations, setEvaluations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [overview, setOverview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [issueUrl, setIssueUrl] = useState('');
  const [taskId, setTaskId] = useState('');
  const [prUrl, setPrUrl] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [activeEvaluation, setActiveEvaluation] = useState(null);
  const [confirmPayment, setConfirmPayment] = useState(false);
  const [lastPayment, setLastPayment] = useState(null);

  const loadAll = useCallback(async () => {
    const [h, r, t, e, p, o] = await Promise.all([
      api('/api/health'), api('/api/repository'), api('/api/tasks'), api('/api/evaluations'), api('/api/payments'), api('/api/overview')
    ]);
    setHealth(h); setRepository(r); setRepoUrl(r.url || ''); setTasks(t); setEvaluations(e); setPayments(p); setOverview(o);
    setTaskId(current => current || t[0]?.id || '');
  }, []);

  useEffect(() => {
    api('/api/auth/me').then(async result => {
      setAuthenticated(result.authenticated);
      if (result.authenticated) await loadAll();
    }).catch(() => {}).finally(() => setCheckingAuth(false));
  }, [loadAll]);

  const runAction = async (action, successMessage) => {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (successMessage) setNotice(successMessage); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const login = async pin => {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ pin }) });
    setAuthenticated(true); await loadAll();
  };
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' });
    setAuthenticated(false); setTasks([]); setPayments([]); setEvaluations([]);
  };
  const connectRepo = async event => {
    event.preventDefault();
    await runAction(async () => {
      await api('/api/repository', { method: 'POST', body: JSON.stringify({ url: repoUrl }) });
      await loadAll(); setView('overview');
    }, 'GitHub repository connected. PR2PAY has read-only access.');
  };
  const importTask = async event => {
    event.preventDefault();
    await runAction(async () => {
      const task = await api('/api/tasks/import', { method: 'POST', body: JSON.stringify({ issueUrl }) });
      setTasks(current => [task, ...current.filter(item => item.id !== task.id)]);
      setTaskId(task.id); setIssueUrl(''); setView('tasks');
    }, 'GitHub Issue imported. Reward and criteria are locked to the Issue content.');
  };
  const evaluate = async event => {
    event.preventDefault();
    await runAction(async () => {
      const result = await api('/api/evaluations', { method: 'POST', body: JSON.stringify({ taskId, pullRequestUrl: prUrl, recipientEmail }) });
      setActiveEvaluation(result); setEvaluations(current => [result, ...current]); setPrUrl(''); setView('reviews');
    }, 'PR verification complete. Review the evidence before deciding.');
  };
  const approve = async () => {
    if (!activeEvaluation) return;
    await runAction(async () => {
      const result = await api(`/api/evaluations/${activeEvaluation.id}/approve`, { method: 'POST', body: JSON.stringify({}) });
      setActiveEvaluation(result); setEvaluations(current => current.map(item => item.id === result.id ? result : item)); setConfirmPayment(true);
    }, 'Moderator approval recorded. Payment still needs a separate confirmation.');
  };
  const sendPayment = async () => {
    if (!activeEvaluation) return;
    await runAction(async () => {
      const result = await api(`/api/evaluations/${activeEvaluation.id}/pay`, { method: 'POST', body: JSON.stringify({}) });
      setLastPayment(result); setPayments(current => [result, ...current.filter(item => item.id !== result.id)]); setConfirmPayment(false); setView('payments'); await loadAll();
    }, 'Payout request submitted to PayPal. Track its status below.');
  };
  const refreshPayment = async paymentId => runAction(async () => {
    const result = await api(`/api/payments/${paymentId}/refresh`, { method: 'POST', body: JSON.stringify({}) });
    setPayments(current => current.map(item => item.id === result.id ? result : item)); await loadAll();
  }, 'PayPal status refreshed.');
  const retryPayment = async payment => {
    const confirmed = window.confirm(`Retry the ${money(payment.amount, payment.currency)} payout to ${payment.recipient_email}? PR2PAY will first check PayPal's current status and only retry when PayPal's response permits it.`);
    if (!confirmed) return;
    await runAction(async () => {
      const result = await api(`/api/payments/${payment.id}/retry`, { method: 'POST', body: JSON.stringify({}) });
      setPayments(current => current.map(item => item.id === result.id ? result : item)); await loadAll();
    }, 'PayPal retry submitted using the saved payment record.');
  };

  const nav = [
    ['overview', 'Overview', 'grid'], ['tasks', 'Tasks', 'task'], ['reviews', 'PR reviews', 'review'], ['payments', 'Payments', 'payment'], ['settings', 'Settings', 'settings']
  ];
  const selectedTask = useMemo(() => tasks.find(item => item.id === taskId), [tasks, taskId]);

  if (checkingAuth) return <div className="loading-screen"><div className="spinner"/> Loading PR2PAY…</div>;
  if (!authenticated) return <Login onLogin={login}/>;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand-row"><div className="brand-mark">P<span>2</span>P</div><div><div className="brand-name">PR2PAY</div><div className="brand-caption">CONTRIBUTOR PAYMENTS</div></div></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="nav-list">
        {nav.map(([id, label, icon]) => <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => { setView(id); setError(''); setNotice(''); }}><Icon name={icon}/><span>{label}</span>{id === 'reviews' && overview?.pendingPayments > 0 && <b className="nav-count">{overview.pendingPayments}</b>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="repo-mini">
          <div className="repo-mini-icon"><Icon name="github" size={17}/></div>
          <div className="repo-mini-copy"><strong>{repository?.fullName || 'Repository not connected'}</strong><span>{repository?.branch ? `Branch · ${repository.branch}` : 'Connect a repository'}</span></div>
          <span className={`connection-dot ${repository?.verified ? 'online' : ''}`}/>
        </div>
        <button className="profile-row" onClick={logout}><div className="avatar">M</div><div className="profile-copy"><strong>Moderator</strong><span>Local workspace</span></div><Icon name="logout" size={16}/></button>
      </div>
    </aside>

    <main className="main-area">
      <header className="topbar"><div className="breadcrumb"><span>PR2PAY</span><b>/</b><strong>{nav.find(item => item[0] === view)?.[1]}</strong></div><div className="topbar-right"><span className={`env-badge ${health?.paypalMode === 'live' ? 'live' : ''}`}><i/>{health?.paypalMode === 'live' ? 'LIVE PAYMENTS' : 'PAYPAL SANDBOX'}</span><button className="icon-button" title="Refresh workspace" onClick={() => runAction(loadAll, 'Workspace refreshed.')}><Icon name="refresh"/></button></div></header>
      <div className="page-content">
        {error && <div className="alert error dismissible"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
        {notice && <div className="alert success dismissible"><span>{notice}</span><button onClick={() => setNotice('')}>×</button></div>}

        {view === 'overview' && <>
          <div className="page-heading"><div><div className="eyebrow">YOUR CONTRIBUTION PIPELINE</div><h1>Good work deserves to get paid.</h1><p>Verify code contributions against GitHub task criteria, then authorize the payout.</p></div><button className="btn primary" onClick={() => setView('reviews')}><Icon name="plus" size={16}/> Review a PR</button></div>
          {!repository?.verified && <div className="setup-banner"><div className="setup-icon"><Icon name="github" size={22}/></div><div className="setup-copy"><strong>Connect your GitHub repository</strong><span>PR2PAY will read its Issues and Pull Requests. It will never modify the repository.</span></div><button className="btn dark" onClick={() => setView('settings')}>Configure repository <Icon name="arrow" size={15}/></button></div>}
          <div className="metric-grid">
            <Metric label="Imported tasks" value={overview?.taskCount ?? 0} detail="GitHub Issues" icon="task"/>
            <Metric label="PRs evaluated" value={overview?.evalCount ?? 0} detail="AI-assisted reviews" icon="review"/>
            <Metric label="Eligible reviews" value={overview?.eligibleCount ?? 0} detail="60% or higher" icon="check"/>
            <Metric label="Completed payouts" value={overview?.completedPayments ?? 0} detail={`${overview?.pendingPayments ?? 0} in progress`} icon="payment"/>
          </div>
          <div className="content-grid">
            <section className="panel"><div className="panel-heading"><div><h2>Latest PR evaluations</h2><p>Human approval is required before every payout.</p></div><button className="text-button" onClick={() => setView('reviews')}>All reviews <Icon name="arrow" size={14}/></button></div>
              {overview?.latestEvaluations?.length ? <div className="table-wrap"><table><thead><tr><th>Pull Request</th><th>Task</th><th>Coverage</th><th>Status</th></tr></thead><tbody>{overview.latestEvaluations.map(row => <tr key={row.id} onClick={() => { setActiveEvaluation(row); setView('reviews'); }} className="click-row"><td><strong>#{row.pr_number} {row.pr_title}</strong><small>@{row.pr_author}</small></td><td>{row.task_title}</td><td><strong>{row.score}%</strong></td><td><StatusPill status={row.status}/></td></tr>)}</tbody></table></div> : <EmptyState title="No PRs reviewed yet" body="Import a task Issue, then submit a contributor’s Pull Request for verification." action="Start a review" onClick={() => setView('reviews')}/>}
            </section>
            <section className="panel flow-panel"><div className="panel-heading"><div><h2>How PR2PAY works</h2><p>A controlled path from code to payout.</p></div></div><div className="flow-list"><FlowStep n="01" title="Task from GitHub" body="Import an Issue with a fixed reward and acceptance checklist."/><FlowStep n="02" title="AI reviews the PR" body="OpenAI checks the diff against every acceptance criterion."/><FlowStep n="03" title="Moderator approves" body="A human reviews evidence and explicitly authorizes the payment."/><FlowStep n="04" title="PayPal sends the reward" body="Payout status is synchronized through PayPal APIs and webhooks." last/></div></section>
          </div>
          <div className="integration-strip"><IntegrationStatus name="GitHub" ok={repository?.verified} text={repository?.verified ? repository.fullName : 'Not connected'}/><IntegrationStatus name="OpenAI" ok={health?.openaiConfigured} text={health?.openaiConfigured ? 'API key configured' : 'Add API key in .env'}/><IntegrationStatus name="PayPal" ok={health?.paypalConfigured} text={health?.paypalConfigured ? `${health.paypalMode} credentials configured` : 'Add API credentials in .env'}/></div>
        </>}

        {view === 'settings' && <>
          <div className="page-heading"><div><div className="eyebrow">CONFIGURATION</div><h1>Workspace settings</h1><p>Connect one repository and configure the API credentials locally.</p></div></div>
          <div className="settings-grid">
            <section className="panel settings-panel"><div className="panel-heading"><div><h2><Icon name="github"/> GitHub repository</h2><p>One target repository for this PR2PAY workspace.</p></div><StatusPill status={repository?.verified ? 'completed' : 'pending'}/></div>
              <form className="stack-form" onSubmit={connectRepo}><label>Repository URL<input value={repoUrl} onChange={e => setRepoUrl(e.target.value)} placeholder="https://github.com/owner/repository/tree/branch" required/></label><p className="field-hint">Your repository URL is prefilled. A /tree/branch URL sets the PR target branch. Public repositories work without a token; private repositories need a read-only GitHub token in .env.</p><button className="btn primary" disabled={busy}>{busy ? 'Connecting…' : 'Verify and connect repository'} <Icon name="arrow" size={15}/></button></form>
              {repository?.verified && <div className="connected-repo"><span className="check-circle"><Icon name="check" size={14}/></span><div><strong>{repository.fullName}</strong><span>Target branch: {repository.branch}</span></div><a href={`https://github.com/${repository.fullName}`} target="_blank" rel="noreferrer"><Icon name="external" size={15}/></a></div>}
              <div className="notice-box"><strong>Read-only GitHub access</strong><span>PR2PAY only reads Issues, Pull Requests, diffs and CI check results. It never creates comments, reviews, commits, labels, merges or closes anything.</span></div>
            </section>
            <section className="panel settings-panel"><div className="panel-heading"><div><h2>API connections</h2><p>Secrets stay on your local server in .env.</p></div></div>
              <ConnectionRow title="OpenAI API" value={health?.openaiConfigured ? 'Configured' : 'Not configured'} ok={health?.openaiConfigured} detail="Used only to evaluate the PR against task criteria."/>
              <ConnectionRow title="PayPal Payouts" value={health?.paypalConfigured ? `${health.paypalMode} mode` : 'Not configured'} ok={health?.paypalConfigured} detail="Sandbox is recommended for testing before live credentials."/>
              <ConnectionRow title="PayPal Webhooks" value={health?.webhookConfigured ? 'Webhook ID saved' : 'Webhook ID missing'} ok={health?.webhookConfigured} detail="Webhook events are signature-verified before updating payment status."/>
              <div className="env-hint"><strong>Where do I add keys?</strong><code>PR2PAY/.env</code><span>Copy .env.example to .env, add your keys, and restart the server. Never paste secrets into the browser or commit them to GitHub.</span></div>
            </section>
          </div>
        </>}

        {view === 'tasks' && <>
          <div className="page-heading"><div><div className="eyebrow">GITHUB ISSUES</div><h1>Tasks & rewards</h1><p>Import an Issue. Reward and acceptance criteria are read from its description.</p></div></div>
          <section className="panel import-panel"><div className="import-intro"><div className="import-icon"><Icon name="plus" size={19}/></div><div><h2>Import a GitHub Issue</h2><p>Paste an open Issue URL from the connected repository.</p></div></div><form className="inline-form" onSubmit={importTask}><input value={issueUrl} onChange={e => setIssueUrl(e.target.value)} placeholder={`https://github.com/${repository?.fullName || 'owner/repo'}/issues/12`} required/><button className="btn primary" disabled={busy}>{busy ? 'Importing…' : 'Import Issue'} <Icon name="arrow" size={15}/></button></form><div className="issue-format"><div className="format-head"><strong>Expected Issue format</strong><span>Reward must be near the top</span></div><pre>{`Reward: 25.00 USD\n\n## Task\nImplement the requested feature.\n\n## Acceptance Criteria\n- [ ] First requirement\n- [ ] Second requirement\n- [ ] Third requirement`}</pre><p>PR2PAY parses the amount itself; the LLM does not set or modify the payout amount.</p></div></section>
          <div className="section-title-row"><div><h2>Imported tasks</h2><span>{tasks.length} task{tasks.length === 1 ? '' : 's'}</span></div></div>
          {tasks.length ? <div className="task-grid">{tasks.map(task => <TaskCard key={task.id} task={task} onReview={() => { setTaskId(task.id); setView('reviews'); }}/>)}</div> : <section className="panel"><EmptyState title="No tasks imported" body="Create an Issue in your GitHub repository using the format above, then import its URL here." action="Connect repository" onClick={() => setView('settings')}/></section>}
        </>}

        {view === 'reviews' && <>
          <div className="page-heading"><div><div className="eyebrow">CONTRIBUTION VERIFICATION</div><h1>Review a Pull Request</h1><p>Submit a PR URL and contributor PayPal email. AI assesses the evidence; you control approval.</p></div></div>
          <section className="panel review-form-panel"><div className="panel-heading"><div><h2>Start a verification</h2><p>Only PRs targeting the configured repository branch are accepted.</p></div><span className="ai-tag">✦ OPENAI REVIEW</span></div>
            <form className="review-form" onSubmit={evaluate}><label>Task / GitHub Issue<select value={taskId} onChange={e => setTaskId(e.target.value)} required><option value="">Select an imported task</option>{tasks.map(task => <option key={task.id} value={task.id}>#{task.issue_number} · {task.title} · {money(task.reward_amount, task.currency)}</option>)}</select></label><div className="form-two"><label>Pull Request URL<input type="url" value={prUrl} onChange={e => setPrUrl(e.target.value)} placeholder={`https://github.com/${repository?.fullName || 'owner/repo'}/pull/42`} required/></label><label>Contributor PayPal email<input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} placeholder="contributor@example.com" required/></label></div>
              {selectedTask && <div className="task-selection"><div><span>Fixed task reward</span><strong>{money(selectedTask.reward_amount, selectedTask.currency)}</strong></div><div><span>Acceptance criteria</span><strong>{selectedTask.criteria.length} checks</strong></div><a href={selectedTask.issue_url} target="_blank" rel="noreferrer">Open Issue <Icon name="external" size={13}/></a></div>}
              <button className="btn primary" disabled={busy || !tasks.length || !repository?.verified}>{busy ? 'Reviewing code…' : 'Run AI verification'} <Icon name="arrow" size={16}/></button>
              {!health?.openaiConfigured && <div className="alert warning">OpenAI is not configured. Add OPENAI_API_KEY to .env before running a real evaluation.</div>}
            </form>
          </section>
          {activeEvaluation && <EvaluationReport evaluation={activeEvaluation} onApprove={approve} onPay={() => setConfirmPayment(true)} busy={busy}/>}
          {!activeEvaluation && evaluations.length > 0 && <section className="panel"><div className="panel-heading"><div><h2>Recent evaluations</h2><p>Select a result to inspect its evidence.</p></div></div><div className="evaluation-list">{evaluations.slice(0, 12).map(item => <button key={item.id} className="evaluation-row" onClick={() => setActiveEvaluation(item)}><div className="pr-avatar">{initials(item.pr_author)}</div><div className="evaluation-row-copy"><strong>#{item.pr_number} {item.pr_title}</strong><span>{item.task_title || tasks.find(task => task.id === item.task_id)?.title || 'Task'} · @{item.pr_author}</span></div><strong className="score-number">{item.score}%</strong><StatusPill status={item.status}/></button>)}</div></section>}
        </>}

        {view === 'payments' && <>
          <div className="page-heading"><div><div className="eyebrow">PAYPAL PAYOUTS</div><h1>Payment activity</h1><p>Every payout is linked to a verified PR and a moderator approval.</p></div><span className={`env-badge ${health?.paypalMode === 'live' ? 'live' : ''}`}><i/>{health?.paypalMode === 'live' ? 'LIVE' : 'SANDBOX'}</span></div>
          {!health?.paypalConfigured && <div className="setup-banner compact"><div className="setup-icon"><Icon name="payment"/></div><div className="setup-copy"><strong>PayPal credentials not added</strong><span>Complete the Sandbox Client ID and Secret in your .env file to send test payouts.</span></div><button className="btn dark" onClick={() => setView('settings')}>View setup <Icon name="arrow" size={15}/></button></div>}
          <section className="panel"><div className="panel-heading"><div><h2>Payout ledger</h2><p>Refresh a batch to retrieve the latest PayPal status.</p></div><span className="count-label">{payments.length} records</span></div>
            {payments.length ? <div className="payment-list">{payments.map(payment => <PaymentCard key={payment.id} payment={payment} onRefresh={() => refreshPayment(payment.id)} onRetry={() => retryPayment(payment)} busy={busy}/>)}</div> : <EmptyState title="No payouts yet" body="Once a PR is eligible and approved, its payout will appear here." action="Review a PR" onClick={() => setView('reviews')}/>}
          </section>
        </>}
      </div>
      <footer className="footer"><span>PR2PAY · Verify work. Approve payment.</span><span>GitHub is read-only · AI cannot authorize money movement</span></footer>
    </main>

    {confirmPayment && activeEvaluation && <Modal onClose={() => setConfirmPayment(false)}><div className="modal-eyebrow">FINAL PAYMENT AUTHORIZATION</div><div className="modal-icon"><Icon name="payment" size={24}/></div><h2>Send this contributor reward?</h2><p className="modal-copy">The AI has no payment authority. This action sends the fixed Issue reward through your configured PayPal account.</p><div className="payment-summary"><div><span>Contributor</span><strong>@{activeEvaluation.pr_author}</strong></div><div><span>PayPal recipient</span><strong>{activeEvaluation.recipient_email}</strong></div><div><span>Pull Request</span><strong>#{activeEvaluation.pr_number}</strong></div><div><span>AI coverage</span><strong>{activeEvaluation.score}%</strong></div><div className="summary-amount"><span>Approved task reward</span><strong>{money(activeEvaluation.reward_amount, activeEvaluation.currency)}</strong></div></div><div className="modal-warning"><Icon name="lock" size={15}/> This submits a real Sandbox/Live PayPal payout request. Confirm the recipient and amount.</div>{error && <div className="alert error modal-error">{error}</div>}<div className="modal-actions"><button className="btn secondary" onClick={() => setConfirmPayment(false)}>Cancel</button><button className="btn primary" disabled={busy || !health?.paypalConfigured} onClick={sendPayment}>{busy ? 'Submitting…' : 'Confirm & send payout'} <Icon name="arrow" size={15}/></button></div>{!health?.paypalConfigured && <p className="modal-footnote">Configure PayPal credentials first in Settings. Nothing has been sent.</p>}</Modal>}
  </div>;
}

function Metric({ label, value, detail, icon }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><span className="metric-icon"><Icon name={icon}/></span></div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></div>;
}
function FlowStep({ n, title, body, last }) { return <div className={`flow-step ${last ? 'last' : ''}`}><span className="flow-number">{n}</span><div><strong>{title}</strong><p>{body}</p></div><span className="flow-line"/></div>; }
function IntegrationStatus({ name, ok, text }) { return <div className="integration-item"><span className={`integration-dot ${ok ? 'online' : ''}`}/><div><strong>{name}</strong><span>{text}</span></div></div>; }
function ConnectionRow({ title, value, ok, detail }) { return <div className="connection-row"><span className={`connection-check ${ok ? 'ok' : ''}`}>{ok ? <Icon name="check" size={13}/> : '!'}</span><div><strong>{title}</strong><span>{detail}</span></div><b>{value}</b></div>; }
function EmptyState({ title, body, action, onClick }) { return <div className="empty-state"><div className="empty-illustration"><Icon name="github" size={25}/></div><h3>{title}</h3><p>{body}</p>{action && <button className="text-button" onClick={onClick}>{action} <Icon name="arrow" size={14}/></button>}</div>; }
function TaskCard({ task, onReview }) { return <article className="task-card"><div className="task-card-top"><span className="issue-number">ISSUE #{task.issue_number}</span><a href={task.issue_url} target="_blank" rel="noreferrer"><Icon name="external" size={14}/></a></div><h3>{task.title}</h3><div className="task-reward"><span>FIXED REWARD</span><strong>{money(task.reward_amount, task.currency)}</strong></div><div className="criteria-list"><span>{task.criteria.length} acceptance criteria</span>{task.criteria.slice(0, 3).map(item => <div key={item.id}><span className="mini-check"><Icon name="check" size={11}/></span>{item.description}</div>)}{task.criteria.length > 3 && <small>+{task.criteria.length - 3} more criteria</small>}</div><button className="btn secondary full" onClick={onReview}>Evaluate a PR <Icon name="arrow" size={14}/></button></article>; }
function EvaluationReport({ evaluation, onApprove, onPay, busy }) {
  const result = evaluation.result || {};
  return <section className="panel report-panel"><div className="report-header"><div><div className="eyebrow">AI VERIFICATION REPORT</div><h2>PR #{evaluation.pr_number} · {evaluation.pr_title}</h2><p>@{evaluation.pr_author} · <a href={evaluation.pr_url} target="_blank" rel="noreferrer">View Pull Request <Icon name="external" size={13}/></a></p></div><StatusPill status={evaluation.status}/></div>
    <div className="report-score"><div className="score-ring" style={{'--score': `${evaluation.score}%`}}><div><strong>{evaluation.score}%</strong><span>coverage</span></div></div><div className="score-summary"><h3>{evaluation.score >= 60 ? 'Meets the eligibility threshold' : 'Below the eligibility threshold'}</h3><p>{result.summary || 'No summary was provided.'}</p><div className="score-legend"><span><i className="passed"/>{result.passed ?? 0} passed</span><span><i className="failed"/>{(result.criteria || []).filter(item => item.status === 'failed').length} failed</span><span><i className="unknown"/>{(result.criteria || []).filter(item => item.status === 'inconclusive').length} inconclusive</span></div></div></div>
    <div className="criteria-report"><div className="subsection-heading"><h3>Acceptance criteria</h3><span>{result.total || result.criteria?.length || 0} checks · equal weight</span></div>{(result.criteria || []).map(item => <div className="criterion-row" key={item.id}><div className={`criterion-symbol ${item.status}`}>{item.status === 'passed' ? <Icon name="check" size={14}/> : item.status === 'failed' ? '×' : '?'}</div><div className="criterion-copy"><strong>{item.id}. {item.description}</strong><p>{item.evidence}</p></div><span className={`criterion-status ${item.status}`}>{item.status}</span></div>)}</div>
    {result.risks?.length > 0 && <div className="risks-box"><strong>Review notes & risks</strong>{result.risks.map((risk, index) => <p key={index}>• {risk}</p>)}</div>}
    <div className="report-footer"><div><strong>Reward: {money(evaluation.reward_amount || '0', evaluation.currency || 'USD')}</strong><span>Set by the GitHub Issue; not generated by AI.</span></div>{evaluation.status === 'eligible' ? <button className="btn primary" onClick={onApprove} disabled={busy}>Moderator approve <Icon name="arrow" size={15}/></button> : evaluation.status === 'approved_by_moderator' ? <button className="btn primary" onClick={onPay}>Confirm payment <Icon name="arrow" size={15}/></button> : <span className="muted small">No payout action is available for this result.</span>}</div>
    <div className="sha-note">Verified commit <code>{evaluation.head_sha?.slice(0, 12) || '—'}</code> · Rechecked before approval and payout</div>
  </section>;
}
function PaymentCard({ payment, onRefresh, onRetry, busy }) {
  const canRetry = ['failed', 'reconciliation_required'].includes(payment.status) && payment.retry_mode !== 'none';
  return <article className="payment-card"><div className="payment-card-main"><div className="payment-symbol"><Icon name="payment"/></div><div className="payment-meta"><strong>{payment.task_title || 'Contribution reward'}</strong><span>PR #{payment.pr_number} · @{payment.pr_author} · {payment.recipient_email}</span><small>Created {dateTime(payment.created_at)} · {payment.attempts} attempt{payment.attempts === 1 ? '' : 's'}</small></div></div><div className="payment-card-amount"><strong>{money(payment.amount, payment.currency)}</strong><StatusPill status={payment.status}/></div><div className="payment-card-actions"><button className="btn tiny secondary" onClick={onRefresh} disabled={busy || !payment.payout_batch_id}><Icon name="refresh" size={13}/> Refresh status</button>{canRetry && <button className="btn tiny dark" onClick={onRetry} disabled={busy}><Icon name="refresh" size={13}/> Retry with PayPal safeguards</button>}</div>{payment.paypal_status && <div className="payment-technical">PayPal status: <code>{payment.paypal_status}</code> {payment.payout_batch_id && <>· Batch <code>{payment.payout_batch_id}</code></>}</div>}{payment.error_message && <div className="payment-error">{payment.error_message}</div>}</article>;
}
