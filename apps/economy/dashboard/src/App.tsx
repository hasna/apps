import { useState } from 'react'
import { OverviewTab } from './tabs/OverviewTab'
import { SessionsTab } from './tabs/SessionsTab'
import { ModelsTab } from './tabs/ModelsTab'
import { ProjectsTab } from './tabs/ProjectsTab'
import { BudgetsTab } from './tabs/BudgetsTab'
import { PricingTab } from './tabs/PricingTab'

type Tab = 'overview' | 'sessions' | 'models' | 'projects' | 'budgets' | 'pricing'

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'models', label: 'Models' },
  { id: 'projects', label: 'Projects' },
  { id: 'budgets', label: 'Budgets' },
  { id: 'pricing', label: 'Pricing' },
]

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('overview')

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f0f0f',
        color: '#e5e7eb',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top nav */}
      <header
        style={{
          background: '#111',
          borderBottom: '1px solid #1e1e1e',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          height: 56,
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: 16,
            color: '#f9fafb',
            letterSpacing: '-0.02em',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: '#3b82f6' }}>◈</span>
          Open Economy
        </div>

        <nav style={{ display: 'flex', gap: 4 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                background: activeTab === t.id ? '#1a1a1a' : 'transparent',
                border: activeTab === t.id ? '1px solid #2a2a2a' : '1px solid transparent',
                borderRadius: 8,
                color: activeTab === t.id ? '#f9fafb' : '#9ca3af',
                padding: '6px 14px',
                fontSize: 14,
                fontWeight: activeTab === t.id ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          padding: '28px 24px',
          maxWidth: 1400,
          width: '100%',
          margin: '0 auto',
        }}
      >
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'sessions' && <SessionsTab />}
        {activeTab === 'models' && <ModelsTab />}
        {activeTab === 'projects' && <ProjectsTab />}
        {activeTab === 'budgets' && <BudgetsTab />}
        {activeTab === 'pricing' && <PricingTab />}
      </main>
    </div>
  )
}

export default App
