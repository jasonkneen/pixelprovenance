import type { ReactNode } from 'react'

export interface DemoSourceSnippet {
  file: string
  startLine: number
  highlightLine: number
  lines: string[]
}

const SOURCE_SNIPPETS: Record<string, DemoSourceSnippet> = {
  'MORROW_DASHBOARD/workspace-nav': {
    file: 'src/features/dashboard/WorkspaceNav.tsx',
    startLine: 15,
    highlightLine: 18,
    lines: [
      'export function WorkspaceNav() {',
      '  return (',
      '    <DevTag',
      '      id="workspace-nav"',
      '      type="navigation"',
      '    >',
      '      <WorkspaceSwitcher workspace={activeWorkspace} />',
      '      <PrimaryNavigation items={navigationItems} />',
      '    </DevTag>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/workspace-nav/nav-overview': {
    file: 'src/features/dashboard/WorkspaceNav.tsx',
    startLine: 25,
    highlightLine: 28,
    lines: [
      '      <nav className="app-nav">',
      '        <DevTag',
      '          id="nav-overview"',
      '          type="nav-item"',
      '          patternSize={32}',
      '        >',
      '          <NavLink href="/overview" active>Overview</NavLink>',
      '        </DevTag>',
      '      </nav>',
    ],
  },
  'MORROW_DASHBOARD/workspace-nav/nav-projects': {
    file: 'src/features/dashboard/WorkspaceNav.tsx',
    startLine: 31,
    highlightLine: 34,
    lines: [
      '        <DevTag',
      '          id="nav-projects"',
      '          type="nav-item"',
      '          patternSize={32}',
      '        >',
      '          <NavLink href="/projects">Projects</NavLink>',
      '        </DevTag>',
    ],
  },
  'MORROW_DASHBOARD/progress-summary': {
    file: 'src/features/dashboard/ProgressSummary.tsx',
    startLine: 22,
    highlightLine: 26,
    lines: [
      'export function ProgressSummary({ completed, planned }: Props) {',
      '  const progress = Math.round((completed / planned) * 100)',
      '',
      '  return (',
      '    <DevTag id="progress-summary" type="metric-card">',
      '      <MetricCard label="Weekly progress" value={`${progress}%`}>',
      '        <Progress value={progress} />',
      '      </MetricCard>',
      '    </DevTag>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/open-tasks': {
    file: 'src/features/dashboard/OpenTasksStat.tsx',
    startLine: 11,
    highlightLine: 14,
    lines: [
      'export function OpenTasksStat({ open, dueToday }: Props) {',
      '  return (',
      '    <DevTag id="open-tasks" type="metric-card">',
      '      <MiniStat label="Open tasks" value={open} hint={`${dueToday} due today`} />',
      '    </DevTag>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/team-focus': {
    file: 'src/features/dashboard/TeamFocusStat.tsx',
    startLine: 11,
    highlightLine: 14,
    lines: [
      'export function TeamFocusStat({ score }: Props) {',
      '  return (',
      '    <DevTag id="team-focus" type="metric-card">',
      '      <MiniStat label="Team focus" value={score} hint="High alignment" />',
      '    </DevTag>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/sprint-overview': {
    file: 'src/features/dashboard/SprintOverview.tsx',
    startLine: 37,
    highlightLine: 41,
    lines: [
      'export function SprintOverview({ sprint }: Props) {',
      '  const remaining = sprint.total - sprint.completed',
      '',
      '  return (',
      '    <DevTag id="sprint-overview" type="project-card">',
      '      <article className="sprint-card">',
      '        <ProjectStatus label="Priority project" daysLeft={3} />',
      '        <h2>{sprint.title}</h2>',
      '        <TaskPills tags={sprint.tags} />',
      '      </article>',
      '    </DevTag>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/sprint-overview/pill-research': {
    file: 'src/features/dashboard/SprintOverview.tsx',
    startLine: 55,
    highlightLine: 58,
    lines: [
      'function TaskPills({ tags }: { tags: string[] }) {',
      '  return (',
      '    <div className="task-pills">',
      '      <DevTag id="pill-research" type="chip" patternSize={32}>',
      '        Research',
      '      </DevTag>',
      '      {/* siblings: design-system, handoff */}',
      '    </div>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/sprint-overview/pill-design-system': {
    file: 'src/features/dashboard/SprintOverview.tsx',
    startLine: 58,
    highlightLine: 61,
    lines: [
      '      <DevTag id="pill-research" type="chip" patternSize={32}>',
      '        Research',
      '      </DevTag>',
      '      <DevTag id="pill-design-system" type="chip" patternSize={32}>',
      '        Design system',
      '      </DevTag>',
      '      <DevTag id="pill-handoff" type="chip" patternSize={32}>',
      '        Handoff',
      '      </DevTag>',
    ],
  },
  'MORROW_DASHBOARD/sprint-overview/pill-handoff': {
    file: 'src/features/dashboard/SprintOverview.tsx',
    startLine: 61,
    highlightLine: 64,
    lines: [
      '      <DevTag id="pill-design-system" type="chip" patternSize={32}>',
      '        Design system',
      '      </DevTag>',
      '      <DevTag id="pill-handoff" type="chip" patternSize={32}>',
      '        Handoff',
      '      </DevTag>',
    ],
  },
  'MORROW_DASHBOARD/activity-feed': {
    file: 'src/features/dashboard/ActivityFeed.tsx',
    startLine: 19,
    highlightLine: 22,
    lines: [
      'export function ActivityFeed({ activity }: Props) {',
      '  return (',
      '    <DevTag',
      '      id="activity-feed"',
      '      type="activity-panel"',
      '    >',
      '      <ActivityList items={activity} />',
      '    </DevTag>',
      '  )',
      '}',
    ],
  },
  'MORROW_DASHBOARD/create-task': {
    file: 'src/features/tasks/CreateTaskButton.tsx',
    startLine: 9,
    highlightLine: 12,
    lines: [
      'export function CreateTaskButton({ onCreate }: Props) {',
      '  return (',
      '    <ToolbarAction>',
      '      <DevTag id="create-task" type="button">',
      '        <button type="button" onClick={onCreate}>',
      '          New task <span aria-hidden="true">+</span>',
      '        </button>',
      '      </DevTag>',
      '    </ToolbarAction>',
      '  )',
      '}',
    ],
  },
}

const TOKEN_PATTERN =
  /(\/\/.*$|\/\*.*?\*\/|'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:\\.|[^`])*`|\b(?:export|function|const|return|type|interface|from|import)\b|<\/?[A-Za-z][\w.-]*|\b\d+\b)/g

function tokenClass(token: string): string {
  if (token.startsWith('//') || token.startsWith('/*')) return 'source-token-comment'
  if (token.startsWith("'") || token.startsWith('"') || token.startsWith('`')) {
    return 'source-token-string'
  }
  if (token.startsWith('<')) return 'source-token-tag'
  if (/^\d+$/.test(token)) return 'source-token-number'
  return 'source-token-keyword'
}

export function getDemoSourceSnippet(path: string): DemoSourceSnippet | null {
  return SOURCE_SNIPPETS[path] ?? null
}

export function highlightTsxLine(line: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0

  for (const match of line.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(line.slice(cursor, index))
    nodes.push(
      <span className={tokenClass(match[0])} key={`${index}-${match[0]}`}>
        {match[0]}
      </span>,
    )
    cursor = index + match[0].length
  }

  if (cursor < line.length) nodes.push(line.slice(cursor))
  return nodes
}
