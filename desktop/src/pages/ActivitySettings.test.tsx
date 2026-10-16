import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom'

import { ActivitySettings } from './ActivitySettings'
import { useSettingsStore } from '../stores/settingsStore'

const { getStatsMock, captureToDataUrlMock } = vi.hoisted(() => ({
  getStatsMock: vi.fn(),
  captureToDataUrlMock: vi.fn(),
}))

const createObjectUrlMock = vi.fn<(value: Blob) => string>(() => 'blob:usage-csv')
const revokeObjectUrlMock = vi.fn()

const {
  getPreferencesMock,
  updateProfilePreferencesMock,
  uploadProfileAvatarMock,
  deleteProfileAvatarMock,
} = vi.hoisted(() => ({
  getPreferencesMock: vi.fn(),
  updateProfilePreferencesMock: vi.fn(),
  uploadProfileAvatarMock: vi.fn(),
  deleteProfileAvatarMock: vi.fn(),
}))

vi.mock('../api/activityStats', () => ({
  activityStatsApi: {
    getStats: getStatsMock,
  },
}))

vi.mock('../preview-agent/screenshot', () => ({
  captureToDataUrl: captureToDataUrlMock,
}))

vi.mock('../api/desktopUiPreferences', () => ({
  desktopUiPreferencesApi: {
    getPreferences: getPreferencesMock,
    updateProfilePreferences: updateProfilePreferencesMock,
    uploadProfileAvatar: uploadProfileAvatarMock,
    deleteProfileAvatar: deleteProfileAvatarMock,
  },
  getProfileAvatarUrl: () => '/api/desktop-ui/preferences/profile/avatar?mock=1',
}))

/**
 * The per-day rows below are the single source of truth for the model sheet, so
 * they are made to add up to `modelUsage` exactly: a fixture whose grains
 * disagree would let a double-counting bug pass.
 */
