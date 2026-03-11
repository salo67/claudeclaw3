import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PulseDashboardPage from './PulseDashboardPage';

const mockPulseSnapshot = {
  generated_at: '2026-03-07T12:00:00Z',
  cashflow: { status: 'ok', data: { balance: { balance: 150000 } } },
  stockouts: { status: 'ok', data: { stockouts: { count: 5 } } },
  kpis_hd: { status: 'ok', data: { kpis: {} } },
  pending_approvals: { status: 'ok', data: { approvals: { count: 3 } } },
  exchange_rate: { status: 'ok', data: { usd_mxn: 17.25 } },
  email_stats: { status: 'ok', data: { stats: { unread: 12 } } },
};

const mockPrevSnapshot = {
  generated_at: '2026-03-06T12:00:00Z',
  cashflow: { status: 'ok', data: { balance: { balance: 140000 } } },
  stockouts: { status: 'ok', data: { stockouts: { count: 8 } } },
  kpis_hd: { status: 'ok', data: { kpis: {} } },
  pending_approvals: { status: 'ok', data: { approvals: { count: 2 } } },
  exchange_rate: { status: 'ok', data: { usd_mxn: 17.10 } },
  email_stats: { status: 'ok', data: { stats: { unread: 10 } } },
};

const mockAdvisors = {
  decisions: ['Renegociar contrato con proveedor X'],
  pending_approvals: ['Aprobar orden de compra #1234', 'Autorizar descuento para cliente Y'],
  actions_taken: ['Ajuste de precio en SKU-001'],
  summary: 'Actividad moderada overnight',
  message_count: 8,
};

const mockBriefing = {
  quote: 'El esfuerzo constante vence al talento sin disciplina.',
  weather: { temp: '28', condition: 'Sunny', forecast: '32°C max, 22°C min' },
  newsletter_highlights: [
    { subject: 'Supply Chain Weekly', key_points: ['Disruption in Asia ports', 'New tariff schedule'] },
    { subject: 'Retail Insights', key_points: ['Q1 trends report'] },
  ],
};

function mockFetch(url: string, opts?: RequestInit) {
  if (url.includes('/pulse/latest')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ pulse: { id: 'p1', date: '2026-03-07', snapshot: mockPulseSnapshot, generated_at: mockPulseSnapshot.generated_at, created_at: 1741334400 } }),
    });
  }
  if (url.includes('/pulse/history')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        items: [
          { id: 'p1', date: '2026-03-07', snapshot: mockPulseSnapshot, generated_at: mockPulseSnapshot.generated_at, created_at: 1741334400 },
          { id: 'p0', date: '2026-03-06', snapshot: mockPrevSnapshot, generated_at: mockPrevSnapshot.generated_at, created_at: 1741248000 },
        ],
        total: 2, page: 1, page_size: 2,
      }),
    });
  }
  if (url.includes('/pulse/advisors-overnight')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockAdvisors),
    });
  }
  if (url.includes('/pulse/briefing')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(mockBriefing),
    });
  }
  if (url.includes('/pulse/generate') && opts?.method === 'POST') {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ id: 'p2' }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PulseDashboardPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((url: string, opts?: RequestInit) => mockFetch(url, opts)));
  localStorage.clear();
});

