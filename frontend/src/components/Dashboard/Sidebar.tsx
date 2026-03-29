import { useState } from 'react'
import { useMindStore } from '../../store/useMindStore'

export function Sidebar() {
  const agents = useMindStore((s) => s.agents)
  const agentList = Object.values(agents)
  const runningCount = agentList.filter((a) => a.status === 'running').length
  const completedCount = agentList.filter((a) => a.status === 'completed').length
  const failedCount = agentList.filter((a) => a.status === 'error').length
  const totalCount = agentList.length

  const [killHover, setKillHover] = useState(false)
  const [recordHover, setRecordHover] = useState(false)

  return (
    <div
      style={{
        width: 320,
        minWidth: 320,
        height: '100%',
        background: 'rgba(26,22,8,0.6)',
        borderRight: '1px solid rgba(212,146,11,0.15)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        overflowY: 'auto',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
      }}
    >
      {/* ── 1. Recommendation ── */}
      <div
        style={{
          background: 'rgba(40,34,16,0.8)',
          borderRadius: 12,
          border: '1px solid rgba(212,146,11,0.2)',
          padding: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D4920B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="2" width="6" height="6" rx="1" />
              <rect x="2" y="9" width="6" height="6" rx="1" />
              <rect x="16" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="16" width="6" height="6" rx="1" />
            </svg>
            <span style={{ color: '#F5E8C8', fontWeight: 600, fontSize: 13 }}>Recommendation</span>
          </div>
          <span
            style={{
              background: 'rgba(232,163,12,0.2)',
              color: '#E8A30C',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            2 News
          </span>
        </div>

        {/* Card 1 — Professor Catch Up */}
        <div
          style={{
            background: 'rgba(26,22,8,0.6)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'rgba(76,175,80,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#4CAF50" stroke="none">
                <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
              </svg>
            </div>
            <div>
              <div style={{ color: '#F5E8C8', fontWeight: 600, fontSize: 12, marginBottom: 3 }}>
                Professor Catch Up!
              </div>
              <div style={{ color: '#8B7A4A', fontSize: 11, lineHeight: 1.4 }}>
                3 upcoming lectures flagged — review notes before Monday.
              </div>
            </div>
          </div>
        </div>

        {/* Card 2 — Financial Statement */}
        <div
          style={{
            background: 'rgba(26,22,8,0.6)',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'rgba(255,152,0,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FF9800" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <div>
              <div style={{ color: '#F5E8C8', fontWeight: 600, fontSize: 12, marginBottom: 3 }}>
                Financial Statement
              </div>
              <div style={{ color: '#8B7A4A', fontSize: 11, lineHeight: 1.4 }}>
                Monthly spending exceeded budget by 12% — tap to review breakdown.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Long Term Goal ── */}
      <div
        style={{
          background: 'rgba(40,34,16,0.8)',
          borderRadius: 12,
          border: '1px solid rgba(212,146,11,0.2)',
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D4920B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          <span style={{ color: '#F5E8C8', fontWeight: 600, fontSize: 13 }}>Long Term Goal</span>
        </div>

        {[
          { label: 'SEMESTER', pct: 85 },
          { label: 'WORKOUT', pct: 42 },
          { label: 'DATING', pct: 12 },
        ].map(({ label, pct }) => (
          <div key={label} style={{ marginBottom: 10 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 4,
              }}
            >
              <span style={{ color: '#8B7A4A', fontSize: 10, fontWeight: 600, letterSpacing: 1 }}>
                {label}
              </span>
              <span style={{ color: '#D4920B', fontSize: 10, fontWeight: 600 }}>{pct}%</span>
            </div>
            <div
              style={{
                width: '100%',
                height: 6,
                background: 'rgba(26,22,8,0.8)',
                borderRadius: 3,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #D4920B, #E8A30C)',
                  borderRadius: 3,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* ── 4. Swarm Status ── */}
      <div
        style={{
          background: 'rgba(40,34,16,0.8)',
          borderRadius: 12,
          border: '1px solid rgba(212,146,11,0.2)',
          padding: 14,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D4920B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span style={{ color: '#F5E8C8', fontWeight: 600, fontSize: 13 }}>SWARM</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {runningCount > 0 && (
              <span
                style={{
                  background: 'rgba(212,146,11,0.2)',
                  color: '#D4920B',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                }}
              >
                {runningCount} buzzing
              </span>
            )}
            {completedCount > 0 && (
              <span
                style={{
                  background: 'rgba(76,175,80,0.2)',
                  color: '#4CAF50',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 10,
                }}
              >
                {completedCount} done
              </span>
            )}
          </div>
        </div>

        <div
          style={{
            background: 'rgba(26,22,8,0.6)',
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            justifyContent: 'space-around',
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ color: '#F5E8C8', fontWeight: 700, fontSize: 18 }}>{totalCount}</div>
            <div style={{ color: '#8B7A4A', fontSize: 10, marginTop: 2 }}>Total</div>
          </div>
          <div style={{ width: 1, background: 'rgba(212,146,11,0.15)' }} />
          <div>
            <div style={{ color: '#4CAF50', fontWeight: 700, fontSize: 18 }}>{completedCount}</div>
            <div style={{ color: '#8B7A4A', fontSize: 10, marginTop: 2 }}>Completed</div>
          </div>
          <div style={{ width: 1, background: 'rgba(212,146,11,0.15)' }} />
          <div>
            <div style={{ color: '#E85D24', fontWeight: 700, fontSize: 18 }}>{failedCount}</div>
            <div style={{ color: '#8B7A4A', fontSize: 10, marginTop: 2 }}>Failed</div>
          </div>
        </div>

        {totalCount > 0 && (
          <button
            onClick={() => {
              const killAgent = useMindStore.getState().killAgent
              for (const agent of agentList) {
                if (agent.status === 'running' || agent.status === 'planning') {
                  killAgent(agent.agentId)
                }
              }
            }}
            onMouseEnter={() => setKillHover(true)}
            onMouseLeave={() => setKillHover(false)}
            style={{
              width: '100%',
              marginTop: 10,
              background: killHover ? 'rgba(232,93,36,0.25)' : 'rgba(232,93,36,0.15)',
              border: '1px solid rgba(232,93,36,0.3)',
              borderRadius: 8,
              color: '#E85D24',
              fontSize: 11,
              fontWeight: 600,
              padding: '7px 0',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              letterSpacing: 0.5,
            }}
          >
            Kill All Active Agents
          </button>
        )}
      </div>

      {/* ── 5. Hive Reports ── */}
      <div
        style={{
          background: 'rgba(40,34,16,0.8)',
          borderRadius: 12,
          border: '1px solid rgba(212,146,11,0.2)',
          padding: 14,
          marginTop: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#D4920B" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span style={{ color: '#F5E8C8', fontWeight: 600, fontSize: 13 }}>Hive Reports</span>
            <span
              style={{
                background: 'rgba(212,146,11,0.2)',
                color: '#D4920B',
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 10,
              }}
            >
              {completedCount + failedCount}
            </span>
          </div>

          <button
            onMouseEnter={() => setRecordHover(true)}
            onMouseLeave={() => setRecordHover(false)}
            style={{
              background: recordHover ? 'rgba(212,146,11,0.2)' : 'rgba(212,146,11,0.1)',
              border: '1px solid rgba(212,146,11,0.25)',
              borderRadius: 6,
              color: '#D4920B',
              fontSize: 10,
              fontWeight: 600,
              padding: '4px 12px',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Record
          </button>
        </div>
      </div>
    </div>
  )
}
