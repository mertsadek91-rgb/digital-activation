// Renders every dashboard page from canonical state.
// Served by `pnpm pm:dashboard` it fetches /api/state, computed live from
// agent-os/state/events.jsonl on every request, so it never shows stale status.
// Opened from file:// it falls back to data.js, a snapshot written by `pm sync`,
// and is read-only. Plain script, no build step.
(async function () {
  'use strict';

  let D = window.PM_DATA;
  if (location.protocol.startsWith('http')) {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.ok) D = await r.json();
    } catch {
      /* fall back to the data.js snapshot */
    }
  }
  // The owner link carries a one-time token in the fragment; keep it for this
  // tab only and take it out of the address bar.
  const ownerHash = /#owner=([\w-]+)/.exec(location.hash);
  if (ownerHash) {
    sessionStorage.setItem('pm-owner-token', ownerHash[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const root = document.getElementById('app');
  const view = document.body.dataset.view;

  if (!D) {
    root.innerHTML =
      '<p class="empty">No data. Run <code>pnpm pm sync</code>, or serve the dashboard with <code>pnpm pm:dashboard</code>.</p>';
    return;
  }

  // ------------------------------------------------------------------ helpers

  const esc = (v) =>
    String(v ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  const people = { ...D.permissions.managers, ...D.permissions.roles };
  const who = (id) => (id ? (people[id]?.title ?? id) : '—');
  const date = (s) => (s ? String(s).slice(0, 10) : '—');
  const params = new URLSearchParams(location.search);

  const TONE = {
    COMPLETED: 'ok',
    READY_FOR_RELEASE: 'ok',
    HEALTHY: 'ok',
    APPROVED: 'ok',
    ACTIVE: 'ok',
    FIXED: 'ok',
    VERIFIED: 'ok',
    IN_PROGRESS: 'accent',
    WORKING: 'accent',
    REVIEWING: 'info',
    MANAGER_REVIEW: 'info',
    CROSS_MANAGER_REVIEW: 'info',
    QA: 'info',
    SECURITY_REVIEW: 'info',
    REGRESSION_TESTING: 'info',
    PROPOSED: 'info',
    IN_REVIEW: 'info',
    OPEN: 'warn',
    WAITING_DEPENDENCY: 'warn',
    WAITING_INFORMATION: 'warn',
    REVISION_REQUIRED: 'warn',
    ATTENTION_REQUIRED: 'warn',
    WAITING: 'warn',
    HIGH: 'risk',
    AT_RISK: 'risk',
    CRITICAL: 'block',
    BLOCKED: 'block',
    MEDIUM: 'warn',
    LOW: 'ok',
  };
  const st = (v) =>
    v == null ? '—' : `<span class="st" data-t="${TONE[v] ?? ''}">${esc(v)}</span>`;
  const bar = (p) =>
    `<span class="bar" aria-hidden="true"><i style="width:${Number(p) || 0}%"></i></span>${Number(p) || 0}%`;
  const link = (id) => {
    if (!id) return '—';
    const pages = {
      TASK: 'task-details.html?id=',
      BUG: 'issues.html?id=',
      CR: 'changes.html?id=',
      DEC: 'decisions.html?id=',
      CONSENSUS: 'consensus.html?id=',
      EPIC: 'epics.html?id=',
      MILESTONE: 'milestones.html?id=',
      OPP: 'opportunity.html?id=',
      SIG: 'signals.html?id=',
      INS: 'signals.html?id=',
      REL: 'releases.html?id=',
    };
    const p = pages[String(id).split('-')[0]];
    return p ? `<a class="mono" href="${p}${encodeURIComponent(id)}">${esc(id)}</a>` : esc(id);
  };
  const links = (xs) =>
    xs && xs.length ? xs.map(link).join(', ') : '<span class="muted">—</span>';

  // Minimal Markdown: headings, lists, tables, code, bold, inline code, links.
  function md(src) {
    const lines = String(src || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .split(/\r?\n/);
    const out = [];
    let i = 0;
    const inline = (s) =>
      esc(s)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, h) =>
          /^(https?:|\.|\/|#)/.test(h) || !/:/.test(h) ? `<a href="${h}">${t}</a>` : t,
        )
        .replace(/\b((?:TASK|BUG|CR|DEC|CONSENSUS|EPIC|MILESTONE|OPP|SIG|INS|REL)-\d{4})\b/g, (m) =>
          link(m),
        );
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      const h = /^(#{1,4})\s+(.*)$/.exec(l);
      if (h) {
        const n = Math.min(h[1].length + 1, 4);
        out.push(`<h${n}>${inline(h[2])}</h${n}>`);
        i++;
        continue;
      }
      if (/^\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) =>
          r
            .replace(/^\||\|$/g, '')
            .split('|')
            .map((c) => c.trim());
        const body = rows.filter((r) => !/^\|[\s:|-]+\|$/.test(r));
        const [head, ...rest] = body;
        out.push(
          `<div class="table-wrap"><table><thead><tr>${cells(head)
            .map((c) => `<th>${inline(c)}</th>`)
            .join('')}</tr></thead><tbody>${rest
            .map(
              (r) =>
                `<tr>${cells(r)
                  .map((c) => `<td>${inline(c)}</td>`)
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table></div>`,
        );
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        const ordered = /^\s*\d+\./.test(l);
        const items = [];
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]))
          items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
        const tag = ordered ? 'ol' : 'ul';
        out.push(
          `<${tag}>${items
            .map((x) =>
              inline(x)
                .replace(/^\[ \]\s*/, '☐ ')
                .replace(/^\[x\]\s*/i, '☑ '),
            )
            .map((x) => `<li>${x}</li>`)
            .join('')}</${tag}>`,
        );
        continue;
      }
      if (!l.trim()) {
        i++;
        continue;
      }
      const para = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s)/.test(lines[i])
      )
        para.push(lines[i++]);
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
    return out.join('\n');
  }

  // Sortable, filterable table.
  function table(rows, cols, opts = {}) {
    const id = 't' + Math.random().toString(36).slice(2, 8);
    let sortKey = opts.sort ?? cols[0].key;
    let dir = 1;
    let filtered = rows;
    const wrap = document.createElement('div');
    if (opts.filters) {
      const tb = document.createElement('div');
      tb.className = 'toolbar';
      tb.innerHTML =
        `<input type="search" placeholder="Filter…" aria-label="Filter rows">` +
        opts.filters
          .map(
            (f) =>
              `<select aria-label="${esc(f.label)}" data-k="${f.key}"><option value="">${esc(f.label)}: all</option>${[
                ...new Set(rows.map((r) => r[f.key]).filter(Boolean)),
              ]
                .sort()
                .map((v) => `<option>${esc(v)}</option>`)
                .join('')}</select>`,
          )
          .join('');
      const apply = () => {
        const q = tb.querySelector('input').value.toLowerCase();
        const sel = [...tb.querySelectorAll('select')].map((s) => [s.dataset.k, s.value]);
        filtered = rows.filter(
          (r) =>
            (!q || JSON.stringify(r).toLowerCase().includes(q)) &&
            sel.every(([k, v]) => !v || r[k] === v),
        );
        draw();
      };
      tb.addEventListener('input', apply);
      wrap.appendChild(tb);
    }
    const tw = document.createElement('div');
    tw.className = 'table-wrap';
    wrap.appendChild(tw);
    function draw() {
      const sorted = [...filtered].sort((a, b) => {
        const x = a[sortKey];
        const y = b[sortKey];
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x ?? '').localeCompare(String(y ?? '')) * dir;
      });
      tw.innerHTML = sorted.length
        ? `<table id="${id}"><thead><tr>${cols
            .map(
              (c) =>
                `<th data-k="${c.key}" aria-sort="${c.key === sortKey ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.label)}</th>`,
            )
            .join('')}</tr></thead><tbody>${sorted
            .map(
              (r) =>
                `<tr>${cols
                  .map(
                    (c) =>
                      `<td class="${c.cls ?? ''}">${c.render ? c.render(r[c.key], r) : esc(r[c.key] ?? '—')}</td>`,
                  )
                  .join('')}</tr>`,
            )
            .join('')}</tbody></table>`
        : `<p class="empty">${esc(opts.empty ?? 'Nothing here.')}</p>`;
      tw.querySelectorAll('th').forEach((th) =>
        th.addEventListener('click', () => {
          const k = th.dataset.k;
          dir = k === sortKey ? -dir : 1;
          sortKey = k;
          draw();
        }),
      );
    }
    draw();
    return wrap;
  }

  const section = (title, node) => {
    const s = document.createElement('section');
    s.innerHTML = `<h2>${esc(title)}</h2>`;
    if (typeof node === 'string') s.insertAdjacentHTML('beforeend', node);
    else s.appendChild(node);
    return s;
  };

  // --------------------------------------------------------------- shell/nav

  const NAV = [
    ['index', 'Overview'],
    ['tasks', 'Tasks', D.tasks.length],
    ['kanban', 'Kanban'],
    ['agents', 'Agents', D.agents.filter((a) => a.staffed).length],
    ['managers', 'Managers', D.managers.length],
    ['epics', 'Epics', D.epics.length],
    ['milestones', 'Milestones', D.milestones.length],
    ['issues', 'Issues', D.issues.filter((i) => i.status === 'OPEN').length],
    ['changes', 'Changes', D.changes.length],
    ['decisions', 'Decisions', D.decisions.length],
    ['consensus', 'Consensus', D.consensus.length],
    [
      'opportunities',
      'Discovery',
      (D.opportunities || []).filter((o) => o.status === 'READY_FOR_OWNER_DECISION').length || null,
    ],
    ['signals', 'Signals & watchlist', (D.signals || []).length || null],
    ['radar', 'Opportunity radar'],
    ['portfolio', 'Portfolio'],
    ['reviews', 'Reviews', (D.reviews || []).length || null],
    ['risks', 'Risks'],
    ['security', 'Security'],
    ['releases', 'Releases'],
    ['files', 'Files'],
    ['timeline', 'Timeline'],
    ['reports', 'Reports'],
    ['permissions', 'Permissions'],
  ];
  const navEl = document.querySelector('nav.side');
  navEl.innerHTML =
    `<div class="brand">${esc(D.config.project_name)}</div><div class="sub">Project control · synced ${esc(D.generated_at.replace('T', ' ').slice(0, 16))} UTC</div>` +
    NAV.map(
      ([p, label, n]) =>
        `<a href="${p}.html"${p === view || (view === 'task-details' && p === 'tasks') || (['opportunity', 'compare'].includes(view) && p === 'opportunities') ? ' aria-current="page"' : ''}>${esc(label)}${n != null ? `<span class="count">${n}</span>` : ''}</a>`,
    ).join('');

  function page(title, meta) {
    document.title = `${title} · ${D.config.project_name}`;
    root.insertAdjacentHTML(
      'beforeend',
      `<header class="page"><h1>${esc(title)}</h1>${meta ? `<span class="meta">${meta}</span>` : ''}</header>`,
    );
  }

  const taskCols = [
    { key: 'id', label: 'Task ID', cls: 'id', render: (v) => link(v) },
    { key: 'title', label: 'Title' },
    { key: 'type', label: 'Type', cls: 'muted' },
    { key: 'status', label: 'Status', render: st },
    { key: 'stage', label: 'Stage', cls: 'muted' },
    { key: 'priority', label: 'Priority', render: st },
    { key: 'progress', label: 'Progress', render: bar },
    { key: 'primary_agent', label: 'Primary agent', render: who },
    { key: 'responsible_manager', label: 'Manager', cls: 'mono' },
    { key: 'authority_level', label: 'Auth.', cls: 'num', render: (v) => `L${v}` },
    { key: 'risk', label: 'Risk', render: st },
    { key: 'related_epic', label: 'Epic', render: link },
    { key: 'related_milestone', label: 'Milestone', render: link },
    {
      key: 'affected_modules',
      label: 'Module',
      cls: 'muted',
      render: (v) => esc((v || []).join(', ')),
    },
    { key: 'dependencies', label: 'Depends on', render: links },
    { key: 'updated_at', label: 'Updated', cls: 'mono', render: date },
  ];
  const taskFilters = [
    { key: 'status', label: 'Status' },
    { key: 'priority', label: 'Priority' },
    { key: 'responsible_manager', label: 'Manager' },
    { key: 'related_milestone', label: 'Milestone' },
  ];

  function problemsBox() {
    if (!D.problems.length) return '';
    return `<div class="problems"><strong>${D.problems.length} governance problem(s) reported by sync</strong><ul>${D.problems
      .map((p) => `<li>${esc(p)}</li>`)
      .join('')}</ul></div>`;
  }

  function detail(item, fields) {
    const dl = fields
      .map(
        ([k, label, r]) =>
          `<dt>${esc(label)}</dt><dd>${r ? r(item[k], item) : esc(item[k] ?? '—')}</dd>`,
      )
      .join('');
    root.insertAdjacentHTML('beforeend', `<dl class="kv">${dl}</dl>`);
    root.insertAdjacentHTML(
      'beforeend',
      `<h2>Record</h2><div class="doc">${md(D.bodies[item.id])}</div><p class="muted">Source: <code>project-management/${esc(item.file)}</code></p>`,
    );
  }

  // Generic list-or-detail page for issues, changes, decisions, consensus, epics, milestones.
  function registry(rows, title, cols, fields, filters) {
    const id = params.get('id');
    const item = id && rows.find((r) => r.id === id);
    if (item) {
      page(
        `${item.id} · ${item.title ?? item.subject ?? ''}`,
        `<a href="${view}.html">← all ${esc(title.toLowerCase())}</a>`,
      );
      detail(item, fields);
      return;
    }
    page(title, `${rows.length} record(s)`);
    root.appendChild(
      table(rows, cols, { filters, empty: `No ${title.toLowerCase()} recorded yet.` }),
    );
  }

  // ------------------------------------------------------------------- views

  const S = D.state;
  const views = {
    index() {
      page('Overview', `${esc(D.config.current_phase)}`);
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="health" data-h="${esc(S.health)}"><strong>${st(S.health)}</strong>${
          S.health_reasons.length
            ? `<ul>${S.health_reasons.map((r) => `<li>${md(r).replace(/^<p>|<\/p>$/g, '')}</li>`).join('')}</ul>`
            : '<span class="muted">No rule in PROJECT_CONFIG.json is tripped.</span>'
        }</div>`,
      );
      root.insertAdjacentHTML(
        'beforeend',
        `<h2>Needs your attention</h2>${attentionPanel()}<p class="muted">${D.live ? 'Live from canonical state.' : 'Snapshot from data.js — serve with <code>pnpm pm:dashboard</code> for live state and owner actions.'} ${esc(String(D.state.canonical_events ?? ''))} events.</p>`,
      );
      const m = D.milestones.find((x) => x.id === S.current_milestone);
      const facts = [
        ['Overall progress', `${S.progress}%`],
        ['Current milestone', m ? `${link(m.id)} <small>${m.progress}%</small>` : '—'],
        ['Tasks', S.total_tasks],
        ['Active', S.active_tasks],
        ['Blocked', S.blocked_tasks],
        ['Manager / cross review', S.review_tasks],
        ['QA / security / regression', S.qa_tasks],
        ['Completed', S.completed_tasks],
        ['Open bugs', S.open_bugs],
        [
          'Security findings',
          `${S.security_findings} <small>${Object.entries(S.security_by_severity)
            .filter(([, n]) => n)
            .map(([k, n]) => `${n} ${k.toLowerCase()}`)
            .join(' · ')}</small>`,
        ],
        ['Change requests', S.active_change_requests],
        ['Pending decisions', S.pending_decisions],
        ['Pending consensus', S.pending_consensus],
        ['Active agents', S.active_agents],
        ['File collisions', S.file_collisions],
      ];
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="facts">${facts.map(([k, v]) => `<div><div class="k">${esc(k)}</div><div class="v">${v}</div></div>`).join('')}</div>`,
      );
      if (D.problems.length)
        root.insertAdjacentHTML('beforeend', `<h2>Governance</h2>${problemsBox()}`);

      const grid = document.createElement('div');
      grid.className = 'two';
      const left = document.createElement('div');
      const right = document.createElement('div');
      grid.append(left, right);
      root.appendChild(grid);

      const open = D.tasks.filter((t) => !['COMPLETED', 'CANCELLED', 'BACKLOG'].includes(t.status));
      left.appendChild(
        section(
          'Open work, by priority',
          table(
            open.sort(
              (a, b) =>
                ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.priority) -
                ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.priority),
            ),
            [taskCols[0], taskCols[1], taskCols[3], taskCols[5], taskCols[6], taskCols[8]],
            { sort: 'priority', empty: 'No open work outside the backlog.' },
          ),
        ),
      );
      left.appendChild(
        section(
          'Milestones',
          table(D.milestones, [
            { key: 'id', label: 'ID', cls: 'id', render: link },
            { key: 'title', label: 'Milestone' },
            { key: 'status', label: 'Status', render: st },
            { key: 'task_count', label: 'Tasks', cls: 'num' },
            { key: 'progress', label: 'Progress', render: bar },
          ]),
        ),
      );
      right.appendChild(
        section(
          'Open issues',
          table(
            D.issues.filter(
              (i) => !['FIXED', 'VERIFIED', 'CLOSED', 'WONT_FIX', 'DUPLICATE'].includes(i.status),
            ),
            [
              { key: 'id', label: 'ID', cls: 'id', render: link },
              { key: 'title', label: 'Issue' },
              { key: 'severity', label: 'Severity', render: st },
              { key: 'category', label: 'Type', cls: 'muted' },
            ],
            { sort: 'severity', empty: 'No open issues.' },
          ),
        ),
      );
      right.appendChild(section('Recent activity', feed(D.activity.slice(0, 15))));
    },

    tasks() {
      page('Tasks', `${D.tasks.length} tasks · one Markdown file each under <code>tasks/</code>`);
      root.appendChild(table(D.tasks, taskCols, { filters: taskFilters }));
    },

    'task-details'() {
      const t = D.tasks.find((x) => x.id === params.get('id'));
      if (!t) {
        page('Task not found');
        root.insertAdjacentHTML(
          'beforeend',
          '<p class="empty">No task with that id. <a href="tasks.html">All tasks</a></p>',
        );
        return;
      }
      page(`${t.id} · ${t.title}`, `<a href="tasks.html">← all tasks</a>`);
      detail(t, [
        ['status', 'Status', st],
        ['stage', 'Stage'],
        ['progress', 'Progress', bar],
        ['priority', 'Priority', st],
        ['risk', 'Risk', st],
        ['authority_level', 'Authority', (v) => `Level ${v}`],
        [
          'primary_agent',
          'Primary agent',
          (v) => `${esc(who(v))} <span class="mono muted">${esc(v)}</span>`,
        ],
        [
          'responsible_manager',
          'Responsible manager',
          (v) => `${esc(who(v))} <span class="mono muted">${esc(v)}</span>`,
        ],
        ['supporting_agents', 'Supporting', (v) => esc((v || []).map(who).join(', ') || '—')],
        [
          'required_reviewers',
          'Required reviewers',
          (v) => esc((v || []).map(who).join(', ') || '—'),
        ],
        ['related_change_request', 'Change request', link],
        ['related_consensus', 'Consensus', link],
        ['related_epic', 'Epic', link],
        ['related_milestone', 'Milestone', link],
        ['dependencies', 'Depends on', links],
        ['blocks', 'Blocks', links],
        ['affected_modules', 'Modules', (v) => esc((v || []).join(', ') || '—')],
        [
          'affected_files',
          'Files',
          (v) => (v && v.length ? v.map((f) => `<code>${esc(f)}</code>`).join('<br>') : '—'),
        ],
        ['created_at', 'Created', date],
        ['updated_at', 'Updated', date],
      ]);
      const events = D.activity.filter((a) => a.ref === t.id);
      root.appendChild(section('Timeline', feed(events)));
    },

    kanban() {
      page('Kanban');
      const COLS = [
        ['Backlog', ['BACKLOG']],
        ['Planned', ['PLANNED']],
        ['Ready', ['READY']],
        [
          'In progress',
          ['IN_PROGRESS', 'WAITING_DEPENDENCY', 'WAITING_INFORMATION', 'REVISION_REQUIRED'],
        ],
        ['Review', ['MANAGER_REVIEW', 'CROSS_MANAGER_REVIEW']],
        ['QA', ['QA', 'SECURITY_REVIEW', 'REGRESSION_TESTING']],
        ['Blocked', ['BLOCKED']],
        ['Ready for release', ['READY_FOR_RELEASE']],
        ['Completed', ['COMPLETED', 'CANCELLED']],
      ];
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="kanban">${COLS.map(([name, sts]) => {
          const cards = D.tasks.filter((t) => sts.includes(t.status));
          return `<div class="col"><h3>${esc(name)} · ${cards.length}</h3>${cards
            .map(
              (t) =>
                `<a class="card" href="task-details.html?id=${t.id}"><div class="t">${esc(t.title)}</div><div class="m"><span class="mono">${t.id}</span>${st(t.priority)}<span>${t.progress}%</span><span>L${t.authority_level}</span></div><div class="m">${esc(who(t.primary_agent))}</div></a>`,
            )
            .join('')}</div>`;
        }).join('')}</div>`,
      );
    },

    agents() {
      page('Agents', 'Specialist roles, their authority and live assignments');
      const tb = document.createElement('div');
      tb.className = 'toolbar';
      tb.innerHTML = `<label><input type="checkbox" id="unst"> show roles not staffed on this project</label>`;
      root.appendChild(tb);
      const box = document.createElement('div');
      root.appendChild(box);
      const draw = () => {
        const all = tb.querySelector('#unst').checked;
        box.innerHTML = `<div class="grid-cards">${D.agents
          .filter((a) => all || a.staffed)
          .map((a) => {
            const p = D.permissions.roles[a.id];
            return `<div class="person" data-staffed="${a.staffed}"><div class="n">${esc(p.title)}</div><div class="d">${esc(p.department)} · ${esc(p.seniority)} · ${esc(p.experience)}</div>
            <div class="row"><span>State</span><span>${st(a.state)}</span></div>
            <div class="row"><span>Reports to</span><span class="mono">${esc(a.manager)}</span></div>
            <div class="row"><span>Current task</span><span>${link(a.current_task)}</span></div>
            <div class="row"><span>Assigned</span><span>${links(a.assignments)}</span></div>
            <div class="row"><span>Supporting / reviewing</span><span>${links([...a.supporting, ...a.reviews])}</span></div>
            <div class="row"><span>Workload</span><span>${a.workload}</span></div>
            <div class="row"><span>Max authority</span><span>Level ${p.max_authority}</span></div>
            <div class="row"><span>Blockers</span><span>${links(a.blockers)}</span></div>
            <div class="row"><span>Last activity</span><span class="mono">${date(a.last_activity)}</span></div>
            <details><summary>Permissions</summary><strong>Allowed</strong><ul>${(p.allowed || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><strong>Needs approval</strong><ul>${(p.requires_approval || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><strong>Forbidden</strong><ul>${(p.forbidden || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
            </div>`;
          })
          .join('')}</div>`;
      };
      tb.addEventListener('change', draw);
      draw();
    },

    managers() {
      page('Managers');
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="grid-cards">${D.managers
          .map((m) => {
            const p = D.permissions.managers[m.id];
            return `<div class="person"><div class="n">${esc(p.title)}</div><div class="d">${esc(m.id)} · ${esc(p.department)} · ${esc(p.experience)}</div>
            <div class="row"><span>Team</span><span>${m.team.length} roles</span></div>
            <div class="row"><span>Active tasks</span><span>${links(m.active_tasks)}</span></div>
            <div class="row"><span>All owned</span><span>${m.owned_tasks.length}</span></div>
            <div class="row"><span>Pending reviews</span><span>${links(m.reviews)}</span></div>
            <div class="row"><span>Blocked</span><span>${links(m.blocked_work)}</span></div>
            <div class="row"><span>Pending decisions</span><span>${links(m.pending_decisions)}</span></div>
            <div class="row"><span>Consensus</span><span>${links(m.consensus)}</span></div>
            <div class="row"><span>Risks</span><span>${links(m.risks)}</span></div>
            <details><summary>Team &amp; approval scope</summary><ul>${m.team.map((r) => `<li>${esc(who(r))}</li>`).join('')}</ul><strong>Approves</strong><ul>${(p.allowed || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><strong>Forbidden</strong><ul>${(p.forbidden || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>
            </div>`;
          })
          .join('')}</div>`,
      );
    },

    epics() {
      registry(
        D.epics,
        'Epics',
        [
          { key: 'id', label: 'ID', cls: 'id', render: link },
          { key: 'title', label: 'Epic' },
          { key: 'status', label: 'Status', render: st },
          { key: 'owner', label: 'Owner', cls: 'mono' },
          { key: 'task_count', label: 'Tasks', cls: 'num' },
          { key: 'progress', label: 'Progress', render: bar },
        ],
        [
          ['status', 'Status', st],
          ['owner', 'Owner'],
          ['related_milestone', 'Milestone', link],
          ['progress', 'Progress (from tasks)', bar],
        ],
      );
      const id = params.get('id');
      if (id)
        root.appendChild(
          section(
            'Tasks',
            table(
              D.tasks.filter((t) => t.related_epic === id),
              taskCols.slice(0, 9),
            ),
          ),
        );
    },

    milestones() {
      registry(
        D.milestones,
        'Milestones',
        [
          { key: 'id', label: 'ID', cls: 'id', render: link },
          { key: 'title', label: 'Milestone' },
          { key: 'status', label: 'Status', render: st },
          { key: 'target', label: 'Target', cls: 'mono' },
          { key: 'task_count', label: 'Tasks', cls: 'num' },
          { key: 'progress', label: 'Progress', render: bar },
        ],
        [
          ['status', 'Status', st],
          ['target', 'Target'],
          ['owner', 'Owner'],
          ['progress', 'Progress (from tasks)', bar],
        ],
      );
      const id = params.get('id');
      if (id)
        root.appendChild(
          section(
            'Tasks',
            table(
              D.tasks.filter((t) => t.related_milestone === id),
              taskCols.slice(0, 9),
            ),
          ),
        );
    },

    issues() {
      registry(
        D.issues,
        'Issues',
        [
          { key: 'id', label: 'ID', cls: 'id', render: link },
          { key: 'title', label: 'Issue' },
          { key: 'category', label: 'Type', cls: 'muted' },
          { key: 'severity', label: 'Severity', render: st },
          { key: 'status', label: 'Status', render: st },
          { key: 'module', label: 'Module', cls: 'muted' },
          { key: 'task', label: 'Task', render: link },
          { key: 'manager', label: 'Manager', cls: 'mono' },
          { key: 'created_at', label: 'Reported', cls: 'mono', render: date },
        ],
        [
          ['severity', 'Severity', st],
          ['status', 'Status', st],
          ['category', 'Type'],
          ['module', 'Module'],
          ['reporter', 'Reporter', who],
          ['assigned_agent', 'Assigned', who],
          ['manager', 'Manager', who],
          ['task', 'Corrective task', link],
          ['release_blocker', 'Blocks release', (v) => (v ? 'Yes' : 'No')],
        ],
        [
          { key: 'severity', label: 'Severity' },
          { key: 'status', label: 'Status' },
          { key: 'category', label: 'Type' },
        ],
      );
    },

    changes() {
      registry(
        D.changes,
        'Change requests',
        [
          { key: 'id', label: 'ID', cls: 'id', render: link },
          { key: 'title', label: 'Change' },
          { key: 'status', label: 'Status', render: st },
          { key: 'authority_level', label: 'Auth.', cls: 'num', render: (v) => `L${v}` },
          { key: 'risk', label: 'Risk', render: st },
          { key: 'responsible_manager', label: 'Manager', cls: 'mono' },
          { key: 'tasks', label: 'Tasks', render: links },
        ],
        [
          ['status', 'Status', st],
          ['authority_level', 'Authority', (v) => `Level ${v}`],
          ['risk', 'Risk', st],
          ['responsible_manager', 'Responsible manager', who],
          ['departments', 'Departments', (v) => esc((v || []).join(', '))],
          ['consensus_required', 'Consensus required', (v) => (v ? 'Yes' : 'No')],
          ['tasks', 'Tasks', links],
        ],
      );
    },

    decisions() {
      registry(
        D.decisions,
        'Decisions',
        [
          { key: 'id', label: 'ID', cls: 'id', render: link },
          { key: 'title', label: 'Decision' },
          { key: 'status', label: 'Status', render: st },
          { key: 'authority_level', label: 'Auth.', cls: 'num', render: (v) => `L${v}` },
          { key: 'decided_by', label: 'Decided by', cls: 'muted' },
          { key: 'date', label: 'Date', cls: 'mono', render: date },
        ],
        [
          ['status', 'Status', st],
          ['authority_level', 'Authority', (v) => `Level ${v}`],
          ['decided_by', 'Decided by'],
          ['participants', 'Participants', (v) => esc((v || []).map(who).join(', '))],
          ['date', 'Date', date],
          ['related_tasks', 'Related tasks', links],
          ['supersedes', 'Supersedes', link],
        ],
      );
    },

    consensus() {
      registry(
        D.consensus,
        'Consensus board',
        [
          { key: 'id', label: 'ID', cls: 'id', render: link },
          { key: 'subject', label: 'Subject' },
          { key: 'status', label: 'Status', render: st },
          {
            key: 'participants',
            label: 'Participants',
            cls: 'muted',
            render: (v) => esc((v || []).join(', ')),
          },
          { key: 'related_decision', label: 'Decision', render: link },
        ],
        [
          ['status', 'Status', st],
          ['participants', 'Participants', (v) => esc((v || []).map(who).join(', '))],
          ['related_decision', 'Decision', link],
          ['related_tasks', 'Tasks', links],
          ['approved_at', 'Approved', date],
        ],
      );
    },

    files() {
      page('Files', 'Ownership map and live file claims');
      root.appendChild(
        section(
          'Files claimed by open tasks',
          table(
            D.files.map((f) => ({ ...f, collision: f.tasks.length > 1 ? 'COLLISION' : '' })),
            [
              { key: 'file', label: 'File', cls: 'mono' },
              { key: 'tasks', label: 'Tasks', render: links },
              {
                key: 'collision',
                label: '',
                render: (v) => (v ? st('BLOCKED').replace('BLOCKED', 'collision') : ''),
              },
            ],
            { empty: 'No open task declares affected files.' },
          ),
        ),
      );
      root.appendChild(
        section(
          'Ownership (from agent-os/policies/routing.json · full notes in FILE_OWNERSHIP.md)',
          table(D.ownership, [
            { key: 'path', label: 'Path', cls: 'mono' },
            { key: 'primary', label: 'Primary', render: who },
            { key: 'manager', label: 'Manager', cls: 'mono' },
            {
              key: 'reviewers',
              label: 'Mandatory review',
              render: (v) => esc((v || []).map(who).join(', ')),
            },
            { key: 'authority', label: 'Min. level', cls: 'num', render: (v) => `L${v}` },
          ]),
        ),
      );
    },

    timeline() {
      page('Timeline', `${D.activity.length} most recent events from logs/`);
      root.appendChild(feed(D.activity));
    },

    reports() {
      page('Reports');
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="doc">${md(
          (D.config.reports || [])
            .map((r) => `- [${r.title}](../${r.path}) — ${r.summary}`)
            .join('\n') || 'No reports yet.',
        )}</div>`,
      );
    },

    permissions() {
      page('Permissions', 'Rendered from PERMISSIONS.json');
      const rows = Object.entries({ ...D.permissions.managers, ...D.permissions.roles }).map(
        ([id, p]) => ({
          id,
          ...p,
        }),
      );
      root.appendChild(
        table(
          rows,
          [
            { key: 'title', label: 'Role' },
            { key: 'department', label: 'Department', cls: 'muted' },
            { key: 'reports_to', label: 'Reports to', cls: 'mono' },
            { key: 'max_authority', label: 'Max level', cls: 'num', render: (v) => `L${v}` },
            { key: 'allowed', label: 'Allowed', render: (v) => esc((v || []).join('; ')) },
            {
              key: 'requires_approval',
              label: 'Requires approval',
              render: (v) => esc((v || []).join('; ')),
            },
            { key: 'forbidden', label: 'Forbidden', render: (v) => esc((v || []).join('; ')) },
            { key: 'escalation', label: 'Escalation', render: (v) => esc((v || []).join('; ')) },
            { key: 'staffed', label: 'Staffed', render: (v) => (v === false ? 'No' : 'Yes') },
          ],
          { filters: [{ key: 'department', label: 'Department' }] },
        ),
      );
    },
  };

  function feed(events) {
    const ul = document.createElement('ul');
    ul.className = 'feed';
    ul.innerHTML = events.length
      ? events
          .map(
            (e) =>
              `<li><span class="when">${esc((e.at || '').replace('T', ' ').slice(0, 16))}</span> · <span class="mono">${esc(e.event)}</span> ${link(e.ref)} <span class="muted">${esc(e.actor)}</span><br>${esc(e.message)}</li>`,
          )
          .join('')
      : '<li class="muted">No events.</li>';
    return ul;
  }

  // ============================================================ V2 views
  // Product Evolution, reviews, risks, security, releases, attention.
  // Every number below is derived from canonical state; nothing is decorative.

  const LVL = { NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, VERY_HIGH: 4 };
  const lv = (v) => (v in LVL ? LVL[v] : null);
  const opps = D.opportunities || [];
  const oppById = new Map(opps.map((o) => [o.id, o]));
  const rankOf = (id) => {
    const i = (D.ranking?.order || []).indexOf(id);
    return i < 0 ? null : i + 1;
  };
  const LANES = [
    ['Inbox', ['DETECTED', 'TRIAGED']],
    ['Under research', ['DISCOVERY']],
    ['Product shaping', ['PRODUCT_SHAPING']],
    ['Design shaping', ['DESIGN_SHAPING']],
    ['Technical shaping', ['TECHNICAL_SHAPING']],
    ['Evidence & cross-review', ['EVIDENCE_REVIEW', 'CROSS_FUNCTIONAL_REVIEW']],
    ['Ready for decision', ['READY_FOR_OWNER_DECISION']],
    ['Approved', ['APPROVED', 'DELIVERED']],
    ['Deferred', ['DEFERRED']],
    ['Rejected', ['REJECTED', 'MERGED']],
    ['Watchlist', ['WATCH']],
  ];

  async function owner(action, payload) {
    const tok = sessionStorage.getItem('pm-owner-token');
    const r = await fetch(`/api/owner/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-owner-token': tok || '' },
      body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }
  const ownerCapable = () => D.owner_mode && !!sessionStorage.getItem('pm-owner-token');
  function ownerNote() {
    if (ownerCapable()) return '<span class="st" data-t="ok">owner mode</span>';
    if (D.live && D.owner_mode)
      return '<span class="muted">Open the owner link printed in the dashboard terminal to act.</span>';
    return '<span class="muted">Read-only. Owner actions: run <code>pnpm pm:dashboard</code> in your own terminal and open its owner link.</span>';
  }

  function oppCard(o, compare = true) {
    const rank = rankOf(o.id);
    return `<div class="card opp">
      <div class="m"><a class="mono" href="opportunity.html?id=${o.id}">${o.id}</a>${rank ? `<span class="rank">#${rank}</span>` : ''}${compare ? `<label class="cmp"><input type="checkbox" data-cmp="${o.id}" aria-label="Compare ${esc(o.id)}"> compare</label>` : ''}</div>
      <a class="t" href="opportunity.html?id=${o.id}">${esc(o.title)}</a>
      <div class="m"><span>${esc((o.opportunity_type || '').replace(/_/g, ' ').toLowerCase())}</span><span>by ${esc(who(o.proposed_by))}</span></div>
      <dl class="mini">
        <dt>User value</dt><dd>${esc(o.user_value || '—')}</dd>
        <dt>Business</dt><dd>${esc(o.business_value || '—')}</dd>
        <dt>Effort</dt><dd>${esc(o.technical_effort || '—')}</dd>
        <dt>Risk</dt><dd>${esc(o.risk || '—')}</dd>
        <dt>Evidence</dt><dd>${esc(o.evidence_strength || '—')}</dd>
        <dt>Recommends</dt><dd>${esc(o.recommendation || '—')}</dd>
      </dl></div>`;
  }

  function bindCompare(scope) {
    const btn = scope.querySelector('#cmp-go');
    const upd = () => {
      const ids = [...scope.querySelectorAll('[data-cmp]:checked')].map((c) => c.dataset.cmp);
      btn.disabled = ids.length < 2;
      btn.textContent = ids.length ? `Compare ${ids.length}` : 'Compare';
      btn.dataset.ids = ids.join(',');
    };
    scope.addEventListener('change', (e) => e.target.matches('[data-cmp]') && upd());
    btn.addEventListener('click', () => (location.href = `compare.html?ids=${btn.dataset.ids}`));
    upd();
  }

  Object.assign(views, {
    opportunities() {
      page('Discovery & Opportunities', ownerNote());
      root.insertAdjacentHTML(
        'beforeend',
        `<p class="lede">Suggestions are not tasks, ideas are not approved features, and an opportunity is not permission to build. Approval creates a change request; delivery then follows normal governance.</p>
        <div class="toolbar"><select id="f-type" aria-label="Type"><option value="">All types</option>${[
          ...new Set(opps.map((o) => o.opportunity_type)),
        ]
          .sort()
          .map((t) => `<option>${esc(t)}</option>`)
          .join('')}</select><button id="cmp-go" class="btn" disabled>Compare</button></div>
        <div class="kanban lanes" id="lanes"></div>`,
      );
      const draw = () => {
        const f = root.querySelector('#f-type').value;
        root.querySelector('#lanes').innerHTML = LANES.map(([name, sts]) => {
          const items = opps.filter(
            (o) => sts.includes(o.status) && (!f || o.opportunity_type === f),
          );
          return `<div class="col"><h3>${esc(name)} · ${items.length}</h3>${items.map((o) => oppCard(o)).join('') || '<p class="muted small">—</p>'}</div>`;
        }).join('');
      };
      root.querySelector('#f-type').addEventListener('change', draw);
      draw();
      bindCompare(root);
      root.appendChild(section('Owner ranking', rankingPanel()));
    },

    opportunity() {
      const o = oppById.get(params.get('id'));
      if (!o) {
        page('Opportunity not found');
        root.insertAdjacentHTML(
          'beforeend',
          '<p class="empty"><a href="opportunities.html">All opportunities</a></p>',
        );
        return;
      }
      page(`${o.id} · ${o.title}`, `<a href="opportunities.html">← discovery</a>`);
      const ev = (D.evidence || {})[o.id] || [];
      const rv = (D.reviews || []).filter((r) => r.target === o.id);
      const dec = (D.owner_decisions || []).filter((d) => d.opportunity === o.id);
      const rel = (D.links || []).filter((l) => l.from === o.id || l.to === o.id);
      const tasks = D.tasks.filter((t) => t.related_opportunity === o.id);
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="summary">
          <div><div class="k">Status</div><div class="v">${st(o.status)}</div></div>
          <div><div class="k">Recommendation</div><div class="v">${esc(o.recommendation || '—')}</div></div>
          <div><div class="k">Evidence</div><div class="v">${esc(o.evidence_strength || '—')}</div></div>
          <div><div class="k">User / business value</div><div class="v">${esc(o.user_value || '—')} / ${esc(o.business_value || '—')}</div></div>
          <div><div class="k">Effort / risk</div><div class="v">${esc(o.technical_effort || '—')} / ${esc(o.risk || '—')}</div></div>
          <div><div class="k">Owner rank</div><div class="v">${rankOf(o.id) ? '#' + rankOf(o.id) : '—'}</div></div>
        </div>`,
      );
      root.appendChild(section('Owner decision', decisionPanel(o)));
      root.insertAdjacentHTML(
        'beforeend',
        `<dl class="kv">
          <dt>Type</dt><dd>${esc(o.opportunity_type)}</dd>
          <dt>Proposed by</dt><dd>${esc(who(o.proposed_by))}</dd>
          <dt>Responsible manager</dt><dd>${esc(who(o.responsible_manager))}</dd>
          <dt>Contributors</dt><dd>${esc((o.contributors || []).map(who).join(', ') || '—')}</dd>
          <dt>Source signals</dt><dd>${links(o.source_signals)}</dd>
          <dt>User-facing / visual</dt><dd>${o.user_facing ? 'yes' : 'no'} / ${o.visual_impact ? 'yes' : 'no'}</dd>
          <dt>Competitive position</dt><dd>${esc(o.competitive_position || '—')}</dd>
          <dt>Change request</dt><dd>${link(o.related_change_request)}</dd>
          <dt>Tasks</dt><dd>${links(tasks.map((t) => t.id))}</dd>
          <dt>Related</dt><dd>${rel.map((l) => `${esc(l.relation)} ${link(l.from === o.id ? l.to : l.from)}`).join(', ') || '—'}</dd>
        </dl>`,
      );
      const evRow = (e) => ({ ...e });
      root.appendChild(
        section(
          'Evidence for',
          table(ev.filter((e) => e.stance === 'SUPPORTS').map(evRow), evCols(), {
            empty: 'No supporting evidence recorded.',
          }),
        ),
      );
      root.appendChild(
        section(
          'Evidence against',
          table(ev.filter((e) => e.stance === 'OPPOSES').map(evRow), evCols(), {
            empty: 'No opposing evidence recorded — the pack must still say why.',
          }),
        ),
      );
      root.appendChild(
        section(
          'Reviews',
          table(rv, reviewCols(), {
            empty: 'No reviews yet. Engineering shaping is required before a decision.',
          }),
        ),
      );
      root.appendChild(
        section(
          'Decision history',
          table(
            dec,
            [
              { key: 'ts', label: 'When', cls: 'mono', render: date },
              { key: 'decision', label: 'Decision', render: st },
              { key: 'from', label: 'From', cls: 'muted' },
              { key: 'to', label: 'To', render: st },
              { key: 'reason', label: 'Reason' },
              { key: 'actor', label: 'By', cls: 'mono' },
            ],
            { empty: 'No owner decision yet.' },
          ),
        ),
      );
      root.insertAdjacentHTML(
        'beforeend',
        `<h2>Opportunity development pack</h2><div class="doc">${md(D.bodies[o.id])}</div><p class="muted">Source: <code>project-management/${esc(o.file)}</code></p>`,
      );
      root.appendChild(
        section(
          'Event history',
          feed(
            ((D.history || {})[o.id] || [])
              .slice()
              .reverse()
              .map((h) => ({
                at: h.ts,
                actor: h.actor,
                event: h.type.toUpperCase(),
                ref: o.id,
                message: h.summary + (h.reason ? ' — ' + h.reason : ''),
              })),
          ),
        ),
      );
    },

    compare() {
      const ids = (params.get('ids') || '').split(',').filter((id) => oppById.has(id));
      page('Compare opportunities', '<a href="opportunities.html">← discovery</a>');
      if (ids.length < 2) {
        root.insertAdjacentHTML(
          'beforeend',
          '<p class="empty">Select at least two opportunities on the Discovery page.</p>',
        );
        return;
      }
      const os = ids.map((id) => oppById.get(id));
      const dims = [
        ['Status', (o) => st(o.status)],
        ['Type', (o) => esc(o.opportunity_type)],
        ['Owner rank', (o) => (rankOf(o.id) ? '#' + rankOf(o.id) : '—')],
        ['User value', (o) => esc(o.user_value || '—')],
        ['Business value', (o) => esc(o.business_value || '—')],
        ['Strategic alignment', (o) => esc(o.strategic_alignment || '—')],
        ['Evidence strength', (o) => esc(o.evidence_strength || '—')],
        [
          'Evidence for / against',
          (o) => {
            const e = (D.evidence || {})[o.id] || [];
            return `${e.filter((x) => x.stance === 'SUPPORTS').length} / ${e.filter((x) => x.stance === 'OPPOSES').length}`;
          },
        ],
        ['Technical effort', (o) => esc(o.technical_effort || '—')],
        ['Design effort', (o) => esc(o.design_effort || '—')],
        ['Risk', (o) => esc(o.risk || '—')],
        ['Time to value', (o) => esc(o.time_to_value || '—')],
        ['Competitive position', (o) => esc(o.competitive_position || '—')],
        ['Recommendation', (o) => esc(o.recommendation || '—')],
        [
          'Reviews',
          (o) =>
            esc(
              (D.reviews || [])
                .filter((r) => r.target === o.id)
                .map((r) => `${r.review_type}:${r.result}`)
                .join(', ') || '—',
            ),
        ],
        [
          'Dependencies',
          (o) =>
            links(
              (D.links || [])
                .filter((l) => l.from === o.id && l.relation === 'DEPENDENT')
                .map((l) => l.to),
            ),
        ],
      ];
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="table-wrap"><table><thead><tr><th>Dimension</th>${os.map((o) => `<th>${link(o.id)}<br><span class="muted">${esc(o.title)}</span></th>`).join('')}</tr></thead><tbody>${dims.map(([n, f]) => `<tr><th scope="row">${esc(n)}</th>${os.map((o) => `<td>${f(o)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <p class="muted">The dimensions are shown side by side, not combined into a score. The ranking is the owner's.</p>`,
      );
    },

    radar() {
      page('Opportunity radar', 'Plotted only from recorded categorical values');
      const axes = {
        impact_effort: [
          'Effort (technical)',
          'Impact (max of user and business value)',
          (o) => lv(o.technical_effort),
          (o) => Math.max(lv(o.user_value) ?? -1, lv(o.business_value) ?? -1),
        ],
        evidence_value: [
          'Evidence strength',
          'Strategic alignment',
          (o) => ({ INSUFFICIENT: 0, WEAK: 1, MIXED: 2, STRONG: 3 })[o.evidence_strength] ?? null,
          (o) => lv(o.strategic_alignment),
        ],
      };
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="toolbar"><select id="ax" aria-label="Axes"><option value="impact_effort">Impact vs effort</option><option value="evidence_value">Evidence vs strategic alignment</option></select>
        <select id="fl" aria-label="Filter"><option value="">All types</option>${[
          ...new Set(opps.map((o) => o.opportunity_type)),
        ]
          .sort()
          .map((t) => `<option>${esc(t)}</option>`)
          .join('')}</select></div><div id="plot"></div>`,
      );
      const draw = () => {
        const [xl, yl, fx, fy] = axes[root.querySelector('#ax').value];
        const f = root.querySelector('#fl').value;
        const pts = opps.filter(
          (o) => (!f || o.opportunity_type === f) && fx(o) != null && fy(o) != null && fy(o) >= 0,
        );
        const missing = opps.filter((o) => !f || o.opportunity_type === f).length - pts.length;
        const W = 640,
          H = 420,
          P = 56,
          max = 4;
        const X = (v) => P + (v / max) * (W - 2 * P);
        const Y = (v) => H - P - (v / max) * (H - 2 * P);
        const seen = new Map();
        const dots = pts.map((o) => {
          const k = `${fx(o)},${fy(o)}`;
          const n = seen.get(k) || 0;
          seen.set(k, n + 1);
          const dx = n * 12;
          return `<a href="opportunity.html?id=${o.id}"><circle cx="${X(fx(o)) + dx}" cy="${Y(fy(o))}" r="7" class="dot" data-s="${esc(o.status)}"><title>${esc(o.id)} ${esc(o.title)} — ${esc(o.status)}</title></circle><text x="${X(fx(o)) + dx + 10}" y="${Y(fy(o)) + 4}" class="lbl">${esc(o.id)}</text></a>`;
        });
        const ticks = [0, 1, 2, 3, 4]
          .map(
            (i) =>
              `<line x1="${X(i)}" y1="${H - P}" x2="${X(i)}" y2="${P}" class="grid"/><line x1="${P}" y1="${Y(i)}" x2="${W - P}" y2="${Y(i)}" class="grid"/>`,
          )
          .join('');
        root.querySelector('#plot').innerHTML =
          `<svg viewBox="0 0 ${W} ${H}" class="radar" role="img" aria-label="${esc(yl)} against ${esc(xl)}">${ticks}<text x="${W / 2}" y="${H - 14}" class="axis" text-anchor="middle">${esc(xl)} →</text><text x="16" y="${H / 2}" class="axis" transform="rotate(-90 16 ${H / 2})" text-anchor="middle">${esc(yl)} →</text>${dots.join('')}</svg>
          <p class="muted">${pts.length} plotted. ${missing ? `${missing} opportunit${missing === 1 ? 'y has' : 'ies have'} no value on one of these axes yet and ${missing === 1 ? 'is' : 'are'} not placed.` : ''} Scale: none · low · medium · high · very high.</p>`;
      };
      root.querySelector('#ax').addEventListener('change', draw);
      root.querySelector('#fl').addEventListener('change', draw);
      draw();
    },

    portfolio() {
      page('Portfolio balance', ownerNote());
      const cats = D.enums.portfolio_category;
      const approved = opps.filter((o) => ['APPROVED', 'DELIVERED'].includes(o.status));
      const pipeline = opps.filter(
        (o) => !['APPROVED', 'DELIVERED', 'REJECTED', 'MERGED'].includes(o.status),
      );
      const prefs = D.portfolio?.preferences || {};
      const count = (xs, c) => xs.filter((o) => o.portfolio_category === c).length;
      const rows = cats.map((c) => ({
        category: c,
        approved: count(approved, c),
        pipeline: count(pipeline, c),
        preference: prefs[c] ?? null,
      }));
      const insights = [];
      const totalA = approved.length;
      if (totalA >= 3)
        for (const r of rows)
          if ((r.preference ?? 0) > 0 && r.approved === 0)
            insights.push(
              `You weight ${r.category.toLowerCase().replace(/_/g, ' ')} at ${r.preference}, but none of the ${totalA} approved opportunities is in it.`,
            );
      if (!totalA)
        insights.push(
          'No approved opportunities yet. Balance becomes meaningful once decisions accumulate.',
        );
      const uncategorised = opps.filter((o) => !o.portfolio_category).length;
      if (uncategorised)
        insights.push(
          `${uncategorised} opportunit${uncategorised === 1 ? 'y has' : 'ies have'} no portfolio category.`,
        );
      const bar = (n, total) =>
        `<span class="bar"><i style="width:${total ? Math.round((n / total) * 100) : 0}%"></i></span>${n}`;
      root.appendChild(
        table(rows, [
          {
            key: 'category',
            label: 'Category',
            render: (v) => esc(v.replace(/_/g, ' ').toLowerCase()),
          },
          { key: 'approved', label: 'Approved', render: (v) => bar(v, totalA) },
          { key: 'pipeline', label: 'In pipeline', render: (v) => bar(v, pipeline.length) },
          {
            key: 'preference',
            label: 'Owner emphasis',
            render: (v) => (v == null ? '<span class="muted">not set</span>' : esc(v)),
          },
        ]),
      );
      root.appendChild(
        section(
          'Insights',
          `<ul class="feed">${insights.map((i) => `<li>${esc(i)}</li>`).join('') || '<li class="muted">No imbalance to report.</li>'}</ul><p class="muted">Insights only. Nothing here changes the roadmap.</p>`,
        ),
      );
      if (ownerCapable()) {
        const f = document.createElement('form');
        f.className = 'owner-form';
        f.innerHTML = `${cats.map((c) => `<label>${esc(c.replace(/_/g, ' ').toLowerCase())} <input type="number" min="0" max="5" name="${c}" value="${prefs[c] ?? ''}"></label>`).join('')}<label class="wide">Reason <input name="reason" required></label><button class="btn primary">Save emphasis</button><span class="msg"></span>`;
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(f);
          const preferences = Object.fromEntries(
            cats.filter((c) => fd.get(c) !== '').map((c) => [c, Number(fd.get(c))]),
          );
          try {
            await owner('portfolio', { preferences, reason: fd.get('reason') });
            location.reload();
          } catch (err) {
            f.querySelector('.msg').textContent = err.message;
          }
        });
        root.appendChild(section('Set portfolio emphasis (owner)', f));
      }
    },

    signals() {
      const sigs = D.signals || [];
      const id = params.get('id');
      const s = id && sigs.find((x) => x.id === id);
      if (s) {
        page(`${s.id} · ${s.title}`, '<a href="signals.html">← signals</a>');
        detail(s, [
          ['signal_type', 'Type'],
          ['status', 'Status', st],
          ['source', 'Source'],
          ['source_reference', 'Reference'],
          ['observed_at', 'Observed', date],
          ['proposed_by', 'Recorded by', who],
          ['evidence_quality', 'Evidence quality'],
          ['relevance', 'Relevance'],
          ['uncertainty', 'Uncertainty'],
          ['reevaluate_when', 'Re-evaluate when'],
          ['linked_to', 'Linked to', links],
        ]);
        return;
      }
      page('Signals & watchlist', `${sigs.length} signal(s)`);
      root.insertAdjacentHTML(
        'beforeend',
        '<p class="lede">Observations that may matter. Weak or early ones stay on the watchlist with a trigger for re-evaluation, rather than becoming opportunities.</p>',
      );
      const cols = [
        {
          key: 'id',
          label: 'ID',
          cls: 'id',
          render: (v) => `<a class="mono" href="signals.html?id=${v}">${v}</a>`,
        },
        { key: 'title', label: 'Signal' },
        { key: 'signal_type', label: 'Type', cls: 'muted' },
        { key: 'status', label: 'Status', render: st },
        { key: 'evidence_quality', label: 'Quality', cls: 'muted' },
        { key: 'relevance', label: 'Relevance', cls: 'muted' },
        { key: 'reevaluate_when', label: 'Re-evaluate when' },
        { key: 'linked_to', label: 'Linked', render: links },
      ];
      root.appendChild(
        section(
          'Watchlist',
          table(
            sigs.filter((x) => x.status === 'WATCH'),
            cols,
            { empty: 'Nothing on the watchlist.' },
          ),
        ),
      );
      root.appendChild(
        section(
          'All signals',
          table(sigs, cols, {
            filters: [
              { key: 'signal_type', label: 'Type' },
              { key: 'status', label: 'Status' },
            ],
          }),
        ),
      );
    },

    reviews() {
      page('Reviews', 'Recorded review events. Only these count as reviews.');
      const rv = (D.reviews || []).slice().reverse();
      root.insertAdjacentHTML(
        'beforeend',
        `<div class="facts"><div><div class="k">Reviews</div><div class="v">${rv.length}</div></div><div><div class="k">Independent</div><div class="v">${rv.filter((r) => r.independent).length}</div></div><div><div class="k">Blocking / veto</div><div class="v">${rv.filter((r) => ['VETO', 'BLOCKING_OBJECTION'].includes(r.result)).length}</div></div></div><p class="muted">V1 task files contain six "REVIEW" comments. The implementing agent wrote them; they are not reviews and are not counted here.</p>`,
      );
      root.appendChild(
        table(rv, [{ key: 'target', label: 'Item', render: link }, ...reviewCols()], {
          filters: [
            { key: 'review_type', label: 'Type' },
            { key: 'result', label: 'Result' },
          ],
        }),
      );
    },

    risks() {
      page('Risks');
      const open = D.issues.filter(
        (i) => !['FIXED', 'VERIFIED', 'CLOSED', 'WONT_FIX', 'DUPLICATE'].includes(i.status),
      );
      const legacy = new Set(['LEGACY_WORDPRESS', 'MIGRATION']);
      const cols = [
        { key: 'id', label: 'ID', cls: 'id', render: link },
        { key: 'title', label: 'Risk' },
        { key: 'severity', label: 'Severity', render: st },
        { key: 'affected_system', label: 'System', cls: 'mono' },
        { key: 'category', label: 'Type', cls: 'muted' },
        { key: 'task', label: 'Task', render: link },
      ];
      const sev = (a, b) =>
        ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(a.severity) -
        ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].indexOf(b.severity);
      root.appendChild(
        section(
          'New application (sets health)',
          table(open.filter((i) => !legacy.has(i.affected_system)).sort(sev), cols, {
            sort: 'severity',
          }),
        ),
      );
      root.appendChild(
        section(
          'Legacy site and migration data (tracked separately)',
          table(open.filter((i) => legacy.has(i.affected_system)).sort(sev), cols, {
            sort: 'severity',
          }),
        ),
      );
      root.appendChild(
        section(
          'Accepted risks (owner)',
          table(
            D.accepted_risks || [],
            [
              { key: 'entity', label: 'Item', render: link },
              { key: 'reason', label: 'Reason' },
              { key: 'ts', label: 'When', render: date },
            ],
            { empty: 'The owner has accepted no risks.' },
          ),
        ),
      );
    },

    security() {
      page('Security');
      const sec = D.issues.filter((i) => i.category === 'security');
      root.appendChild(
        section(
          'Security findings',
          table(
            sec,
            [
              { key: 'id', label: 'ID', cls: 'id', render: link },
              { key: 'title', label: 'Finding' },
              { key: 'severity', label: 'Severity', render: st },
              { key: 'previous_severity', label: 'Was', cls: 'muted' },
              { key: 'affected_system', label: 'System', cls: 'mono' },
              { key: 'status', label: 'Status', render: st },
              { key: 'task', label: 'Task', render: link },
            ],
            { sort: 'severity' },
          ),
        ),
      );
      root.appendChild(
        section(
          'Security reviews',
          table(
            (D.reviews || []).filter((r) => r.review_type === 'SECURITY'),
            [{ key: 'target', label: 'Item', render: link }, ...reviewCols()],
            { empty: 'No security reviews recorded yet.' },
          ),
        ),
      );
      root.insertAdjacentHTML(
        'beforeend',
        '<p class="muted">Agent guardrails: <code>agent-os/policies/guard.json</code>, enforced by <code>.claude/hooks/guard.mjs</code>, tested by <code>agent-os/evals/guard.test.mjs</code>. Threat model: <code>agent-os/THREAT_MODEL.md</code>.</p>',
      );
    },

    releases() {
      page('Releases');
      const rel = D.releases || [];
      root.appendChild(
        table(
          rel,
          [
            { key: 'id', label: 'ID', cls: 'id' },
            { key: 'title', label: 'Release' },
            { key: 'status', label: 'Status', render: st },
            { key: 'environment', label: 'Environment', cls: 'muted' },
            { key: 'tasks', label: 'Tasks', render: links },
            { key: 'released_at', label: 'Released', render: date },
          ],
          {
            empty:
              'No releases recorded in canonical state yet. Coolify deploys main to staging on its own trigger, which the repository cannot see. Record a release with pm create REL.',
          },
        ),
      );
    },
  });

  function evCols() {
    return [
      { key: 'evidence_id', label: 'ID', cls: 'mono' },
      { key: 'claim', label: 'Claim' },
      { key: 'quality', label: 'Quality', cls: 'muted' },
      { key: 'evidence_type', label: 'Type', cls: 'muted' },
      { key: 'source', label: 'Source' },
      { key: 'date', label: 'Date', cls: 'mono', render: date },
    ];
  }
  function reviewCols() {
    return [
      { key: 'review_id', label: 'Review', cls: 'mono' },
      { key: 'review_type', label: 'Type', cls: 'muted' },
      { key: 'reviewer', label: 'Reviewer', render: who },
      { key: 'result', label: 'Result', render: st },
      {
        key: 'independent',
        label: 'Independent',
        render: (v) => (v ? 'yes' : '<strong>no</strong>'),
      },
      { key: 'executor', label: 'Ran as', cls: 'mono' },
      { key: 'findings', label: 'Findings' },
      { key: 'ts', label: 'When', cls: 'mono', render: date },
    ];
  }

  function decisionPanel(o) {
    const wrap = document.createElement('div');
    if (!ownerCapable()) {
      wrap.innerHTML = `<p class="muted">${o.status === 'READY_FOR_OWNER_DECISION' ? 'Ready for your decision.' : 'Not yet ready for decision.'} ${ownerNote()}</p>`;
      return wrap;
    }
    const ready = o.status === 'READY_FOR_OWNER_DECISION';
    wrap.innerHTML = `<form class="owner-form">
      ${ready ? '' : '<p class="warn">This opportunity has not passed the readiness gate. You may still decide, but the pack is incomplete.</p>'}
      <label>Decision <select name="decision" required>${['APPROVE', 'APPROVE_AND_PRIORITIZE', 'RESEARCH_MORE', 'DEFER', 'REJECT', 'WATCH', 'MERGE'].map((d) => `<option>${d}</option>`).join('')}</select></label>
      <label class="wide">Reason <input name="reason" required></label>
      <label>Priority <select name="suggested_priority"><option value="">—</option><option>CRITICAL</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label>
      <label>Target milestone <select name="target_milestone"><option value="">—</option>${D.milestones.map((m) => `<option>${m.id}</option>`).join('')}</select></label>
      <label>Revisit when (defer / watch) <input name="revisit_when"></label>
      <label>Questions (research more) <input name="questions"></label>
      <label>Merge into <select name="merged_into"><option value="">—</option>${opps
        .filter((x) => x.id !== o.id)
        .map((x) => `<option>${x.id}</option>`)
        .join('')}</select></label>
      <label class="wide">Would change if… <input name="invalidated_if" placeholder="conditions that would invalidate this decision"></label>
      <button class="btn primary">Record decision</button><span class="msg" role="status"></span></form>`;
    const f = wrap.querySelector('form');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(f));
      for (const k of Object.keys(fd)) if (fd[k] === '') delete fd[k];
      try {
        await owner('decision', { id: o.id, ...fd });
        location.reload();
      } catch (err) {
        f.querySelector('.msg').textContent = err.message;
      }
    });
    return wrap;
  }

  function rankingPanel() {
    const wrap = document.createElement('div');
    let order = [...(D.ranking?.order || [])].filter((id) => oppById.has(id));
    const unranked = opps
      .filter((o) => !order.includes(o.id) && !['REJECTED', 'MERGED'].includes(o.status))
      .map((o) => o.id);
    const sugg = (D.suggestions || []).filter((s) => !D.ranking?.at || s.ts > D.ranking.at);
    const draw = () => {
      wrap.innerHTML = `${sugg.map((s) => `<p class="warn">PRIORITY_REVIEW_SUGGESTED · ${link(s.entity)} — ${esc(s.reason || '')} (${esc(s.actor)})</p>`).join('')}
        <ol class="ranking">${order.map((id, i) => `<li><span class="mono">${id}</span> ${esc(oppById.get(id).title)} ${ownerCapable() ? `<button class="btn sm" data-up="${i}" aria-label="Move ${id} up">↑</button><button class="btn sm" data-down="${i}" aria-label="Move ${id} down">↓</button><button class="btn sm" data-rm="${i}" aria-label="Remove ${id}">×</button>` : ''}</li>`).join('') || '<li class="muted">No ranking set by the owner.</li>'}</ol>
        ${
          ownerCapable()
            ? `<div class="toolbar"><select id="add-rank" aria-label="Add to ranking"><option value="">Add…</option>${unranked
                .filter((id) => !order.includes(id))
                .map((id) => `<option>${id}</option>`)
                .join(
                  '',
                )}</select><input id="rank-reason" placeholder="Reason" aria-label="Reason"><button class="btn primary" id="save-rank">Save ranking</button><span class="msg" role="status"></span></div>`
            : `<p class="muted">The owner sets this order. The system may suggest a review; it never reorders.</p>`
        }`;
      wrap.querySelectorAll('[data-up]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = +b.dataset.up;
          if (i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
          draw();
        }),
      );
      wrap.querySelectorAll('[data-down]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = +b.dataset.down;
          if (i < order.length - 1) [order[i + 1], order[i]] = [order[i], order[i + 1]];
          draw();
        }),
      );
      wrap.querySelectorAll('[data-rm]').forEach((b) =>
        b.addEventListener('click', () => {
          order.splice(+b.dataset.rm, 1);
          draw();
        }),
      );
      wrap.querySelector('#add-rank')?.addEventListener('change', (e) => {
        if (e.target.value) {
          order.push(e.target.value);
          draw();
        }
      });
      wrap.querySelector('#save-rank')?.addEventListener('click', async () => {
        try {
          await owner('ranking', {
            order,
            reason: wrap.querySelector('#rank-reason').value || null,
          });
          location.reload();
        } catch (err) {
          wrap.querySelector('.msg').textContent = err.message;
        }
      });
    };
    draw();
    return wrap;
  }

  function attentionPanel() {
    const a = D.attention || [];
    if (!a.length) return '<p class="muted">Nothing needs you right now.</p>';
    return `<ul class="feed attention">${a.map((x) => `<li><span class="st" data-t="${/SECURITY|DESTRUCTIVE|ESCALATION/.test(x.kind) ? 'block' : /READY|OWNER/.test(x.kind) ? 'warn' : 'info'}">${esc(x.kind)}</span> ${link(x.ref)} ${esc(x.why)}</li>`).join('')}</ul>`;
  }

  (views[view] || views.index)();
})();