describe('PulseDashboardPage', () => {
  it('renders tab navigation with Pulse and Briefing tabs', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('tab-nav')).toBeInTheDocument();
    });
    expect(screen.getByTestId('tab-pulse')).toBeInTheDocument();
    expect(screen.getByTestId('tab-briefing')).toBeInTheDocument();
  });

  it('defaults to pulse tab showing metric cards', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('pulse-tab')).toBeInTheDocument();
    });
    expect(screen.getByTestId('metrics-grid')).toBeInTheDocument();
    const cards = screen.getAllByTestId('metric-card');
    expect(cards.length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('$150.0K')).toBeInTheDocument();
  });

  it('shows WoW change indicators with arrows', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('change-indicator').length).toBeGreaterThan(0);
    });
    const indicators = screen.getAllByTestId('change-indicator');
    const hasPercentage = indicators.some(el => el.textContent?.includes('%'));
    expect(hasPercentage).toBe(true);
  });

  it('renders advisor pending approvals with approve/reject buttons', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('advisor-decisions')).toBeInTheDocument();
    });
    const approvalItems = screen.getAllByTestId('approval-item');
    expect(approvalItems).toHaveLength(2);
    expect(screen.getAllByTestId('approve-btn')).toHaveLength(2);
    expect(screen.getAllByTestId('reject-btn')).toHaveLength(2);
  });

  it('approve button changes state to Aprobado', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('approve-btn').length).toBe(2);
    });
    fireEvent.click(screen.getAllByTestId('approve-btn')[0]);
    expect(screen.getByText('Aprobado')).toBeInTheDocument();
  });

  it('reject button changes state to Rechazado', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByTestId('reject-btn').length).toBe(2);
    });
    fireEvent.click(screen.getAllByTestId('reject-btn')[1]);
    expect(screen.getByText('Rechazado')).toBeInTheDocument();
  });

  it('action items checklist: add, toggle, remove', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('action-items')).toBeInTheDocument();
    });

    const input = screen.getByTestId('new-item-input') as HTMLInputElement;
    const addBtn = screen.getByTestId('add-item-btn');
    fireEvent.change(input, { target: { value: 'Revisar reporte' } });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(screen.getByText('Revisar reporte')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByTestId('toggle-item');
    fireEvent.click(toggleBtn);
    const item = screen.getByTestId('action-item');
    expect(item.className).toContain('opacity-60');

    const removeBtn = screen.getByTestId('remove-item');
    fireEvent.click(removeBtn);
    expect(screen.queryByText('Revisar reporte')).not.toBeInTheDocument();
  });

  it('checklist persists via localStorage', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('action-items')).toBeInTheDocument();
    });

    const input = screen.getByTestId('new-item-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Persistent task' } });
    fireEvent.click(screen.getByTestId('add-item-btn'));

    await waitFor(() => {
      expect(screen.getByText('Persistent task')).toBeInTheDocument();
    });

    const stored = JSON.parse(localStorage.getItem('pulse-action-items') || '[]');
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('Persistent task');
  });

  it('add item via Enter key', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('action-items')).toBeInTheDocument();
    });

    const input = screen.getByTestId('new-item-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Enter task' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('Enter task')).toBeInTheDocument();
    });
  });
});

describe('Briefing Tab', () => {
  it('renders briefing tab with quote, weather, exchange rate', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('tab-briefing')).toBeInTheDocument();
    });

    // Switch to briefing tab
    fireEvent.click(screen.getByTestId('tab-briefing'));

    await waitFor(() => {
      expect(screen.getByTestId('briefing-tab')).toBeInTheDocument();
    });

    // Quote rendered
    await waitFor(() => {
      expect(screen.getByTestId('briefing-quote')).toBeInTheDocument();
    });
    expect(screen.getByText(mockBriefing.quote)).toBeInTheDocument();

    // Weather rendered
    expect(screen.getByTestId('briefing-weather')).toBeInTheDocument();
    expect(screen.getByText('28°C')).toBeInTheDocument();
    expect(screen.getByText('Sunny')).toBeInTheDocument();

    // Exchange rate rendered
    expect(screen.getByTestId('briefing-exchange')).toBeInTheDocument();
    expect(screen.getByText('$17.25')).toBeInTheDocument();
  });

  it('renders newsletter highlights with key points', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('tab-briefing')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('tab-briefing'));

    await waitFor(() => {
      expect(screen.getByTestId('briefing-newsletters')).toBeInTheDocument();
    });

    expect(screen.getByText('Supply Chain Weekly')).toBeInTheDocument();
    expect(screen.getByText('Disruption in Asia ports')).toBeInTheDocument();
    expect(screen.getByText('Retail Insights')).toBeInTheDocument();
  });

  it('date navigation works: prev button changes date display', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('tab-briefing')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('tab-briefing'));

    await waitFor(() => {
      expect(screen.getByTestId('date-nav')).toBeInTheDocument();
    });

    // Initially shows "Hoy"
    expect(screen.getByTestId('date-display').textContent).toContain('Hoy');

    // Next button should be disabled (can't go past today)
    const nextBtn = screen.getByTestId('date-next');
    expect(nextBtn).toBeDisabled();

    // Click prev to go to yesterday
    const prevBtn = screen.getByTestId('date-prev');
    fireEvent.click(prevBtn);

    // Should no longer show "Hoy"
    expect(screen.getByTestId('date-display').textContent).not.toContain('Hoy');
  });

  it('regenerate button calls POST /api/pulse/generate', async () => {
    const fetchSpy = vi.fn((url: string, opts?: RequestInit) => mockFetch(url, opts));
    vi.stubGlobal('fetch', fetchSpy);

    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('tab-briefing')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('tab-briefing'));

    await waitFor(() => {
      expect(screen.getByTestId('briefing-regenerate')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('briefing-regenerate'));

    await waitFor(() => {
      const generateCalls = fetchSpy.mock.calls.filter(
        (call) => String(call[0]).includes('/pulse/generate') && call[1]?.method === 'POST'
      );
      expect(generateCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('persists active tab in localStorage', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('tab-briefing')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('tab-briefing'));
    expect(localStorage.getItem('pulse-active-tab')).toBe('briefing');

    fireEvent.click(screen.getByTestId('tab-pulse'));
    expect(localStorage.getItem('pulse-active-tab')).toBe('pulse');
  });
});