const activityResponse = {
  range: 'all',
  generatedAt: '2026-05-09T12:00:00.000Z',
  totalSessions: 52,
  totalMessages: 900,
  totalDays: 365,
  activeDays: 20,
  streaks: {
    currentStreak: 9,
    longestStreak: 18,
    currentStreakStart: '2026-05-01',
    longestStreakStart: '2026-03-01',
    longestStreakEnd: '2026-03-18',
  },
  dailyActivity: [
    { date: '2026-04-20', sessionCount: 38, messageCount: 420, toolCallCount: 160 },
    { date: '2026-05-07', sessionCount: 2, messageCount: 30, toolCallCount: 12 },
    { date: '2026-05-09', sessionCount: 4, messageCount: 58, toolCallCount: 21 },
  ],
  dailyModelTokens: [
    { date: '2026-04-20', tokensByModel: { 'claude-sonnet': 2_672_000 } },
    { date: '2026-05-07', tokensByModel: { 'claude-sonnet': 64_000 } },
    { date: '2026-05-09', tokensByModel: { 'claude-sonnet': 128_000 } },
  ],
  longestSession: null,
  modelUsage: {
    'claude-sonnet': {
      inputTokens: 1_900_000,
      outputTokens: 700_000,
      cacheReadInputTokens: 230_000,
      cacheCreationInputTokens: 34_000,
      costUSD: 12.5,
    },
  },
  unpricedModels: [],
  dailyModelUsage: [
    { date: '2026-04-20', model: 'claude-sonnet', inputTokens: 1_800_000, outputTokens: 660_000, cacheReadInputTokens: 200_000, cacheCreationInputTokens: 12_000, costUSD: 9.5 },
    { date: '2026-05-07', model: 'claude-sonnet', inputTokens: 40_000, outputTokens: 20_000, cacheReadInputTokens: 4_000, cacheCreationInputTokens: 0, costUSD: 1 },
    { date: '2026-05-09', model: 'claude-sonnet', inputTokens: 60_000, outputTokens: 20_000, cacheReadInputTokens: 26_000, cacheCreationInputTokens: 22_000, costUSD: 2 },
  ],
  projectUsage: [
    { date: '2026-05-07', projectPath: 'C--proj-alpha', projectName: 'proj-alpha', sessionCount: 1, messageCount: 30, toolCallCount: 12, inputTokens: 40_000, outputTokens: 20_000, cacheReadInputTokens: 4_000, cacheCreationInputTokens: 0, costUSD: 1 },
    { date: '2026-05-09', projectPath: 'C--proj-alpha', projectName: 'proj-alpha', sessionCount: 2, messageCount: 58, toolCallCount: 21, inputTokens: 60_000, outputTokens: 20_000, cacheReadInputTokens: 26_000, cacheCreationInputTokens: 22_000, costUSD: 2 },
    { date: '2026-05-09', projectPath: 'C--proj-beta', projectName: 'proj-beta', sessionCount: 2, messageCount: 10, toolCallCount: 3, inputTokens: 5_000, outputTokens: 1_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
  ],
  sessionUsage: [
    // A parent that exists only as subagent transcripts: real spend, but no
    // recorded duration, so the sheet must label it rather than show 0m.
    { sessionId: 'sess-agent-only', projectPath: 'C--proj-beta', projectName: 'proj-beta', hasMainSession: false, startedAt: '2026-05-09T11:00:00.000Z', activeDurationMs: 0, messageCount: 0, inputTokens: 2_000, outputTokens: 200, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
    { sessionId: 'sess-old-1', projectPath: 'C--proj-alpha', projectName: 'proj-alpha', hasMainSession: true, startedAt: '2026-04-20T09:00:00.000Z', activeDurationMs: 600_000, messageCount: 4, inputTokens: 1_000, outputTokens: 100, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
    { sessionId: 'sess-alpha-1', projectPath: 'C--proj-alpha', projectName: 'proj-alpha', hasMainSession: true, startedAt: '2026-05-07T09:00:00.000Z', activeDurationMs: 5_400_000, messageCount: 30, inputTokens: 40_000, outputTokens: 20_000, cacheReadInputTokens: 4_000, cacheCreationInputTokens: 0, costUSD: 1 },
    { sessionId: 'sess-beta-1', projectPath: 'C--proj-beta', projectName: 'proj-beta', hasMainSession: true, startedAt: '2026-05-09T09:00:00.000Z', activeDurationMs: 1_800_000, messageCount: 10, inputTokens: 5_000, outputTokens: 1_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
  ],
  toolUsage: {
    Bash: 180,
    Read: 160,
    Skill: 40,
    mcp__github__get_pull_request: 14,
    mcp__chrome_devtools__new_page: 8,
    mcp__figma__get_screenshot: 7,
    mcp__linear__create_issue: 2,
  },
  skillUsage: {
    'frontend-design': 24,
    'git-commit-pr': 16,
    'code-review': 11,
  },
  firstSessionDate: '2025-06-01T10:00:00.000Z',
  lastSessionDate: '2026-05-09T11:00:00.000Z',
  peakActivityDay: '2026-04-20',
  peakActivityHour: 14,
  // JSON keys arrive as strings, and the fixture leaves gaps on purpose so the
  // histogram has to fill the missing hours with zeroes.
  hourCounts: { 9: 4, 10: 1, 14: 6, 23: 2 },
  totalSpeculationTimeSavedMs: 0,
}

async function flushActivityLoad() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function openView(name: string) {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Usage views' })).getByRole('radio', { name }))
}

function selectRange(name: string) {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Time range' })).getByRole('radio', { name }))
}

describe('ActivitySettings', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-09T12:00:00'))
    getStatsMock.mockReset()
    getStatsMock.mockResolvedValue(activityResponse)
    captureToDataUrlMock.mockReset()
    captureToDataUrlMock.mockResolvedValue('data:image/png;base64,MOCK')
    createObjectUrlMock.mockClear()
    revokeObjectUrlMock.mockClear()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrlMock })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrlMock })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    getPreferencesMock.mockReset()
    updateProfilePreferencesMock.mockReset()
    uploadProfileAvatarMock.mockReset()
    deleteProfileAvatarMock.mockReset()
    getPreferencesMock.mockResolvedValue({
      exists: false,
      preferences: {
        schemaVersion: 2,
        profile: {
          displayName: 'cc-haha',
          subtitle: 'github.com/NanmiCoder/cc-haha',
          avatarFile: null,
          avatarUpdatedAt: null,
        },
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    })
    updateProfilePreferencesMock.mockImplementation((profile) => Promise.resolve({
      ok: true,
      preferences: {
        schemaVersion: 2,
        profile: {
          displayName: profile.displayName,
          subtitle: profile.subtitle,
          avatarFile: null,
          avatarUpdatedAt: null,
        },
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    }))
    uploadProfileAvatarMock.mockImplementation(() => Promise.resolve({
      ok: true,
      preferences: {
        schemaVersion: 2,
        profile: {
          displayName: 'cc-haha',
          subtitle: 'github.com/NanmiCoder/cc-haha',
          avatarFile: 'profile/avatar.png',
          avatarUpdatedAt: '2026-05-09T12:00:00.000Z',
        },
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    }))
    deleteProfileAvatarMock.mockImplementation(() => Promise.resolve({
      ok: true,
      preferences: {
        schemaVersion: 2,
        profile: {
          displayName: 'cc-haha',
          subtitle: 'github.com/NanmiCoder/cc-haha',
          avatarFile: null,
          avatarUpdatedAt: null,
        },
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    }))
    useSettingsStore.setState({ locale: 'en' })
    // The page mirrors view/range/model selection into the query string and the
    // filter's open state into localStorage; both would leak between cases.
    window.history.replaceState(null, '', '/')
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('renders summary metrics and a GitHub-style trailing heatmap without future days', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()

    expect(getStatsMock).toHaveBeenCalledWith('all')

    expect(screen.getByText('cc-haha')).toBeInTheDocument()
    expect(screen.getByAltText('cc-haha avatar')).toHaveAttribute('src', '/app-icon.png')
    expect(screen.getByAltText('cc-haha avatar')).toHaveClass('scale-[1.28]')
    expect(screen.getByRole('link', { name: 'github.com/NanmiCoder/cc-haha' })).toHaveAttribute(
      'href',
      'https://github.com/NanmiCoder/cc-haha',
    )
    expect(screen.getByRole('heading', { name: 'Token Activity' })).toBeInTheDocument()
    expect(screen.getByText('Total tokens')).toBeInTheDocument()
    expect(screen.getByText('Peak tokens')).toBeInTheDocument()
    expect(screen.getByText('Longest task')).toBeInTheDocument()
    expect(screen.getByText('Current streak')).toBeInTheDocument()
    expect(screen.getByText('Longest streak')).toBeInTheDocument()
    // Compact-formatter units, not M/K: the shipped build renders 万/亿.
    expect(screen.getAllByText('286万').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('267万').length).toBeGreaterThan(0)
    expect(screen.getByText('0m')).toBeInTheDocument()
    expect(screen.getByText('9 days')).toBeInTheDocument()
    expect(screen.getByText('18 days')).toBeInTheDocument()
    expect(screen.getByText('Activity insights')).toBeInTheDocument()
    expect(screen.getByText('Active rate')).toBeInTheDocument()
    expect(screen.getByText('Most used model')).toBeInTheDocument()
    expect(screen.getByText('Total sessions')).toBeInTheDocument()
    expect(screen.getByText('Tool calls')).toBeInTheDocument()
    expect(screen.getAllByText('Sonnet').length).toBeGreaterThan(0)
    expect(screen.getAllByText('May').length).toBeGreaterThan(0)
    expect(screen.queryByText('5月')).not.toBeInTheDocument()
    // May 2026 starts in the final column, too late to fit its name.
    expect(screen.getByTestId('activity-month-labels').lastElementChild).toHaveTextContent('Apr')

    const todayCell = screen.getByRole('gridcell', {
      name: /May 9, 2026: 4 sessions · 13万 Tokens/i,
    })
    expect(todayCell).toBeInTheDocument()
    expect(screen.queryByRole('gridcell', { name: /May 10, 2026/i })).not.toBeInTheDocument()

    // Compact model and project rankings are visible; full sheets stay one click away.
    expect(screen.getByRole('heading', { name: 'Usage by model' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Usage by project' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Tool call ranking' })).not.toBeInTheDocument()
    // This one asserts the whole overview in a single pass — the 364-cell grid
    // plus every summary tile — and needs more than the 5s default on a loaded
    // machine. Nothing here waits, so the ceiling is headroom, not a crutch.
  }, 20_000)

  it('shows a compact hover preview without a persistent selected-day panel', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()

    const todayCell = screen.getByRole('gridcell', {
      name: /May 9, 2026: 4 sessions · 13万 Tokens/i,
    })

    fireEvent.mouseEnter(todayCell)
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('May 9, 2026')
    expect(tooltip).toHaveTextContent('4 sessions · 13万 Tokens')
    expect(tooltip).not.toHaveTextContent(/messages|tools/i)
    expect(tooltip.className).toContain('--color-activity-tooltip-surface')
    expect(tooltip.className).toContain('--color-activity-tooltip-border')
    expect(todayCell.className).toContain('activity-heat-cell')
    expect(todayCell.className).toContain('is-active')
    expect(todayCell.className).toContain('--color-activity-cell-border')
    expect(screen.queryByText('Selected day')).not.toBeInTheDocument()
  })

  it('keeps the profile edit control out of screenshots until hover or keyboard focus', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()

    const editButton = screen.getByRole('button', { name: 'Edit profile' })
    expect(editButton).toHaveClass('opacity-0')
    expect(editButton).toHaveClass('group-hover/activity-profile:opacity-100')
    expect(editButton).toHaveClass('focus-visible:opacity-100')
    expect(editButton.closest('div')).toHaveClass('group/activity-profile')
  })

  it('lays the summary out as KPI tiles whose column count comes from the container, not the viewport', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()

    const headlinePanel = screen.getByText('Total tokens').closest('section')
    expect(headlinePanel).toHaveClass('activity-primary-grid')
    expect(within(headlinePanel as HTMLElement).getByText('286万')).toBeInTheDocument()
    expect(within(headlinePanel as HTMLElement).getByText('Estimated cost')).toBeInTheDocument()

    const summaryPanel = screen.getByText('Peak tokens').closest('section')
    expect(summaryPanel).toHaveClass('activity-summary-panel')
    expect(summaryPanel?.querySelectorAll('.activity-summary-metric')).toHaveLength(4)
    // Compact supporting metrics use a container query; the rail must not cram them.
    const summaryGrid = summaryPanel?.querySelector('.activity-summary-grid')
    expect(summaryGrid).not.toHaveClass('sm:grid-cols-2')
    expect(summaryGrid).not.toHaveClass('lg:grid-cols-5')

    // Two lines, not one truncated line: at a third of the row a duration like
    // "436 小时 26 分钟" rendered as "436 小…". Clamping still caps the growth, so
    // the tiles stay compact.
    const longestTaskValue = screen.getByText('0m')
    expect(longestTaskValue).toHaveClass('activity-summary-value')
    expect(longestTaskValue).toHaveClass('line-clamp-2')
    expect(longestTaskValue).toHaveClass('tabular-nums')
    expect(longestTaskValue).not.toHaveClass('break-words')
  })

  it('places heatmap month labels by week without collisions or overhang', async () => {
    // The 52-week window then opens on Sunday 2024-01-28: January's last four
    // days sit in column 0 and February starts in column 1.
    vi.setSystemTime(new Date('2025-01-20T12:00:00'))
    render(<ActivitySettings />)

    await flushActivityLoad()

    const labels = Array.from(screen.getByTestId('activity-month-labels').children) as HTMLElement[]
    const texts = labels.map((label) => label.textContent)
    // January's 4-day tail would have collided with February, so it is dropped.
    expect(texts[0]).toBe('Feb')
    expect(texts).toHaveLength(12)
    expect(texts[texts.length - 1]).toBe('Jan')

    const lefts = labels.map((label) => Number.parseFloat(label.style.left))
    // February sits in column 1, so its offset is exactly one cell plus gap.
    const cellPitch = lefts[0]!
    expect(cellPitch).toBeGreaterThan(0)
    for (let index = 1; index < lefts.length; index += 1) {
      expect(lefts[index]! - lefts[index - 1]!).toBeGreaterThanOrEqual(cellPitch * 3)
    }
    // No label starts in the last two columns, where it would overhang the grid.
    expect(Math.max(...lefts)).toBeLessThanOrEqual(cellPitch * 49)
  })

  it('charts all available four-dimensional days and narrows the chart and headline in place', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    const chart = () => screen.getByRole('list', { name: 'Token usage by day' })
    let bars = within(chart()).getAllByRole('listitem')
    expect(bars).toHaveLength(3)
    expect(bars[0]).toHaveTextContent('Apr 20, 2026: 267万 Tokens')
    expect(bars[2]).toHaveAttribute('title', expect.stringContaining('Cache read 3万'))
    expect(bars[2]!.querySelectorAll('[aria-hidden="true"] span')).toHaveLength(4)

    selectRange('Last 7 days')
    bars = within(chart()).getAllByRole('listitem')
    expect(bars).toHaveLength(7)
    expect(bars[0]).toHaveTextContent('May 3, 2026: 0 Tokens')
    expect(bars[4]).toHaveTextContent('May 7, 2026: 6万 Tokens')
    expect(bars[6]).toHaveTextContent('May 9, 2026: 13万 Tokens')
    expect(within(chart()).queryByText(/Apr 20, 2026/)).not.toBeInTheDocument()
    expect(bars[6]!.firstElementChild).toHaveStyle({ height: '100%' })
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('keeps the headline on the full daily series instead of the shorter index subset', async () => {
    // The index starts on 04-15 here while the daily series reaches back to
    // 04-20-with-earlier-data. Folding the index reads to answer "all time" made
    // the headline read 30亿 against a real 52亿 on a live machine.
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      dailyModelTokens: [
        { date: '2026-04-15', tokensByModel: { 'claude-sonnet': 500_000 } },
        { date: '2026-04-20', tokensByModel: { 'claude-sonnet': 2_172_000 } },
        { date: '2026-05-07', tokensByModel: { 'claude-sonnet': 64_000 } },
        { date: '2026-05-09', tokensByModel: { 'claude-sonnet': 128_000 } },
      ],
      dailyModelUsage: activityResponse.dailyModelUsage.filter((row) => row.date !== '2026-04-20'),
      projectUsage: activityResponse.projectUsage.filter((row) => row.date !== '2026-04-20'),
      sessionUsage: activityResponse.sessionUsage.filter((row) => !row.startedAt.startsWith('2026-04-20')),
    })
    render(<ActivitySettings />)
    await flushActivityLoad()

    const headline = screen.getByText('Total tokens').closest('section')!
    // 286万 = every day. The index-only fold would have been 236万.
    expect(within(headline).getByText('286万')).toBeInTheDocument()
    expect(within(headline).getByText(/which starts/)).toBeInTheDocument()

    // The model sheet matches the stock usage page over the whole history, not
    // just the days the index happens to hold.
    openView('Model cost')
    const modelTable = screen.getByRole('heading', { name: 'Tokens by model' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    const modelCells = within(modelTable).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))
    expect(modelCells).toEqual([['claude-sonnet', '190万', '70万', '23万', '3万', '$12.50']])
    expect(within(modelTable).queryByText('236万')).not.toBeInTheDocument()

    openView('Projects')
    const note = screen.getByText(/which starts/)
    // The index starts on 05-07 here, so 04-15 and 04-20 are outside it.
    expect(note).toHaveTextContent('which starts 5/7')
    expect(note).toHaveTextContent('earlier 2 days are missing')

    openView('Diagnostics')
    expect(screen.getByText(/Local index covers fewer days/)).toBeInTheDocument()
  })

  it('shows session starts per local hour and marks the peak', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    const histogram = screen.getByRole('list', { name: 'Starts by hour of day' })
    const buckets = within(histogram).getAllByRole('listitem')
    expect(buckets).toHaveLength(24)
    // Hours the index never recorded are drawn at zero, not dropped: a missing
    // hour would silently rescale the chart.
    expect(buckets[0]).toHaveTextContent('00:00: 0')
    expect(buckets[9]).toHaveTextContent('09:00: 4')
    expect(buckets[14]).toHaveTextContent('14:00: 6')
    expect(screen.getByText('Peak 14:00 · 6 sessions')).toBeInTheDocument()
    expect(buckets[14]!.firstElementChild).toHaveStyle({ height: '100%' })
    expect(buckets[9]!.firstElementChild).toHaveStyle({ height: '66.66666666666666%' })
    // The hour is the machine's local hour, and only main transcripts carry it.
    expect(screen.getByText(/Local time, main transcripts only/)).toBeInTheDocument()
  })

  it('omits the hour histogram when the sidecar reports no hour counts', async () => {
    getStatsMock.mockResolvedValueOnce({ ...activityResponse, hourCounts: undefined })
    render(<ActivitySettings />)
    await flushActivityLoad()

    expect(screen.queryByRole('list', { name: 'Starts by hour of day' })).not.toBeInTheDocument()
  })

  it('sorts a ranking by a clicked column and reports the direction', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()
    openView('Projects')

    const table = screen.getByRole('heading', { name: 'Usage by project' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    const projectColumn = () => within(table).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]!.textContent)

    expect(projectColumn()).toEqual(['proj-alpha', 'proj-beta'])

    const tokensHeader = within(table).getByRole('columnheader', { name: /Total tokens/ })
    // First click on a new column starts descending, so the default order holds.
    fireEvent.click(within(tokensHeader).getByRole('button'))
    expect(tokensHeader).toHaveAttribute('aria-sort', 'descending')
    expect(projectColumn()).toEqual(['proj-alpha', 'proj-beta'])

    // Second click on the same column flips it, which is the visible change.
    fireEvent.click(within(tokensHeader).getByRole('button'))
    expect(tokensHeader).toHaveAttribute('aria-sort', 'ascending')
    expect(projectColumn()).toEqual(['proj-beta', 'proj-alpha'])
    // Sorting is a view concern: it must not re-read the index.
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('searches ranking tables and can expand a Top 10 to all rows', async () => {
    getStatsMock.mockResolvedValue({
      ...activityResponse,
      projectUsage: Array.from({ length: 12 }, (_, index) => ({
        date: '2026-05-09',
        projectPath: `C--project-${String(index + 1).padStart(2, '0')}`,
        projectName: `project-${String(index + 1).padStart(2, '0')}`,
        sessionCount: 1,
        messageCount: 1,
        toolCallCount: 1,
        inputTokens: 12 - index,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: 0,
      })),
    })
    render(<ActivitySettings />)
    await flushActivityLoad()
    openView('Projects')

    const projectTable = () => screen.getByRole('heading', { name: 'Usage by project' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    expect(within(projectTable()).getAllByRole('row')).toHaveLength(11)

    fireEvent.change(screen.getByLabelText('Top rows'), { target: { value: 'all' } })
    expect(within(projectTable()).getAllByRole('row')).toHaveLength(13)

    fireEvent.change(screen.getByLabelText('Search table'), { target: { value: 'PROJECT-12' } })
    expect(within(projectTable()).getAllByRole('row')).toHaveLength(2)
    expect(within(projectTable()).getByText('project-12')).toBeInTheDocument()

    const sessionTable = screen.getByRole('heading', { name: 'Session ranking' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    fireEvent.change(screen.getByLabelText('Search sessions'), { target: { value: 'sess-beta' } })
    expect(within(sessionTable).getAllByRole('row')).toHaveLength(2)
    expect(within(sessionTable).getByText('sess-bet')).toBeInTheDocument()
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('splits the trend onto two scales when the cache volumes dwarf input and output', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    fireEvent.click(screen.getByRole('button', { name: 'Split scales' }))

    const cacheChart = screen.getByRole('list', { name: /Token usage by day · Cache scale/ })
    const ioChart = screen.getByRole('list', { name: /Token usage by day · Input \/ output scale/ })
    // Each chart carries only its own dimensions, in both the tooltip and the
    // accessible name — a split chart that still described the other series
    // would be lying about what the bar height means.
    const cacheDay = within(cacheChart).getAllByRole('listitem')[2]!
    expect(cacheDay).toHaveAttribute('title', expect.stringContaining('Cache read 3万'))
    expect(cacheDay.getAttribute('title')).not.toContain('Input')
    // Each chart scales to its own peak: 04-20 tops both, but on the cache scale
    // the 05-09 bar is a fifth of it rather than a sliver.
    expect(within(cacheChart).getAllByRole('listitem')[0]!.firstElementChild).toHaveStyle({ height: '100%' })
    expect(within(ioChart).getAllByRole('listitem')[0]!.firstElementChild).toHaveStyle({ height: '100%' })
    expect(within(ioChart).getAllByRole('listitem')[2]!.firstElementChild).not.toHaveStyle({ height: '100%' })
  })

  it('draws the cache series taller once they stop sharing a scale with input and output', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    const dayBarHeight = (chart: HTMLElement, index: number) =>
      Number.parseFloat((within(chart).getAllByRole('listitem')[index]!.firstElementChild as HTMLElement).style.height)

    const combined = screen.getByRole('list', { name: 'Token usage by day' })
    const combinedDayTwo = dayBarHeight(combined, 2)

    fireEvent.click(screen.getByRole('button', { name: 'Split scales' }))
    const cacheChart = screen.getByRole('list', { name: /Token usage by day · Cache scale/ })
    const cacheDayTwo = dayBarHeight(cacheChart, 2)

    // Same day, same data: 26k + 22k of cache is a tall bar on a cache-only
    // scale (48k / 212k ≈ 23%) and a sliver beside 2.4M of input (128k / 2.7M ≈ 5%).
    expect(cacheDayTwo).toBeGreaterThan(combinedDayTwo * 3)
  })

  it('polls on the auto-refresh cadence and stops when switched off', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()
    expect(getStatsMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-refresh' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    await flushActivityLoad()
    expect(getStatsMock).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-refresh on' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    await flushActivityLoad()
    expect(getStatsMock).toHaveBeenCalledTimes(2)
  })

  it('mirrors view, range and model selection into the URL and can reopen from it', async () => {
    const { unmount } = render(<ActivitySettings />)
    await flushActivityLoad()

    // The filter only exists on the overview and model sheets, so it is toggled
    // before navigating away.
    fireEvent.click(screen.getByText('Models: 1 of 1'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude-sonnet' }))
    openView('Projects')
    selectRange('Last 7 days')

    const params = new URLSearchParams(window.location.search)
    expect(params.get('ti.view')).toBe('projects')
    expect(params.get('ti.range')).toBe('7d')
    expect(params.get('ti.models')).toBe('claude-sonnet')

    // A bookmarked URL reopens the same slice instead of the default view.
    unmount()
    window.history.replaceState(null, '', '/?ti.view=models&ti.range=30d')
    render(<ActivitySettings />)
    await flushActivityLoad()
    expect(screen.getByRole('radio', { name: 'Model cost' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Last 30 days' })).toHaveAttribute('aria-checked', 'true')
  })

  it('remembers the model filter open state across mounts', async () => {
    const { unmount } = render(<ActivitySettings />)
    await flushActivityLoad()

    const details = screen.getByText('Models: 1 of 1').closest('details') as HTMLDetailsElement
    // jsdom does not flip `<details>` on a summary click, so the DOM state and
    // the toggle event are set the way the browser would.
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(window.localStorage.getItem('ti.details.modelFilter')).toBe('open')

    unmount()
    render(<ActivitySettings />)
    await flushActivityLoad()
    // Reopened from storage rather than starting collapsed again.
    expect(screen.getByText('Models: 1 of 1').closest('details')).toHaveAttribute('open')
  })

  it('links every overview block the long page needs to reach', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    const nav = screen.getByRole('navigation', { name: 'Jump to' })
    const targets = within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))
    expect(targets).toEqual([
      '#activity-trend',
      '#activity-hours',
      '#activity-models',
      '#activity-projects',
      '#activity-heatmap',
    ])
    // Every anchor must resolve, or the jump silently does nothing.
    for (const target of targets) {
      expect(document.getElementById(target!.slice(1))).toBeInTheDocument()
    }
  })

  it('filters model-backed totals without changing project attribution', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    fireEvent.click(screen.getByText('Models: 1 of 1'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'claude-sonnet' }))

    expect(screen.getByText('Models: 0 of 1')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Overview' })).getByText('0')).toBeInTheDocument()
    expect(screen.getByText('proj-alpha')).toBeInTheDocument()
    expect(screen.getByText('Affects token trends and model totals only.')).toBeInTheDocument()
  })

  it('switches the trend to an exact daily table', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Trend display' })).getByRole('radio', { name: 'Table' }))

    const table = screen.getByRole('table', { name: 'Table' })
    expect(within(table).getAllByRole('row')).toHaveLength(4)
    expect(within(table).getByText('4/20')).toBeInTheDocument()
    expect(within(table).getByText('267万')).toBeInTheDocument()
  })

  it('exports the current filtered trend as CSV', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()
    selectRange('Last 7 days')

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1)
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:usage-csv')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it('exports structured JSON for the current view and filters', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()
    selectRange('Last 7 days')

    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }))

    expect(createObjectUrlMock).toHaveBeenCalledTimes(1)
    expect(createObjectUrlMock.mock.calls[0]![0]).toBeInstanceOf(Blob)
    expect((createObjectUrlMock.mock.calls[0]![0] as Blob).type).toBe('application/json;charset=utf-8')
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:usage-csv')
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it('exports the rendered current view as PNG', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    fireEvent.click(screen.getByRole('button', { name: 'Export PNG' }))
    await act(async () => { await Promise.resolve() })

    expect(captureToDataUrlMock).toHaveBeenCalledWith('element', expect.any(HTMLDivElement))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1)
  })

  it('reloads the local statistics only when refresh is requested', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()
    expect(getStatsMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Refresh data' }))
    await flushActivityLoad()

    expect(getStatsMock).toHaveBeenCalledTimes(2)
    expect(getStatsMock).toHaveBeenLastCalledWith('all')
  })

  it('opens the model ranking details with the same selected range', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()
    selectRange('Last 7 days')
    const modelRanking = screen.getByRole('heading', { name: 'Usage by model' }).closest('div')?.parentElement as HTMLElement
    fireEvent.click(within(modelRanking).getByRole('button', { name: 'View details' }))
    expect(screen.getByRole('radio', { name: 'Model cost' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: 'Last 7 days' })).toHaveAttribute('aria-checked', 'true')
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('reports collection coverage on the overview and lists it again in diagnostics', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()

    const coverage = screen.getByRole('heading', { name: 'Collection coverage' }).closest('section')!
    expect(within(coverage).getByText(/Four token dimensions/)).toBeInTheDocument()
    expect(within(coverage).getByText(/Tool call duration/)).toBeInTheDocument()

    openView('Diagnostics')
    const rows = screen.getAllByText('Tool call duration')
    // Stated as a gap, not rendered as a zero that reads like measured data.
    expect(rows.length).toBeGreaterThan(0)
    expect(screen.getAllByText('not collected').length).toBeGreaterThan(0)
    expect(screen.getByText('Per-tool duration and failure rate')).toBeInTheDocument()
  })

  it('breaks every token dimension down per model and marks unpriced models', async () => {
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      modelUsage: {
        'claude-sonnet': { inputTokens: 1_900_000, outputTokens: 700_000, cacheReadInputTokens: 230_000, cacheCreationInputTokens: 34_000, costUSD: 12.5 },
        'glm-4.6': { inputTokens: 40_000, outputTokens: 2_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      },
      unpricedModels: ['glm-4.6'],
      dailyModelUsage: [
        ...activityResponse.dailyModelUsage,
        { date: '2026-05-09', model: 'glm-4.6', inputTokens: 40_000, outputTokens: 2_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      ],
    })
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Model cost')

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual([
      'Model',
      'Input',
      'Output',
      'Cache read',
      'Cache write',
      'Estimated cost',
    ])
    // Sorted by total tokens, largest first, with the four buckets kept apart.
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'claude-sonnet',
      '190万',
      '70万',
      '23万',
      '3万',
      '$12.50',
    ])
    expect(within(rows[2]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'glm-4.6',
      '4万',
      '2000',
      '0',
      '0',
      '—',
    ])

    // Unpriced models are named rather than folded into the dollar figure.
    const unpriced = screen.getByRole('heading', { name: 'Unpriced models' }).closest('section')!
    expect(within(unpriced).getByText('glm-4.6')).toBeInTheDocument()
    expect(within(unpriced).getByText('no published rate')).toBeInTheDocument()
  })

  it('shows cost share across priced models only', async () => {
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      modelUsage: {
        ...activityResponse.modelUsage,
        'claude-haiku': {
          inputTokens: 1_000,
          outputTokens: 0,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          costUSD: 12.5,
        },
      },
      dailyModelUsage: [
        ...activityResponse.dailyModelUsage,
        { date: '2026-05-09', model: 'claude-haiku', inputTokens: 1_000, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 12.5 },
      ],
    })
    render(<ActivitySettings />)
    await flushActivityLoad()
    openView('Model cost')

    const costShare = screen.getByRole('heading', { name: 'Cost share' }).closest('section')!
    expect(within(costShare).getAllByText('$12.50 · 50%')).toHaveLength(2)
    expect(within(costShare).getByText(/unpriced models are excluded/)).toBeInTheDocument()
  })

  it('separates priced cost from unpriced models instead of reading $0 as the whole bill', async () => {
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      modelUsage: {
        'glm-4.6': { inputTokens: 40_000, outputTokens: 2_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
        'deepseek-flash': { inputTokens: 5_000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      },
      unpricedModels: ['glm-4.6', 'deepseek-flash'],
      dailyModelUsage: [
        { date: '2026-05-09', model: 'glm-4.6', inputTokens: 40_000, outputTokens: 2_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
        { date: '2026-05-09', model: 'deepseek-flash', inputTokens: 5_000, outputTokens: 500, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      ],
    })
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Model cost')

    // The headline must NOT be a bare "$0.00", which would read as "free".
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    // The headline dash and the per-row dashes for unpriced models both render.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    // The detail names both halves: what is priced, and what is excluded.
    expect(screen.getByText('Priced $0.00 · 2 unpriced models excluded')).toBeInTheDocument()
  })

  it('narrows the model sheet in place, without refetching on every range change', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Model cost')

    expect(screen.getAllByText('$12.50').length).toBeGreaterThan(0)

    selectRange('Last 7 days')

    // Cutting 04-20 drops 1.8M input / 660K output but keeps the newer days.
    const cells = within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent)
    expect(cells).toEqual(['claude-sonnet', '10万', '4万', '3万', '2万', '$3.00'])
    // One load on mount, none per range switch: the window is narrowed locally.
    expect(getStatsMock).toHaveBeenCalledTimes(1)

    selectRange('All time')
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['claude-sonnet', '190万', '70万', '23万', '3万', '$12.50'])
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('narrows every sheet to a custom window, end bound included', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Model cost')
    selectRange('Custom')

    // Seeded to the last 30 days, so switching to Custom is never an empty
    // window the user has to dig themselves out of.
    expect(screen.getByLabelText('Range start')).toHaveValue('2026-04-10')
    expect(screen.getByLabelText('Range end')).toHaveValue('2026-05-09')

    fireEvent.change(screen.getByLabelText('Range start'), { target: { value: '2026-04-01' } })
    fireEvent.change(screen.getByLabelText('Range end'), { target: { value: '2026-05-07' } })

    // 04-20 and 05-07 are in; 05-09 sits behind the end bound and must be
    // dropped, which a lower-bound-only filter would have silently counted.
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((cell) => cell.textContent))
      .toEqual(['claude-sonnet', '184万', '68万', '20万', '1万', '$10.50'])
    // Narrowed locally, like a preset range: no refetch per bound change.
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('compares a bounded window with the immediately preceding equal period', async () => {
    getStatsMock.mockResolvedValue({
      ...activityResponse,
      dailyModelTokens: [
        activityResponse.dailyModelTokens[0],
        { date: '2026-05-05', tokensByModel: { 'claude-sonnet': 96_000 } },
        ...activityResponse.dailyModelTokens.slice(1),
      ],
    })
    render(<ActivitySettings />)
    await flushActivityLoad()

    selectRange('Custom')
    fireEvent.change(screen.getByLabelText('Range start'), { target: { value: '2026-05-07' } })
    fireEvent.change(screen.getByLabelText('Range end'), { target: { value: '2026-05-09' } })

    // 192k in the selected three days against 96k in the previous three.
    expect(screen.getByText(/\+100% vs previous period \(10万 tokens\)/)).toBeInTheDocument()
    expect(getStatsMock).toHaveBeenCalledTimes(1)
  })

  it('carries the custom bounds in the URL and clears them for a preset range', async () => {
    render(<ActivitySettings />)
    await flushActivityLoad()

    selectRange('Custom')
    fireEvent.change(screen.getByLabelText('Range start'), { target: { value: '2026-04-01' } })
    fireEvent.change(screen.getByLabelText('Range end'), { target: { value: '2026-05-07' } })

    let params = new URLSearchParams(window.location.search)
    expect(params.get('ti.range')).toBe('custom')
    expect(params.get('ti.from')).toBe('2026-04-01')
    expect(params.get('ti.to')).toBe('2026-05-07')

    // A stale bound left behind would reopen a later bookmarked URL on a window
    // the control no longer shows.
    selectRange('Last 7 days')
    params = new URLSearchParams(window.location.search)
    expect(params.get('ti.range')).toBe('7d')
    expect(params.get('ti.from')).toBeNull()
    expect(params.get('ti.to')).toBeNull()
  })

  it('names the index gap and declines to price a custom window that predates it', async () => {
    getStatsMock.mockResolvedValue({
      ...activityResponse,
      // The cached daily series reaches back further than the local index does,
      // which is the machine's real situation: 45 days against 22.
      dailyModelTokens: [
        { date: '2026-04-01', tokensByModel: { 'claude-sonnet': 5_000_000 } },
        ...activityResponse.dailyModelTokens,
      ],
    })
    render(<ActivitySettings />)
    await flushActivityLoad()

    selectRange('Custom')
    fireEvent.change(screen.getByLabelText('Range start'), { target: { value: '2026-04-01' } })
    fireEvent.change(screen.getByLabelText('Range end'), { target: { value: '2026-04-10' } })

    // The headline reads the full series, so it reports the 5M the index never saw.
    expect(screen.getAllByText('500万').length).toBeGreaterThan(0)
    // The cost is folded from the index, which has nothing for these days. A
    // `$0.00` beside that headline would read as "that period was free".
    expect(screen.getByText('Cost for this range needs the local index.')).toBeInTheDocument()
    // And the days the index cannot speak for are named rather than dropped.
    expect(screen.getByText(/the local index, which starts/)).toBeInTheDocument()
  })

  it('ranks projects and sessions, and drops out-of-window sessions on a narrower range', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Projects')

    const projectTable = screen.getByRole('heading', { name: 'Usage by project' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    const projectRows = within(projectTable).getAllByRole('row')
    expect(within(projectRows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'proj-alpha', '3', '88', '19万', '$3.00',
    ])
    // Zero known cost reads as "no rate", not as a free project.
    expect(within(projectRows[2]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      'proj-beta', '2', '10', '6000', '—',
    ])

    const sessionTable = screen.getByRole('heading', { name: 'Session ranking' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    expect(within(sessionTable).getAllByRole('row')).toHaveLength(5)
    expect(within(sessionTable).getByText('sess-alp')).toBeInTheDocument()
    // Subagent-only parent: counted, but its duration is stated as uncollected
    // instead of as a 0m that would read like a measured value.
    const agentOnly = within(sessionTable).getByText('sess-age').closest('[role="row"]') as HTMLElement
    expect(within(agentOnly).getByText('Not collected')).toBeInTheDocument()

    selectRange('Last 7 days')

    const narrowed = screen.getByRole('heading', { name: 'Session ranking' })
      .closest('section')!.querySelector('[role="table"]') as HTMLElement
    // The 04-20 session falls outside the window and must not be counted in it.
    expect(within(narrowed).getAllByRole('row')).toHaveLength(4)
    expect(within(narrowed).queryByText('sess-old')).not.toBeInTheDocument()
  })

  it('reveals additional session rows without pretending the server cap is complete history', async () => {
    const sessionUsage = Array.from({ length: 25 }, (_, index) => ({
      ...activityResponse.sessionUsage[2],
      sessionId: `session-${String(index).padStart(2, '0')}`,
      inputTokens: 50_000 - index,
    }))
    getStatsMock.mockResolvedValueOnce({ ...activityResponse, sessionUsage })
    render(<ActivitySettings />)
    await flushActivityLoad()
    openView('Projects')

    const section = screen.getByRole('heading', { name: 'Session ranking' }).closest('section') as HTMLElement
    expect(within(section).getAllByRole('row')).toHaveLength(21)
    fireEvent.click(within(section).getByRole('button', { name: 'Show 5 more' }))
    expect(within(section).getAllByRole('row')).toHaveLength(26)
  })

  it('says project attribution is unavailable instead of showing an empty leaderboard', async () => {
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      projectUsage: null,
      sessionUsage: null,
    })
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Projects')

    expect(screen.getByText(/Project attribution needs the local index/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('ranks tool calls and refuses to invent durations or failure rates', async () => {
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Agent tools')

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(within(rows[1]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Bash', '180'])
    expect(within(rows[2]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Read', '160'])

    expect(screen.getByText('Average duration per tool')).toBeInTheDocument()
    expect(screen.getByText('Failure rate per tool')).toBeInTheDocument()
    // Both are marked uncollected rather than rendered as measured zeroes.
    expect(screen.getByRole('heading', { name: 'Not collected yet' })).toBeInTheDocument()
    expect(screen.getAllByText('Not collected')).toHaveLength(2)
    expect(screen.getByText('$frontend-design')).toBeInTheDocument()
    expect(screen.getByText('24 runs')).toBeInTheDocument()
  })

  it('flags unpriced models and grain mismatches as diagnostics, with the numbers behind them', async () => {
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      modelUsage: {
        'glm-4.6': { inputTokens: 40_000, outputTokens: 2_000, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0 },
      },
      unpricedModels: ['glm-4.6'],
      // The day series is empty while the aggregate is not: exactly the shape a
      // double-count or a dropped day would produce.
      dailyModelTokens: [],
    })
    render(<ActivitySettings />)

    await flushActivityLoad()
    openView('Diagnostics')

    expect(screen.getByText('1 models have no published rate')).toBeInTheDocument()
    expect(screen.getByText('glm-4.6')).toBeInTheDocument()
    expect(screen.getByText('1 models disagree between the daily series and their total')).toBeInTheDocument()
    expect(screen.getByText(/glm-4.6: 4万 vs 0/)).toBeInTheDocument()
  })

  it('supports localized heatmap mode switches and persisted display name edits', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    render(<ActivitySettings />)

    await flushActivityLoad()

    expect(screen.getByRole('heading', { name: 'Token 活动' })).toBeInTheDocument()
    const modeGroup = screen.getByRole('radiogroup', { name: 'Token 活动' })
    expect(within(modeGroup).getByRole('radio', { name: '每日' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(modeGroup).getByRole('radio', { name: '每周' }))
    expect(within(modeGroup).getByRole('radio', { name: '每周' })).toHaveAttribute('aria-checked', 'true')
    expect(within(modeGroup).getByRole('radio', { name: '每日' })).toHaveAttribute('aria-checked', 'false')
    // Weekly mode relabels the cells as week ranges.
    expect(screen.getAllByRole('gridcell', { name: /^2026年5月3日 - 2026年5月9日:/ }).length).toBeGreaterThan(0)
    fireEvent.click(within(modeGroup).getByRole('radio', { name: '累计' }))
    expect(within(modeGroup).getByRole('radio', { name: '累计' })).toHaveAttribute('aria-checked', 'true')

    // The five sheets and the range control are localized too, not just the heatmap.
    expect(within(screen.getByRole('radiogroup', { name: '用量视图' })).getByRole('radio', { name: '总览中心' }))
      .toHaveAttribute('aria-checked', 'true')
    fireEvent.click(within(screen.getByRole('radiogroup', { name: '用量视图' })).getByRole('radio', { name: '项目会话' }))
    expect(within(screen.getByRole('radiogroup', { name: '时间区间' })).getByRole('radio', { name: '近 7 天' }))
      .toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '编辑个人资料' }))
    const input = screen.getByLabelText('显示名称')
    const displayName = '大厂程序员阿江的 Token 活动统计展示'
    fireEvent.change(input, { target: { value: displayName } })
    fireEvent.change(screen.getByLabelText('第二行'), { target: { value: 'relakkes.dev' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await flushActivityLoad()

    expect(updateProfilePreferencesMock).toHaveBeenCalledWith({
      displayName,
      subtitle: 'relakkes.dev',
    })
    // A long display name wraps inside the profile card instead of being cut off.
    const heading = screen.getByRole('heading', { name: displayName })
    expect(heading).toHaveClass('break-words')
    expect(heading).not.toHaveClass('truncate')
    expect(heading.parentElement).toHaveClass('min-w-0')
    expect(screen.getByRole('link', { name: 'relakkes.dev' })).toHaveAttribute('href', 'https://relakkes.dev')
  })

  it('handles avatar upload, fallback, removal, save failure, and cancel reset', async () => {
    getPreferencesMock.mockResolvedValueOnce({
      exists: true,
      preferences: {
        schemaVersion: 2,
        profile: {
          displayName: 'Local Captain',
          subtitle: 'Local workspace',
          avatarFile: 'profile/avatar.webp',
          avatarUpdatedAt: '2026-05-09T12:00:00.000Z',
        },
        sidebar: {
          projectOrder: [],
          pinnedProjects: [],
          hiddenProjects: [],
          projectOrganization: 'recentProject',
          projectSortBy: 'updatedAt',
        },
      },
    })
    updateProfilePreferencesMock.mockRejectedValueOnce(new Error('display name rejected'))
    render(<ActivitySettings />)

    await flushActivityLoad()

    const avatar = screen.getByAltText('Local Captain avatar')
    expect(avatar).toHaveAttribute('src', '/api/desktop-ui/preferences/profile/avatar?mock=1')
    expect(avatar).not.toHaveClass('scale-[1.28]')
    fireEvent.error(avatar)
    expect(avatar).toHaveAttribute('src', '/app-icon.png')
    expect(avatar).toHaveClass('scale-[1.28]')

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Rejected Name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await flushActivityLoad()

    expect(screen.getByText('display name rejected')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Unsaved Name' } })
    fireEvent.change(screen.getByLabelText('Second line'), { target: { value: 'Unsaved subtitle' } })
    const cancelButtons = screen.getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1]!)
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }))
    expect(screen.getByLabelText('Display name')).toHaveValue('Local Captain')
    expect(screen.getByLabelText('Second line')).toHaveValue('Local workspace')

    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array([1, 2, 3])], 'avatar.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [file] } })

    await flushActivityLoad()

    expect(uploadProfileAvatarMock).toHaveBeenCalledWith(file)
    expect(screen.getByText('Saved locally')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove avatar' }))
    await flushActivityLoad()

    expect(deleteProfileAvatarMock).toHaveBeenCalled()
    expect(screen.getByAltText('cc-haha avatar')).toHaveAttribute('src', '/app-icon.png')
    // Same headroom as the overview pass: the page grew past what the 5s default
    // covers on a loaded machine, and nothing here waits on a real timer.
  }, 20_000)

  it('shows localized duration details and the empty usage state', async () => {
    useSettingsStore.setState({ locale: 'zh' })
    getStatsMock.mockResolvedValueOnce({
      ...activityResponse,
      totalSessions: 0,
      totalMessages: 0,
      activeDays: 0,
      dailyActivity: [],
      dailyModelTokens: [],
      dailyModelUsage: [],
      projectUsage: [],
      sessionUsage: [],
      toolUsage: {},
      skillUsage: {},
      longestSession: {
        id: 'session-1',
        startedAt: '2026-05-09T08:00:00.000Z',
        endedAt: '2026-05-09T09:30:00.000Z',
        duration: 90 * 60_000,
        messageCount: 12,
        toolCallCount: 4,
      },
      peakActivityDay: null,
      streaks: {
        currentStreak: 0,
        longestStreak: 0,
        currentStreakStart: null,
        longestStreakStart: null,
        longestStreakEnd: null,
      },
    })
    render(<ActivitySettings />)

    await flushActivityLoad()

    expect(screen.getByText('1 小时 30 分钟')).toBeInTheDocument()
    expect(screen.getByText('12 消息')).toBeInTheDocument()
    expect(screen.getByText('暂无本地用量')).toBeInTheDocument()
    expect(screen.queryByText('活动洞察')).not.toBeInTheDocument()
  })
})
