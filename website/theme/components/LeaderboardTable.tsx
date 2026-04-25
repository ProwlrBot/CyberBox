import React, { useMemo, useState } from 'react';

// Mirror evaluation/leaderboard_schema.json. If the schema fields change,
// update this type — the build will fail loudly on shape drift, which is
// preferable to a silent type-mismatched render.
type Metrics = {
  pass_rate: number;
  total_tasks: number;
  passed_tasks: number;
  latency_ms_p50: number;
  latency_ms_p95: number | null;
  latency_ms_mean: number | null;
  tool_calls: number;
  cost_usd: number | null;
  token_input: number | null;
  token_output: number | null;
};

export type LeaderboardRow = {
  id: string;
  config_ref: string;
  eval_file: string;
  release_tag: string | null;
  run_timestamp_utc: string;
  harness_version: string;
  runtime: 'azure' | 'openai' | 'langgraph';
  cyberbox: Metrics;
  upstream: Metrics | null;
};

type SortKey =
  | 'eval'
  | 'cb_pass'
  | 'up_pass'
  | 'delta'
  | 'cb_p50'
  | 'up_p50'
  | 'date';
type SortDir = 'asc' | 'desc';

const REPO_BLOB = 'https://github.com/ProwlrBot/CyberBox/blob/main';

function evalName(row: LeaderboardRow): string {
  return row.eval_file
    .replace(/^evaluation\/dataset\//, '')
    .replace(/^evaluation_/, '')
    .replace(/\.xml$/, '');
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  return `${v.toFixed(0)} ms`;
}

function fmtDate(iso: string): string {
  // ISO 8601 → YYYY-MM-DD; tolerate strings that aren't strict ISO.
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : iso;
}

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('eval');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      let cmp: number;
      switch (sortKey) {
        case 'eval':
          cmp = evalName(a).localeCompare(evalName(b));
          break;
        case 'cb_pass':
          cmp = a.cyberbox.pass_rate - b.cyberbox.pass_rate;
          break;
        case 'up_pass':
          cmp = (a.upstream?.pass_rate ?? -1) - (b.upstream?.pass_rate ?? -1);
          break;
        case 'delta': {
          const da = a.upstream ? a.cyberbox.pass_rate - a.upstream.pass_rate : 0;
          const db = b.upstream ? b.cyberbox.pass_rate - b.upstream.pass_rate : 0;
          cmp = da - db;
          break;
        }
        case 'cb_p50':
          cmp = a.cyberbox.latency_ms_p50 - b.cyberbox.latency_ms_p50;
          break;
        case 'up_p50':
          cmp =
            (a.upstream?.latency_ms_p50 ?? Number.POSITIVE_INFINITY) -
            (b.upstream?.latency_ms_p50 ?? Number.POSITIVE_INFINITY);
          break;
        case 'date':
          cmp = a.run_timestamp_utc.localeCompare(b.run_timestamp_utc);
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <p>
        <em>No leaderboard rows yet.</em> The first row publishes after the
        leaderboard-refresh CI workflow runs against the eval suite for an
        upcoming release.
      </p>
    );
  }

  function HeaderCell({
    label,
    sortKeyForCol,
    align = 'left',
  }: {
    label: string;
    sortKeyForCol: SortKey;
    align?: 'left' | 'right';
  }) {
    const active = sortKey === sortKeyForCol;
    const arrow = active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    return (
      <th
        onClick={() => {
          if (sortKey === sortKeyForCol) {
            setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
          } else {
            setSortKey(sortKeyForCol);
            // Numeric columns default to descending — biggest-first is what
            // a viewer wants on a "who's better" leaderboard.
            const numeric = sortKeyForCol !== 'eval' && sortKeyForCol !== 'date';
            setSortDir(numeric ? 'desc' : 'asc');
          }
        }}
        style={{
          cursor: 'pointer',
          userSelect: 'none',
          textAlign: align,
          whiteSpace: 'nowrap',
        }}
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        scope="col"
      >
        {label}
        {arrow}
      </th>
    );
  }

  return (
    <div style={{ overflowX: 'auto', margin: '1.5rem 0' }}>
      <table>
        <thead>
          <tr>
            <HeaderCell label="Task" sortKeyForCol="eval" />
            <th scope="col">Config</th>
            <HeaderCell label="CyberBox pass%" sortKeyForCol="cb_pass" align="right" />
            <HeaderCell label="Upstream pass%" sortKeyForCol="up_pass" align="right" />
            <HeaderCell label="Δ pass%" sortKeyForCol="delta" align="right" />
            <HeaderCell label="CyberBox p50" sortKeyForCol="cb_p50" align="right" />
            <HeaderCell label="Upstream p50" sortKeyForCol="up_p50" align="right" />
            <HeaderCell label="Run date" sortKeyForCol="date" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const delta = row.upstream
              ? row.cyberbox.pass_rate - row.upstream.pass_rate
              : null;
            const deltaStr =
              delta === null
                ? '—'
                : `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}%`;
            const deltaColor =
              delta === null ? undefined : delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : undefined;
            return (
              <tr key={row.id}>
                <td>{evalName(row)}</td>
                <td>
                  <a
                    href={`${REPO_BLOB}/${row.config_ref}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {row.config_ref.split('/').pop()}
                  </a>
                </td>
                <td style={{ textAlign: 'right' }}>{fmtPct(row.cyberbox.pass_rate)}</td>
                <td style={{ textAlign: 'right' }}>{fmtPct(row.upstream?.pass_rate)}</td>
                <td style={{ textAlign: 'right', color: deltaColor, fontWeight: 600 }}>
                  {deltaStr}
                </td>
                <td style={{ textAlign: 'right' }}>{fmtMs(row.cyberbox.latency_ms_p50)}</td>
                <td style={{ textAlign: 'right' }}>{fmtMs(row.upstream?.latency_ms_p50)}</td>
                <td>{fmtDate(row.run_timestamp_utc)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default LeaderboardTable;
