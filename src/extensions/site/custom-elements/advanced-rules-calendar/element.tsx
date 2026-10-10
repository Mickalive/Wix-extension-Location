import { httpClient } from '@wix/essentials';

type Slot = {
  eventId: string;
  serviceId: string;
  serviceName: string;
  localStartDate: string;
  localEndDate: string;
  remainingCapacity: number | null;
  bookingUrl: string;
};

type CalendarResponse = {
  timeZone: string | null;
  services: Array<{ id: string; name: string }>;
  slots: Slot[];
  filteredByAdvancedRules: boolean;
  message?: string;
};

function isoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftedDate(days: number): Date {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function dateLabel(localDateTime: string): string {
  const date = localDateTime.slice(0, 10);
  const parsed = new Date(`${date}T12:00:00`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function timeLabel(localDateTime: string): string {
  const hh = Number(localDateTime.slice(11, 13));
  const mm = Number(localDateTime.slice(14, 16));
  const parsed = new Date(2000, 0, 1, hh, mm);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

class AdvancedRulesCalendar extends HTMLElement {
  private root: ShadowRoot;
  private weekOffset = 0;
  private selectedService = 'ALL';
  private response: CalendarResponse | null = null;
  private loading = false;

  constructor() {
    super();
    this.root = this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
    void this.load();
  }

  private range() {
    const from = shiftedDate(this.weekOffset * 7);
    const to = shiftedDate(this.weekOffset * 7 + 6);
    return { from: isoDate(from), to: isoDate(to) };
  }

  private async load() {
    this.loading = true;
    this.render();
    const { from, to } = this.range();
    try {
      const response = await httpClient.fetchWithAuth(
        `${import.meta.env.BASE_API_URL}/api/class-calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      const body = (await response.json()) as CalendarResponse;
      if (!response.ok) {
        throw new Error(body?.message || 'Class availability could not be loaded.');
      }
      this.response = body;
      if (
        this.selectedService !== 'ALL' &&
        !body.services.some((service) => service.id === this.selectedService)
      ) {
        this.selectedService = 'ALL';
      }
    } catch (error) {
      this.response = {
        timeZone: null,
        services: [],
        slots: [],
        filteredByAdvancedRules: false,
        message:
          error instanceof Error
            ? error.message
            : 'Class availability could not be loaded. Please try again.',
      };
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private render() {
    const data = this.response;
    const services = data?.services ?? [];
    const slots = (data?.slots ?? []).filter(
      (slot) => this.selectedService === 'ALL' || slot.serviceId === this.selectedService,
    );
    const byDate = new Map<string, Slot[]>();
    for (const slot of slots) {
      const date = slot.localStartDate.slice(0, 10);
      const list = byDate.get(date) ?? [];
      list.push(slot);
      byDate.set(date, list);
    }

    const { from, to } = this.range();
    const serviceOptions = [
      '<option value="ALL">All classes</option>',
      ...services.map(
        (service) =>
          `<option value="${escapeHtml(service.id)}" ${this.selectedService === service.id ? 'selected' : ''}>${escapeHtml(service.name)}</option>`,
      ),
    ].join('');

    const dayCards = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, daySlots]) => {
        const rows = daySlots
          .sort((a, b) => a.localStartDate.localeCompare(b.localStartDate))
          .map(
            (slot) => `
              <div class="slot">
                <div class="time">${escapeHtml(timeLabel(slot.localStartDate))}</div>
                <div class="slot-main">
                  <div class="service">${escapeHtml(slot.serviceName)}</div>
                  <div class="meta">
                    ${slot.remainingCapacity === null ? '' : `${escapeHtml(slot.remainingCapacity)} spot${slot.remainingCapacity === 1 ? '' : 's'} left`}
                  </div>
                </div>
                <a class="book" href="${escapeHtml(slot.bookingUrl)}" target="_top" rel="noopener">Book</a>
              </div>
            `,
          )
          .join('');
        return `
          <section class="day">
            <div class="day-title">${escapeHtml(dateLabel(`${date}T12:00:00`))}</div>
            <div class="slots">${rows}</div>
          </section>
        `;
      })
      .join('');

    this.root.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          color: #182230;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        * { box-sizing: border-box; }
        .shell {
          width: 100%;
          background: #fff;
          border: 1px solid #e2e7ec;
          border-radius: 18px;
          padding: clamp(18px, 3vw, 32px);
          box-shadow: 0 14px 36px rgba(24, 34, 48, 0.08);
        }
        .head {
          display: flex;
          justify-content: space-between;
          gap: 18px;
          align-items: flex-start;
          flex-wrap: wrap;
          margin-bottom: 22px;
        }
        h2 {
          font-size: clamp(24px, 3vw, 34px);
          line-height: 1.15;
          margin: 0 0 7px;
          letter-spacing: -0.03em;
        }
        .sub {
          margin: 0;
          color: #647180;
          font-size: 14px;
        }
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 7px 10px;
          border-radius: 999px;
          background: #edf7f1;
          color: #17663a;
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }
        .dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: currentColor;
        }
        .controls {
          display: grid;
          grid-template-columns: minmax(180px, 1fr) auto;
          gap: 12px;
          margin-bottom: 20px;
          align-items: center;
        }
        select, button {
          min-height: 42px;
          border: 1px solid #cfd8e1;
          border-radius: 10px;
          background: #fff;
          color: #182230;
          padding: 0 12px;
          font: inherit;
        }
        select { width: 100%; }
        .week-nav {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        button {
          cursor: pointer;
          font-weight: 650;
        }
        button:hover { background: #f6f8fa; }
        button:disabled { opacity: .45; cursor: default; }
        .range {
          font-size: 13px;
          color: #647180;
          padding: 0 4px;
          white-space: nowrap;
        }
        .days {
          display: grid;
          gap: 14px;
        }
        .day {
          border: 1px solid #e5e9ee;
          border-radius: 14px;
          overflow: hidden;
        }
        .day-title {
          padding: 12px 16px;
          background: #f7f9fb;
          font-size: 13px;
          font-weight: 750;
          color: #4f5e6c;
        }
        .slots { display: grid; }
        .slot {
          display: grid;
          grid-template-columns: 92px minmax(0, 1fr) auto;
          gap: 14px;
          align-items: center;
          padding: 14px 16px;
          border-top: 1px solid #eef1f4;
        }
        .slot:first-child { border-top: 0; }
        .time {
          font-weight: 750;
          font-size: 15px;
        }
        .service {
          font-size: 15px;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .meta {
          color: #74808c;
          font-size: 12px;
          margin-top: 3px;
        }
        .book {
          display: inline-flex;
          min-height: 38px;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          padding: 0 16px;
          background: #116dff;
          color: #fff;
          text-decoration: none;
          font-size: 14px;
          font-weight: 750;
        }
        .book:hover { background: #0d5bd7; }
        .empty, .error, .loading {
          border: 1px dashed #d6dde5;
          border-radius: 12px;
          padding: 28px 18px;
          text-align: center;
          color: #647180;
        }
        .error {
          border-color: #efc9c9;
          background: #fff8f8;
          color: #8b3131;
        }
        @media (max-width: 680px) {
          .controls { grid-template-columns: 1fr; }
          .week-nav { justify-content: space-between; }
          .range { display: none; }
          .slot { grid-template-columns: 72px minmax(0, 1fr); }
          .book { grid-column: 1 / -1; }
        }
      </style>
      <div class="shell">
        <div class="head">
          <div>
            <h2>Book a class</h2>
            <p class="sub">Choose from sessions that are actually available to book.</p>
          </div>
          ${data?.filteredByAdvancedRules ? '<div class="badge"><span class="dot"></span>Advanced rules applied</div>' : ''}
        </div>

        <div class="controls">
          <select id="service-filter" aria-label="Filter by class">${serviceOptions}</select>
          <div class="week-nav">
            <button id="prev-week" type="button" ${this.weekOffset <= 0 ? 'disabled' : ''}>Previous</button>
            <span class="range">${escapeHtml(from)} — ${escapeHtml(to)}</span>
            <button id="next-week" type="button">Next</button>
          </div>
        </div>

        ${this.loading
          ? '<div class="loading">Loading available classes…</div>'
          : data?.message
            ? `<div class="error">${escapeHtml(data.message)} <button id="retry" type="button">Try again</button></div>`
            : dayCards || '<div class="empty">No classes are available under the current booking rules for this week.</div>'}
      </div>
    `;

    this.root.getElementById('service-filter')?.addEventListener('change', (event) => {
      this.selectedService = (event.currentTarget as HTMLSelectElement).value;
      this.render();
    });
    this.root.getElementById('prev-week')?.addEventListener('click', () => {
      if (this.weekOffset <= 0) return;
      this.weekOffset -= 1;
      void this.load();
    });
    this.root.getElementById('next-week')?.addEventListener('click', () => {
      this.weekOffset += 1;
      void this.load();
    });
    this.root.getElementById('retry')?.addEventListener('click', () => void this.load());
  }
}

export default AdvancedRulesCalendar;
