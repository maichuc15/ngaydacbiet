import {ChimeSynthesizer} from './audio/ChimeSynthesizer.ts';
import {
  formatLunarFull,
  formatLunarShort,
  getCanChiDay,
  getCanChiYear,
  getLeapMonthOfYear,
  lunarToSolarISO,
  solarISOToLunar,
  solarToLunar,
} from './lunar.ts';
import {
  FamilyLedgerStore,
  addDaysISO,
  formatCompactVND,
  formatDateVN,
  formatTodayHeaderVN,
  formatVND,
  getDaysUntil,
  toLocalDateISO,
} from './store.ts';
import {
  AMOUNT_PRESETS,
  AppPage,
  AttendanceStatus,
  BRANCH_LABELS,
  CATEGORY_LABELS,
  CONTRIBUTION_PRESETS,
  CalendarMode,
  EventCategory,
  EventPriority,
  FamilyBranch,
  FamilyEvent,
  FamilyMember,
  FilterMode,
  FundContribution,
  PRIORITY_LABELS,
  PersonalTransaction,
  PersonalTransactionType,
  QUICK_TITLE_TEMPLATES,
  RELATION_PRESETS,
  STATUS_LABELS,
} from './types.ts';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

interface RowUrgencyMeta {
  cls: 'urgent' | 'soon' | 'far' | 'attended' | 'skipped';
  label: string;
}

function getRowUrgency(ev: FamilyEvent, now = new Date()): RowUrgencyMeta {
  if (ev.status === 'attended') {
    return {cls: 'attended', label: 'Đã đi'};
  }
  if (ev.status === 'skipped') {
    return {cls: 'skipped', label: 'Không đi'};
  }
  const days = getDaysUntil(ev.dateISO, now);
  if (days < 0) {
    return {cls: 'urgent', label: `Quá ${Math.abs(days)} ngày · Gấp`};
  }
  if (days === 0) {
    return {cls: 'urgent', label: 'Hôm nay · Gấp'};
  }
  if (days <= 3) {
    return {cls: 'urgent', label: `Còn ${days} ngày · Gấp`};
  }
  if (days <= 14) {
    return {cls: 'soon', label: `Còn ${days} ngày · Sắp tới`};
  }
  return {cls: 'far', label: `Còn ${days} ngày · Còn xa`};
}

/**
 * 2D Vietnamese 4-page application controller for "Sổ Giỗ Chạp Gia Đình":
 * - Trang 1: Lịch đám (Nhắc việc hàng ngày, ghi nhanh theo Dương/Âm lịch, tick hoàn thành, chỉnh sửa)
 * - Trang 2: Lịch âm (Lịch tháng Âm–Dương Việt Nam, chi tiết ngày Can Chi, đổi ngày Âm↔Dương)
 * - Trang 3: Quỹ đám (Ngân sách quỹ, đóng góp quỹ, bảng kê thu chi, chỉnh sửa)
 * - Trang 4: Gia đình (Danh sách thành viên gia đình / gia tộc, thêm & chỉnh sửa)
 */
export class FamilyLedgerApp2D {
  private readonly root: HTMLElement;
  private readonly store = new FamilyLedgerStore();
  private readonly audio = new ChimeSynthesizer();

  // Active page
  private activePage: AppPage = 'calendar';

  // --- Calendar page draft & edit states ---
  private draftTitle = '';
  private draftDateISO = addDaysISO(new Date(), 0);
  private draftCalendarMode: CalendarMode = 'solar';
  private draftLunarDay: number;
  private draftLunarMonth: number;
  private draftLunarYear: number;
  private draftLunarLeap: boolean;
  private draftCategory: EventCategory = 'gio';
  private draftPriority: EventPriority = 'important';
  private draftAmount = 500_000;
  private draftAssigneeId = '';
  private searchQuery = '';
  private editingEventId: string | null = null;
  private editEventCalendarMode: CalendarMode = 'solar';
  private reminderWindowDays: 3 | 7 | 14 | 30 = 14;
  private dismissedReminderIds = new Set<string>();

  // --- Personal fund page draft & edit states ---
  private editingPersonalBaseFund = false;
  private draftPersonalType: PersonalTransactionType = 'expense';
  private draftPersonalTitle = '';
  private draftPersonalDateISO = addDaysISO(new Date(), 0);
  private draftPersonalAmount = 500_000;
  private draftPersonalNote = '';
  private personalFilter: 'all' | PersonalTransactionType = 'all';
  private editingPersonalTxId: string | null = null;

  // --- Fund page draft & edit states (Standalone Quỹ gia tộc) ---
  private editingBaseFund = false;
  private draftContribType: 'income' | 'expense' = 'income';
  private draftContribMemberId = '';
  private draftContribName = '';
  private draftContribDateISO = addDaysISO(new Date(), 0);
  private draftContribAmount = 1_000_000;
  private draftContribNote = '';
  private clanFundFilter: 'all' | 'income' | 'expense' = 'all';
  private editingContributionId: string | null = null;
  private editingFundEventId: string | null = null;

  // --- Family page draft & edit states ---
  private draftMemberName = '';
  private draftMemberRelation = 'Anh / Chị';
  private draftMemberBranch: FamilyBranch = 'gia_dinh';
  private draftMemberPhone = '';
  private draftMemberNote = '';
  private familyBranchFilter: 'all' | FamilyBranch = 'all';
  private familySearchQuery = '';
  private editingMemberId: string | null = null;

  // Toast feedback
  private toastMessage = '';
  private toastTimer: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    const now = new Date();
    const todayISO = toLocalDateISO(now);
    const todayLunar = solarISOToLunar(todayISO);

    this.draftLunarDay = todayLunar.day;
    this.draftLunarMonth = todayLunar.month;
    this.draftLunarYear = todayLunar.year;
    this.draftLunarLeap = todayLunar.leap;

    this.store.subscribe(() => this.render());
    this.render();
  }

  private syncDraftLunarFromSolar(dateISO: string): void {
    const l = solarISOToLunar(dateISO);
    this.draftLunarDay = l.day;
    this.draftLunarMonth = l.month;
    this.draftLunarYear = l.year;
    this.draftLunarLeap = l.leap;
  }

  private syncDraftSolarFromLunar(): void {
    const leapMonth = getLeapMonthOfYear(this.draftLunarYear);
    if (this.draftLunarLeap && leapMonth !== this.draftLunarMonth) {
      this.draftLunarLeap = false;
    }
    this.draftDateISO = lunarToSolarISO(
      this.draftLunarDay,
      this.draftLunarMonth,
      this.draftLunarYear,
      this.draftLunarLeap
    );
  }

  private showToast(msg: string): void {
    this.toastMessage = msg;
    const toastEl = this.root.querySelector<HTMLElement>('#app-toast');
    if (toastEl) {
      toastEl.textContent = msg;
      toastEl.classList.add('is-visible');
    }
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      this.toastMessage = '';
      const el = this.root.querySelector<HTMLElement>('#app-toast');
      if (el) el.classList.remove('is-visible');
    }, 3400);
  }

  private switchPage(page: AppPage): void {
    if (this.activePage === page) return;
    this.activePage = page;
    this.editingEventId = null;
    this.editingPersonalTxId = null;
    this.editingPersonalBaseFund = false;
    this.editingContributionId = null;
    this.editingFundEventId = null;
    this.editingMemberId = null;
    this.audio.playTap(490);
    this.render();
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  private render(): void {
    const now = new Date();
    const pages: Array<{id: AppPage; label: string}> = [
      {id: 'calendar', label: 'Lịch đám'},
      {id: 'personal', label: 'Quỹ cá nhân'},
      {id: 'fund', label: 'Quỹ gia tộc'},
      {id: 'family', label: 'Gia đình'},
    ];

    let pageHtml = '';
    if (this.activePage === 'calendar') {
      pageHtml = this.renderCalendarPage(now);
    } else if (this.activePage === 'personal') {
      pageHtml = this.renderPersonalFundPage(now);
    } else if (this.activePage === 'fund') {
      pageHtml = this.renderFundPage();
    } else {
      pageHtml = this.renderFamilyPage();
    }

    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="topbar-inner">
            <a href="#lich-dam" class="brand-lockup" data-action="nav-page" data-page="calendar">
              Sổ Giỗ Chạp Gia Đình
            </a>

            <nav class="topbar-nav" aria-label="Điều hướng chính">
              ${pages
                .map(
                  (p) => `
                    <button
                      type="button"
                      class="nav-link ${this.activePage === p.id ? 'is-active' : ''}"
                      data-action="nav-page"
                      data-page="${p.id}"
                      aria-current="${this.activePage === p.id ? 'page' : 'false'}"
                    >${escapeHtml(p.label)}</button>
                  `
                )
                .join('')}
            </nav>

            <div class="topbar-actions">
              <button type="button" class="btn-primary-sm" data-action="trigger-reminder">
                Nhắc hôm nay
              </button>
            </div>
          </div>
        </header>

        <main class="main-container">
          ${pageHtml}
        </main>

        <!-- Mobile Thumb-Zone Bottom Tab Bar (4 tabs) -->
        <nav class="mobile-tabbar" aria-label="Thanh chuyển trang di động">
          <button
            type="button"
            class="mobile-tab ${this.activePage === 'calendar' ? 'is-active' : ''}"
            data-action="nav-page"
            data-page="calendar"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2"></rect>
              <line x1="16" y1="2" x2="16" y2="6"></line>
              <line x1="8" y1="2" x2="8" y2="6"></line>
              <line x1="3" y1="10" x2="21" y2="10"></line>
            </svg>
            <span>Lịch đám</span>
          </button>

          <button
            type="button"
            class="mobile-tab ${this.activePage === 'personal' ? 'is-active' : ''}"
            data-action="nav-page"
            data-page="personal"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"></path>
              <path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"></path>
            </svg>
            <span>Quỹ cá nhân</span>
          </button>

          <button
            type="button"
            class="mobile-tab ${this.activePage === 'fund' ? 'is-active' : ''}"
            data-action="nav-page"
            data-page="fund"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
            <span>Quỹ gia tộc</span>
          </button>

          <button
            type="button"
            class="mobile-tab ${this.activePage === 'family' ? 'is-active' : ''}"
            data-action="nav-page"
            data-page="family"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
            <span>Gia đình</span>
          </button>
        </nav>

        <div id="app-toast" class="toast ${this.toastMessage ? 'is-visible' : ''}" role="status" aria-live="polite">
          ${escapeHtml(this.toastMessage)}
        </div>
      </div>
    `;

    this.bindEvents();
  }

  // =========================================================================
  // TRANG 1: LỊCH ĐÁM (MAIN SCREEN)
  // =========================================================================
  private renderCalendarPage(now: Date): string {
    const state = this.store.getState();
    const summary = this.store.computeSummary();
    const visibleEvents = this.getFilteredEvents();
    const draftLunarPreview = solarISOToLunar(this.draftDateISO);
    const draftLeapMonth = getLeapMonthOfYear(this.draftLunarYear);

    const counts: Record<FilterMode, number> = {
      all: state.events.length,
      upcoming: state.events.filter(
        (e) => e.status === 'pending' && getDaysUntil(e.dateISO, now) <= 14
      ).length,
      important: state.events.filter((e) => e.priority === 'important').length,
      attended: summary.attendedCount,
      skipped: summary.skippedCount,
    };

    const filterDefs: Array<{mode: FilterMode; label: string}> = [
      {mode: 'all', label: 'Tất cả'},
      {mode: 'upcoming', label: 'Sắp tới'},
      {mode: 'important', label: 'Quan trọng'},
      {mode: 'attended', label: 'Đã đi'},
      {mode: 'skipped', label: 'Không đi'},
    ];

    const dateQuickPresets = [
      {label: 'Hôm nay', iso: addDaysISO(now, 0)},
      {label: '+2 ngày', iso: addDaysISO(now, 2)},
      {label: '+7 ngày', iso: addDaysISO(now, 7)},
      {label: '+30 ngày', iso: addDaysISO(now, 30)},
    ];

    const baseYear = now.getFullYear();
    const lunarYears = [
      baseYear - 1,
      baseYear,
      baseYear + 1,
      baseYear + 2,
      baseYear + 3,
    ];

    return `
      ${this.renderUpcomingRemindersSection(now)}

      <!-- Main 2-Column Workspace -->
      <div class="workspace-grid">
        <!-- Left Column: Quick Add Task (Solar or Lunar Date) -->
        <section class="panel-surface quick-add-panel" aria-label="Ghi nhanh ngày đám">
          <div class="panel-header">
            <h2 class="panel-title">Ghi nhanh ngày đám</h2>
            <span class="panel-hint">Hỗ trợ Dương & Âm lịch</span>
          </div>

          <form id="quick-add-form" class="quick-add-form" novalidate>
            <div class="field-group">
              <label class="field-label" for="qa-title">Tên ngày giỗ, đám hoặc việc đặc biệt</label>
              <input
                id="qa-title"
                type="text"
                class="text-input"
                maxlength="64"
                placeholder="Ví dụ: Giỗ Ông Ngoại, Đám cưới con chú Ba..."
                value="${escapeHtml(this.draftTitle)}"
                autocomplete="off"
              />
              <div class="button-row-wrap" role="group" aria-label="Mẫu ghi nhanh">
                ${QUICK_TITLE_TEMPLATES.map(
                  (tpl) => `
                    <button
                      type="button"
                      class="seg-btn ${this.draftCategory === tpl.category ? 'is-active' : ''}"
                      data-action="select-template"
                      data-category="${tpl.category}"
                    >${escapeHtml(tpl.label)}</button>
                  `
                ).join('')}
              </div>
            </div>

            <div class="field-group">
              <div class="field-label-split">
                <label class="field-label" for="qa-date">Ngày diễn ra (Dương &amp; Âm lịch)</label>
                <div class="mode-switch" role="group" aria-label="Ưu tiên theo kiểu lịch">
                  <button
                    type="button"
                    class="mode-btn ${this.draftCalendarMode === 'solar' ? 'is-active' : ''}"
                    data-action="set-draft-cal-mode"
                    data-mode="solar"
                  >Dương lịch</button>
                  <button
                    type="button"
                    class="mode-btn ${this.draftCalendarMode === 'lunar' ? 'is-active' : ''}"
                    data-action="set-draft-cal-mode"
                    data-mode="lunar"
                  >Âm lịch</button>
                </div>
              </div>

              <input
                id="qa-date"
                type="date"
                class="text-input tabular"
                value="${escapeHtml(this.draftDateISO)}"
              />

              <div class="qa-lunar-box" aria-label="Chọn ngày theo Lịch âm">
                <div class="qa-lunar-box-head">
                  <span class="qa-lunar-tag">Lịch âm</span>
                  <span class="qa-lunar-canchi tabular">
                    ${escapeHtml(formatLunarFull(draftLunarPreview))} · Ngày ${escapeHtml(getCanChiDay(draftLunarPreview.jd))}
                  </span>
                </div>
                <div class="lunar-picker-row">
                  <select id="qa-lunar-day" class="text-input tabular" aria-label="Ngày âm lịch">
                    ${Array.from({length: 30}, (_, i) => i + 1)
                      .map(
                        (d) =>
                          `<option value="${d}" ${this.draftLunarDay === d ? 'selected' : ''}>${d <= 10 ? `Mùng ${d}` : `Ngày ${d}`}</option>`
                      )
                      .join('')}
                  </select>
                  <select id="qa-lunar-month" class="text-input tabular" aria-label="Tháng âm lịch">
                    ${Array.from({length: 12}, (_, i) => i + 1)
                      .map(
                        (m) =>
                          `<option value="${m}" ${this.draftLunarMonth === m ? 'selected' : ''}>${m === 1 ? 'Tháng Giêng' : m === 12 ? 'Tháng Chạp' : `Tháng ${m}`} ÂL</option>`
                      )
                      .join('')}
                  </select>
                  <select id="qa-lunar-year" class="text-input tabular" aria-label="Năm âm lịch">
                    ${lunarYears
                      .map(
                        (y) =>
                          `<option value="${y}" ${this.draftLunarYear === y ? 'selected' : ''}>${y} (${escapeHtml(getCanChiYear(y))})</option>`
                      )
                      .join('')}
                  </select>
                </div>
                ${
                  draftLeapMonth === this.draftLunarMonth
                    ? `<label class="checkbox-inline">
                        <input type="checkbox" id="qa-lunar-leap" ${this.draftLunarLeap ? 'checked' : ''} />
                        <span>Tháng ${this.draftLunarMonth} nhuận năm ${this.draftLunarYear}</span>
                      </label>`
                    : ''
                }
                <div class="button-row-wrap" role="group" aria-label="Chọn nhanh ngày âm dương">
                  ${dateQuickPresets
                    .map(
                      (p) => `
                        <button
                          type="button"
                          class="seg-btn ${this.draftDateISO === p.iso ? 'is-active' : ''}"
                          data-action="select-date-preset"
                          data-date="${p.iso}"
                        >${escapeHtml(p.label)}</button>
                      `
                    )
                    .join('')}
                  <button
                    type="button"
                    class="seg-btn ${this.draftLunarDay === 1 ? 'is-active' : ''}"
                    data-action="select-lunar-day-preset"
                    data-day="1"
                  >Mùng 1 ÂL</button>
                  <button
                    type="button"
                    class="seg-btn ${this.draftLunarDay === 15 ? 'is-active' : ''}"
                    data-action="select-lunar-day-preset"
                    data-day="15"
                  >Ngày Rằm</button>
                </div>
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="qa-amount">Tiền đám dự kiến (đồng · trừ vào Quỹ cá nhân)</label>
              <input
                id="qa-amount"
                type="number"
                class="text-input tabular"
                min="0"
                step="50000"
                value="${this.draftAmount}"
              />
              <div class="button-row-wrap" role="group" aria-label="Mức tiền nhanh">
                ${AMOUNT_PRESETS.map(
                  (amt) => `
                    <button
                      type="button"
                      class="seg-btn tabular ${this.draftAmount === amt ? 'is-active' : ''}"
                      data-action="select-amount-preset"
                      data-amount="${amt}"
                    >${escapeHtml(formatCompactVND(amt))}</button>
                  `
                ).join('')}
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="qa-assignee">Người đại diện đi đám (tùy chọn)</label>
              <select id="qa-assignee" class="text-input">
                <option value="">-- Chưa phân công --</option>
                ${state.members
                  .map(
                    (m) => `
                      <option value="${m.id}" ${this.draftAssigneeId === m.id ? 'selected' : ''}>
                        ${escapeHtml(m.name)} (${escapeHtml(m.relation)})
                      </option>
                    `
                  )
                  .join('')}
              </select>
            </div>

            <div class="field-group">
              <span class="field-label">Mức độ quan trọng</span>
              <div class="priority-toggle-row" role="group" aria-label="Chọn mức độ ưu tiên">
                <button
                  type="button"
                  class="seg-btn flex-1 ${this.draftPriority === 'important' ? 'is-active-urgent' : ''}"
                  data-action="select-priority"
                  data-priority="important"
                >Quan trọng</button>
                <button
                  type="button"
                  class="seg-btn flex-1 ${this.draftPriority === 'normal' ? 'is-active' : ''}"
                  data-action="select-priority"
                  data-priority="normal"
                >Bình thường</button>
              </div>
            </div>

            <button type="submit" class="btn-submit-full">
              Thêm nhanh vào sổ
            </button>
          </form>
        </section>

        <!-- Right Column: Event Ledger List -->
        <section class="panel-surface list-panel" aria-label="Danh sách ngày đám trong năm">
          <div class="list-header">
            <div class="list-header-top">
              <h2 class="panel-title">Lịch giỗ chạp & đám trong năm</h2>
              <button type="button" class="btn-text-subtle" data-action="reset-sample">
                Khôi phục mẫu
              </button>
            </div>

            <div class="list-controls">
              <div class="filter-bar" role="tablist" aria-label="Lọc danh sách ngày đám">
                ${filterDefs
                  .map(
                    (f) => `
                      <button
                        type="button"
                        role="tab"
                        aria-selected="${state.filter === f.mode ? 'true' : 'false'}"
                        class="filter-tab ${state.filter === f.mode ? 'is-active' : ''}"
                        data-action="set-filter"
                        data-filter="${f.mode}"
                      >${escapeHtml(f.label)} (${counts[f.mode]})</button>
                    `
                  )
                  .join('')}
              </div>

              <input
                id="search-events"
                type="search"
                class="search-input"
                placeholder="Tìm tên đám, ngày dương/âm..."
                value="${escapeHtml(this.searchQuery)}"
                aria-label="Tìm kiếm ngày đám"
              />
            </div>

            <div class="urgency-legend">
              <span class="legend-item legend-urgent">Đỏ: 0–3 ngày (Gấp)</span>
              <span aria-hidden="true">·</span>
              <span class="legend-item legend-soon">Vàng: 4–14 ngày (Sắp tới)</span>
              <span aria-hidden="true">·</span>
              <span class="legend-item legend-far">Xanh ngọc: &gt;14 ngày (Còn xa)</span>
            </div>
          </div>

          <div class="event-list">
            ${
              visibleEvents.length === 0
                ? `<div class="empty-state">
                    <p class="empty-title">Chưa có ngày đám nào khớp bộ lọc hiện tại.</p>
                    <p class="empty-sub">Hãy thêm nhanh ngày giỗ hoặc đám ở khung bên cạnh, hoặc chuyển sang mục "Tất cả".</p>
                  </div>`
                : visibleEvents.map((ev) => this.renderEventRow(ev, now)).join('')
            }
          </div>
        </section>
      </div>
    `;
  }

  private renderUpcomingRemindersSection(now: Date): string {
    const state = this.store.getState();
    const pendingSorted = state.events
      .filter((e) => e.status === 'pending')
      .map((ev) => ({ev, days: getDaysUntil(ev.dateISO, now)}))
      .sort((a, b) => a.days - b.days);

    const inWindow = pendingSorted.filter(
      (item) => item.days <= this.reminderWindowDays
    );
    const activeReminders = inWindow.filter(
      (item) => !this.dismissedReminderIds.has(item.ev.id)
    );
    const dismissedCount = inWindow.length - activeReminders.length;
    const totalReminderAmount = activeReminders.reduce(
      (sum, item) => sum + item.ev.amount,
      0
    );
    const urgentReminderCount = activeReminders.filter(
      (item) => item.days <= 3
    ).length;

    const windows: ReadonlyArray<3 | 7 | 14 | 30> = [3, 7, 14, 30];
    const hasLaterPending = pendingSorted.some(
      (item) => item.days > this.reminderWindowDays
    );

    const todayLunar = solarToLunar(
      now.getDate(),
      now.getMonth() + 1,
      now.getFullYear()
    );
    const todayLine = `${formatTodayHeaderVN(now)} · ${formatLunarShort(todayLunar)} (${getCanChiYear(todayLunar.year)})`;

    const subtitle =
      activeReminders.length > 0
        ? `${todayLine} · ${activeReminders.length} ngày sắp đến trong ${this.reminderWindowDays} ngày tới${urgentReminderCount > 0 ? ` (${urgentReminderCount} ngày gấp)` : ''} · Dự chi ${formatVND(totalReminderAmount)}`
        : `${todayLine} · Không có ngày giỗ hoặc đám nào cần nhắc trong ${this.reminderWindowDays} ngày tới`;

    const rowsHtml = activeReminders
      .map(({ev, days}) => {
        const lunar = solarISOToLunar(ev.dateISO);
        const assignee = this.store.getMemberById(ev.assigneeId);
        const level = days <= 3 ? 'urgent' : days <= 14 ? 'soon' : 'far';
        const countdownMain =
          days < 0
            ? `Quá ${Math.abs(days)} ngày`
            : days === 0
              ? 'Hôm nay'
              : days === 1
                ? 'Ngày mai'
                : `Còn ${days} ngày`;
        const countdownSub =
          days <= 0
            ? 'Cần đi ngay'
            : days <= 3
              ? 'Sắp đến · Gấp'
              : days <= 14
                ? 'Chuẩn bị sớm'
                : 'Lịch sắp tới';

        return `
          <article class="reminder-row is-${level}">
            <div class="reminder-countdown is-${level}">
              <span class="reminder-countdown-main tabular">${escapeHtml(countdownMain)}</span>
              <span class="reminder-countdown-sub">${escapeHtml(countdownSub)}</span>
            </div>

            <div class="reminder-main">
              <h3 class="reminder-title">${escapeHtml(ev.title)}</h3>
              <div class="event-meta-line">
                <span class="tabular">${escapeHtml(formatDateVN(ev.dateISO))}</span>
                <span class="meta-lunar tabular">(${escapeHtml(formatLunarShort(lunar))})</span>
                <span aria-hidden="true">·</span>
                <span>${escapeHtml(CATEGORY_LABELS[ev.category])}</span>
                <span aria-hidden="true">·</span>
                <span class="${ev.priority === 'important' ? 'urgency-text-urgent' : ''}">
                  ${escapeHtml(PRIORITY_LABELS[ev.priority])}
                </span>
                ${
                  assignee
                    ? `<span aria-hidden="true">·</span><span class="meta-assignee">Đại diện: ${escapeHtml(assignee.name)}</span>`
                    : ''
                }
              </div>
            </div>

            <div class="reminder-right">
              <div class="amount-display tabular">${escapeHtml(formatVND(ev.amount))}</div>
              <div class="event-actions">
                <button
                  type="button"
                  class="btn-status-attend"
                  data-action="toggle-attend"
                  data-id="${ev.id}"
                >Đã đi</button>
                <button
                  type="button"
                  class="btn-status-skip"
                  data-action="toggle-skip"
                  data-id="${ev.id}"
                >Không đi</button>
                <button
                  type="button"
                  class="btn-text-subtle"
                  data-action="dismiss-reminder"
                  data-id="${ev.id}"
                >Ẩn nhắc</button>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    return `
      <section id="upcoming-reminders-section" class="reminder-panel ${urgentReminderCount > 0 ? 'has-urgent' : ''}" aria-label="Thông báo nhắc nhở những ngày gần đến">
        <div class="reminder-header">
          <div class="reminder-heading-group">
            <h2 class="panel-title">Thông báo nhắc nhở ngày gần đến</h2>
            <p class="reminder-subtitle tabular">${escapeHtml(subtitle)}</p>
          </div>

          <div class="reminder-controls">
            <div class="mode-switch" role="group" aria-label="Chọn khoảng thời gian nhắc nhở">
              ${windows
                .map(
                  (w) => `
                    <button
                      type="button"
                      class="mode-btn tabular ${this.reminderWindowDays === w ? 'is-active' : ''}"
                      data-action="set-reminder-window"
                      data-days="${w}"
                    >${w} ngày</button>
                  `
                )
                .join('')}
            </div>

            <button
              type="button"
              class="btn-secondary-sm"
              data-action="trigger-reminder"
            >Chuông nhắc</button>

            ${
              dismissedCount > 0
                ? `<button
                    type="button"
                    class="btn-text-subtle"
                    data-action="restore-reminders"
                  >Hiện lại (${dismissedCount})</button>`
                : ''
            }
          </div>
        </div>

        ${
          activeReminders.length === 0
            ? `<div class="reminder-empty">
                <span class="empty-sub">Hiện không có ngày đám nào cần nhắc trong ${this.reminderWindowDays} ngày tới.</span>
                ${
                  hasLaterPending && this.reminderWindowDays < 30
                    ? `<button
                        type="button"
                        class="btn-micro"
                        data-action="set-reminder-window"
                        data-days="30"
                      >Xem lịch 30 ngày tới</button>`
                    : ''
                }
              </div>`
            : `<div class="reminder-list">${rowsHtml}</div>`
        }
      </section>
    `;
  }

  private renderEventRow(ev: FamilyEvent, now: Date): string {
    const urgency = getRowUrgency(ev, now);
    const isAttended = ev.status === 'attended';
    const isSkipped = ev.status === 'skipped';
    const isEditing = this.editingEventId === ev.id;
    const assignee = this.store.getMemberById(ev.assigneeId);
    const lunar = solarISOToLunar(ev.dateISO);

    if (isEditing) {
      return this.renderEventInlineEditor(ev, 'calendar');
    }

    return `
      <article class="event-row urgency-${urgency.cls}">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency urgency-text-${urgency.cls}">${escapeHtml(urgency.label)}</span>
            <span aria-hidden="true">·</span>
            <span class="tabular">${escapeHtml(formatDateVN(ev.dateISO))}</span>
            <span class="meta-lunar tabular">(${escapeHtml(formatLunarShort(lunar))})</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(CATEGORY_LABELS[ev.category])}</span>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              class="meta-priority-btn ${ev.priority === 'important' ? 'is-important' : ''}"
              data-action="toggle-priority"
              data-id="${ev.id}"
              title="Chạm để đổi mức độ ưu tiên"
            >${escapeHtml(PRIORITY_LABELS[ev.priority])}</button>
            ${
              assignee
                ? `<span aria-hidden="true">·</span><span class="meta-assignee">Đại diện: ${escapeHtml(assignee.name)}</span>`
                : ''
            }
          </div>
          <h3 class="event-title ${isSkipped ? 'is-muted' : ''}">${escapeHtml(ev.title)}</h3>
        </div>

        <div class="event-right">
          <span class="amount-display tabular ${isSkipped ? 'is-muted' : ''}">
            ${escapeHtml(formatVND(ev.amount))}
          </span>

          <div class="event-actions">
            <button
              type="button"
              class="btn-status-attend ${isAttended ? 'is-active' : ''}"
              data-action="toggle-attend"
              data-id="${ev.id}"
              aria-pressed="${isAttended ? 'true' : 'false'}"
            >${isAttended ? '✓ Đã đi' : 'Đã đi'}</button>

            <button
              type="button"
              class="btn-status-skip ${isSkipped ? 'is-active' : ''}"
              data-action="toggle-skip"
              data-id="${ev.id}"
              aria-pressed="${isSkipped ? 'true' : 'false'}"
            >${isSkipped ? '✕ Không đi' : 'Không đi'}</button>

            <button
              type="button"
              class="btn-edit"
              data-action="start-edit-event"
              data-id="${ev.id}"
            >Sửa</button>

            <button
              type="button"
              class="btn-delete"
              data-action="delete-event"
              data-id="${ev.id}"
              aria-label="Xóa ${escapeHtml(ev.title)}"
            >Xóa</button>
          </div>
        </div>
      </article>
    `;
  }

  private renderEventInlineEditor(
    ev: FamilyEvent,
    context: 'calendar' | 'fund'
  ): string {
    const members = this.store.getState().members;
    const formAction =
      context === 'calendar' ? 'save-event-edit' : 'save-fund-event-edit';
    const cancelAction =
      context === 'calendar' ? 'cancel-edit-event' : 'cancel-fund-event-edit';
    const lunar = solarISOToLunar(ev.dateISO);
    const currentYear = new Date().getFullYear();
    const years = [
      currentYear - 1,
      currentYear,
      currentYear + 1,
      currentYear + 2,
      currentYear + 3,
    ];

    return `
      <form class="inline-edit-box" data-action="${formAction}" data-id="${ev.id}">
        <div class="inline-edit-header">
          <div class="inline-edit-title">Chỉnh sửa thông tin ngày đám</div>
          <div class="mode-switch" role="group" aria-label="Đổi kiểu lịch khi sửa">
            <button
              type="button"
              class="mode-btn ${this.editEventCalendarMode === 'solar' ? 'is-active' : ''}"
              data-action="set-edit-cal-mode"
              data-mode="solar"
            >Dương lịch</button>
            <button
              type="button"
              class="mode-btn ${this.editEventCalendarMode === 'lunar' ? 'is-active' : ''}"
              data-action="set-edit-cal-mode"
              data-mode="lunar"
            >Âm lịch</button>
          </div>
        </div>
        <div class="inline-edit-grid">
          <div class="field-group span-2">
            <label class="field-label">Tên ngày đám / ngày giỗ</label>
            <input type="text" name="title" class="text-input" value="${escapeHtml(ev.title)}" required maxlength="64" />
          </div>

          ${
            this.editEventCalendarMode === 'solar'
              ? `
                <div class="field-group">
                  <label class="field-label">Ngày Dương lịch (${escapeHtml(formatLunarShort(lunar))})</label>
                  <input type="date" name="dateISO" class="text-input tabular" value="${escapeHtml(ev.dateISO)}" required />
                </div>
              `
              : `
                <div class="field-group span-2">
                  <label class="field-label">Chọn theo Âm lịch (Dương lịch hiện tại: ${escapeHtml(formatDateVN(ev.dateISO))})</label>
                  <div class="lunar-picker-row">
                    <select name="lunarDay" class="text-input tabular">
                      ${Array.from({length: 30}, (_, i) => i + 1)
                        .map(
                          (d) =>
                            `<option value="${d}" ${lunar.day === d ? 'selected' : ''}>Ngày ${d}</option>`
                        )
                        .join('')}
                    </select>
                    <select name="lunarMonth" class="text-input tabular">
                      ${Array.from({length: 12}, (_, i) => i + 1)
                        .map(
                          (m) =>
                            `<option value="${m}" ${lunar.month === m ? 'selected' : ''}>Tháng ${m} ÂL</option>`
                        )
                        .join('')}
                    </select>
                    <select name="lunarYear" class="text-input tabular">
                      ${years
                        .map(
                          (y) =>
                            `<option value="${y}" ${lunar.year === y ? 'selected' : ''}>${y} (${escapeHtml(getCanChiYear(y))})</option>`
                        )
                        .join('')}
                    </select>
                  </div>
                </div>
              `
          }

          <div class="field-group">
            <label class="field-label">Số tiền đám (đồng)</label>
            <input type="number" name="amount" class="text-input tabular" min="0" step="50000" value="${ev.amount}" required />
          </div>
          <div class="field-group">
            <label class="field-label">Phân loại</label>
            <select name="category" class="text-input">
              ${(Object.keys(CATEGORY_LABELS) as EventCategory[])
                .map(
                  (c) =>
                    `<option value="${c}" ${ev.category === c ? 'selected' : ''}>${escapeHtml(CATEGORY_LABELS[c])}</option>`
                )
                .join('')}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Mức độ ưu tiên</label>
            <select name="priority" class="text-input">
              <option value="important" ${ev.priority === 'important' ? 'selected' : ''}>Quan trọng</option>
              <option value="normal" ${ev.priority === 'normal' ? 'selected' : ''}>Bình thường</option>
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Trạng thái tham dự</label>
            <select name="status" class="text-input">
              <option value="pending" ${ev.status === 'pending' ? 'selected' : ''}>Sắp đi</option>
              <option value="attended" ${ev.status === 'attended' ? 'selected' : ''}>Đã đi</option>
              <option value="skipped" ${ev.status === 'skipped' ? 'selected' : ''}>Không đi</option>
            </select>
          </div>
          <div class="field-group">
            <label class="field-label">Người đại diện</label>
            <select name="assigneeId" class="text-input">
              <option value="">-- Chưa phân công --</option>
              ${members
                .map(
                  (m) =>
                    `<option value="${m.id}" ${ev.assigneeId === m.id ? 'selected' : ''}>${escapeHtml(m.name)} (${escapeHtml(m.relation)})</option>`
                )
                .join('')}
            </select>
          </div>
        </div>
        <div class="inline-edit-footer">
          <button type="button" class="btn-secondary-sm" data-action="${cancelAction}">Hủy</button>
          <button type="submit" class="btn-primary-sm">Lưu thay đổi</button>
        </div>
      </form>
    `;
  }

  // =========================================================================
  // TRANG 2: QUỸ CÁ NHÂN (PERSONAL FUND — LINKED WITH LỊCH ĐÁM)
  // =========================================================================
  private renderPersonalFundPage(now: Date): string {
    const state = this.store.getState();
    const summary = this.store.computePersonalSummary();
    const sortedEvents = this.store.getSortedEvents('all');
    const sortedTx = [...state.personalTransactions]
      .filter(
        (tx) => this.personalFilter === 'all' || tx.type === this.personalFilter
      )
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));

    const usedRatio =
      summary.totalAvailable > 0
        ? Math.min(
            100,
            Math.round((summary.totalExpense / summary.totalAvailable) * 100)
          )
        : summary.totalExpense > 0
          ? 100
          : 0;

    const draftPersonalLunar = solarISOToLunar(this.draftPersonalDateISO);
    const personalPresets = [200_000, 500_000, 1_000_000, 2_000_000] as const;

    const filterDefs: Array<{
      id: 'all' | PersonalTransactionType;
      label: string;
      count: number;
    }> = [
      {id: 'all', label: 'Tất cả', count: state.personalTransactions.length},
      {id: 'expense', label: 'Khoản chi', count: summary.expenseCount},
      {id: 'income', label: 'Khoản nạp', count: summary.incomeCount},
    ];

    return `
      <section class="page-intro">
        <div>
          <h1 class="page-heading">Quản lý Quỹ Cá Nhân</h1>
          <p class="page-subheading">
            Tự động liên kết toàn bộ tiền đám đã đi và dự chi từ mục Lịch đám, đồng thời cho phép ghi thêm các khoản nạp quỹ hoặc chi tiêu hiếu hỷ riêng của bản thân.
          </p>
        </div>
      </section>

      <!-- 4-Column Personal Fund KPI Strip -->
      <section class="kpi-strip" aria-label="Tổng quan quỹ cá nhân">
        <div class="kpi-cell">
          <div class="kpi-label-row">
            <span class="kpi-label">Ngân sách cá nhân gốc</span>
            <div class="kpi-inline-tools">
              <button type="button" class="btn-micro" data-action="personal-fund-delta" data-delta="-500000">-500k</button>
              <button type="button" class="btn-micro" data-action="personal-fund-delta" data-delta="500000">+500k</button>
              <button type="button" class="btn-micro" data-action="toggle-edit-personal-base">${this.editingPersonalBaseFund ? 'Đóng' : 'Sửa'}</button>
            </div>
          </div>
          ${
            this.editingPersonalBaseFund
              ? `<form class="inline-fund-form" id="personal-base-edit-form">
                  <input type="number" id="personal-base-input" class="inline-num-input tabular" min="0" step="100000" value="${summary.baseBudget}" aria-label="Nhập số tiền ngân sách cá nhân gốc" />
                  <button type="submit" class="btn-micro-save">Lưu</button>
                </form>`
              : `<div class="kpi-value tabular">${escapeHtml(formatVND(summary.baseBudget))}</div>`
          }
          <div class="kpi-sub">Mức dự phòng ban đầu của riêng bạn</div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng quỹ cá nhân hiện có</span>
          <div class="kpi-value tabular text-positive">${escapeHtml(formatVND(summary.totalAvailable))}</div>
          <div class="kpi-sub tabular">
            Gồm ${summary.incomeCount} khoản nạp thêm (${escapeHtml(formatVND(summary.totalIncome))})
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng tiền đám &amp; chi cá nhân</span>
          <div class="kpi-value tabular">${escapeHtml(formatVND(summary.totalExpense))}</div>
          <div class="kpi-sub tabular">
            Lịch đám ${escapeHtml(formatCompactVND(summary.eventActiveAmount))} (Đã đi ${escapeHtml(formatCompactVND(summary.eventSpent))} · Dự chi ${escapeHtml(formatCompactVND(summary.eventUpcoming))}) · Chi ngoài ${escapeHtml(formatCompactVND(summary.manualExpense))}
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Quỹ cá nhân còn lại (sau dự chi)</span>
          <div class="kpi-value tabular ${summary.remaining < 0 ? 'text-danger' : 'text-positive'}">
            ${escapeHtml(formatVND(summary.remaining))}
          </div>
          <div class="fund-meter" aria-hidden="true">
            <div class="fund-meter-fill ${summary.remaining < 0 ? 'is-over' : ''}" style="width: ${usedRatio}%"></div>
          </div>
          <div class="kpi-sub tabular">
            Thực tế đang cầm: ${escapeHtml(formatVND(summary.cashOnHand))}
          </div>
        </div>
      </section>

      <div class="workspace-grid">
        <!-- Left Column: Add Personal Fund Income / Expense -->
        <section class="panel-surface quick-add-panel" aria-label="Ghi thu chi quỹ cá nhân">
          <div class="panel-header">
            <h2 class="panel-title">Ghi thu / chi cá nhân</h2>
            <span class="panel-hint">Tự tính số dư tức thì</span>
          </div>

          <form id="add-personal-tx-form" class="quick-add-form" novalidate>
            <div class="field-group">
              <span class="field-label">Loại giao dịch</span>
              <div class="priority-toggle-row" role="group" aria-label="Chọn loại giao dịch quỹ cá nhân">
                <button
                  type="button"
                  class="seg-btn flex-1 ${this.draftPersonalType === 'expense' ? 'is-active-urgent' : ''}"
                  data-action="select-personal-type"
                  data-type="expense"
                >Chi đi đám / việc riêng</button>
                <button
                  type="button"
                  class="seg-btn flex-1 ${this.draftPersonalType === 'income' ? 'is-active' : ''}"
                  data-action="select-personal-type"
                  data-type="income"
                >Nạp vào quỹ</button>
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="ptx-title">Nội dung khoản thu / chi</label>
              <input
                id="ptx-title"
                type="text"
                class="text-input"
                maxlength="64"
                placeholder="${this.draftPersonalType === 'income' ? 'Ví dụ: Trích lương bỏ quỹ tháng này...' : 'Ví dụ: Mừng cưới bạn thân, Viếng đám...'}"
                value="${escapeHtml(this.draftPersonalTitle)}"
                autocomplete="off"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="ptx-date">Ngày thực hiện</label>
              <input
                id="ptx-date"
                type="date"
                class="text-input tabular"
                value="${escapeHtml(this.draftPersonalDateISO)}"
              />
              <div class="lunar-conversion-note">
                Âm lịch: <strong>${escapeHtml(formatLunarFull(draftPersonalLunar))}</strong>
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="ptx-amount">Số tiền (đồng)</label>
              <input
                id="ptx-amount"
                type="number"
                class="text-input tabular"
                min="0"
                step="50000"
                value="${this.draftPersonalAmount}"
              />
              <div class="button-row-wrap" role="group" aria-label="Chọn nhanh số tiền cá nhân">
                ${personalPresets
                  .map(
                    (amt) => `
                      <button
                        type="button"
                        class="seg-btn tabular ${this.draftPersonalAmount === amt ? 'is-active' : ''}"
                        data-action="select-personal-amount"
                        data-amount="${amt}"
                      >${escapeHtml(formatCompactVND(amt))}</button>
                    `
                  )
                  .join('')}
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="ptx-note">Ghi chú (tùy chọn)</label>
              <input
                id="ptx-note"
                type="text"
                class="text-input"
                maxlength="80"
                placeholder="Ví dụ: Đi cùng nhóm bạn cũ, chuyển khoản..."
                value="${escapeHtml(this.draftPersonalNote)}"
              />
            </div>

            <button type="submit" class="btn-submit-full">
              ${this.draftPersonalType === 'income' ? 'Nạp vào quỹ cá nhân' : 'Lưu khoản chi cá nhân'}
            </button>
          </form>
        </section>

        <!-- Right Column: Linked Lịch Đám Expenses + Personal Ledger -->
        <div class="stack-col">
          <section class="panel-surface" aria-label="Bảng kê tiền đám liên kết từ Lịch đám">
            <div class="panel-header">
              <h2 class="panel-title">Tiền từng ngày đám từ Lịch đám (${sortedEvents.length})</h2>
              <span class="panel-hint tabular">Tổng: ${escapeHtml(formatVND(summary.eventActiveAmount))}</span>
            </div>

            <div class="event-list">
              ${
                sortedEvents.length === 0
                  ? `<div class="empty-state">
                      <p class="empty-title">Chưa có ngày đám nào trong Lịch đám.</p>
                    </div>`
                  : sortedEvents
                      .map((ev) => this.renderFundEventRow(ev, now))
                      .join('')
              }
            </div>
          </section>

          <section class="panel-surface" aria-label="Sổ thu chi cá nhân khác">
            <div class="list-header">
              <div class="list-header-top">
                <h2 class="panel-title">Khoản nạp quỹ &amp; chi cá nhân khác (${sortedTx.length})</h2>
                <span class="panel-hint tabular">Nạp: ${escapeHtml(formatVND(summary.totalIncome))}</span>
              </div>

              <div class="filter-bar" role="tablist" aria-label="Lọc sổ quỹ cá nhân">
                ${filterDefs
                  .map(
                    (f) => `
                      <button
                        type="button"
                        role="tab"
                        aria-selected="${this.personalFilter === f.id}"
                        class="filter-tab tabular ${this.personalFilter === f.id ? 'is-active' : ''}"
                        data-action="set-personal-filter"
                        data-filter="${f.id}"
                      >${escapeHtml(f.label)} (${f.count})</button>
                    `
                  )
                  .join('')}
              </div>
            </div>

            <div class="event-list">
              ${
                sortedTx.length === 0
                  ? `<div class="empty-state">
                      <p class="empty-title">Chưa có khoản thu chi nào trong mục này.</p>
                      <p class="empty-sub">Hãy ghi nhanh một khoản nạp quỹ hoặc chi tiêu riêng ở khung bên cạnh.</p>
                    </div>`
                  : sortedTx.map((tx) => this.renderPersonalTxRow(tx)).join('')
              }
            </div>
          </section>
        </div>
      </div>
    `;
  }

  private renderPersonalTxRow(tx: PersonalTransaction): string {
    const lunar = solarISOToLunar(tx.dateISO);
    const isIncome = tx.type === 'income';

    if (this.editingPersonalTxId === tx.id) {
      return `
        <form class="inline-edit-box" data-action="save-personal-tx-edit" data-id="${tx.id}">
          <div class="inline-edit-title">Chỉnh sửa khoản quỹ cá nhân</div>
          <div class="inline-edit-grid">
            <div class="field-group span-2">
              <label class="field-label">Nội dung</label>
              <input type="text" name="title" class="text-input" maxlength="64" value="${escapeHtml(tx.title)}" required />
            </div>
            <div class="field-group">
              <label class="field-label">Loại giao dịch</label>
              <select name="type" class="text-input">
                <option value="expense" ${tx.type === 'expense' ? 'selected' : ''}>Chi đi đám / việc riêng</option>
                <option value="income" ${tx.type === 'income' ? 'selected' : ''}>Nạp vào quỹ</option>
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Ngày thực hiện (${escapeHtml(formatLunarShort(lunar))})</label>
              <input type="date" name="dateISO" class="text-input tabular" value="${escapeHtml(tx.dateISO)}" required />
            </div>
            <div class="field-group">
              <label class="field-label">Số tiền (đồng)</label>
              <input type="number" name="amount" class="text-input tabular" min="0" step="50000" value="${tx.amount}" required />
            </div>
            <div class="field-group">
              <label class="field-label">Ghi chú</label>
              <input type="text" name="note" class="text-input" maxlength="80" value="${escapeHtml(tx.note)}" />
            </div>
          </div>
          <div class="inline-edit-footer">
            <button type="button" class="btn-secondary-sm" data-action="cancel-edit-personal-tx">Hủy</button>
            <button type="submit" class="btn-primary-sm">Lưu thay đổi</button>
          </div>
        </form>
      `;
    }

    return `
      <article class="event-row ${isIncome ? 'urgency-attended' : 'urgency-far'}">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency ${isIncome ? 'urgency-text-attended' : 'urgency-text-urgent'}">
              ${isIncome ? 'Nạp quỹ' : 'Khoản chi'}
            </span>
            <span aria-hidden="true">·</span>
            <span class="tabular">${escapeHtml(formatDateVN(tx.dateISO))}</span>
            <span class="meta-lunar tabular">(${escapeHtml(formatLunarShort(lunar))})</span>
          </div>
          <h3 class="event-title">${escapeHtml(tx.title)}</h3>
          ${
            tx.note
              ? `<div class="member-sub-line">${escapeHtml(tx.note)}</div>`
              : ''
          }
        </div>
        <div class="event-right">
          <div class="amount-display tabular ${isIncome ? 'text-positive' : 'text-danger'}">
            ${isIncome ? '+' : '-'}${escapeHtml(formatVND(tx.amount))}
          </div>
          <div class="event-actions">
            <button
              type="button"
              class="btn-edit"
              data-action="start-edit-personal-tx"
              data-id="${tx.id}"
            >Sửa</button>
            <button
              type="button"
              class="btn-delete"
              data-action="delete-personal-tx"
              data-id="${tx.id}"
              aria-label="Xóa khoản quỹ cá nhân"
            >Xóa</button>
          </div>
        </div>
      </article>
    `;
  }

  // =========================================================================
  // TRANG 3: QUỸ GIA TỘC (STANDALONE CLAN FUND — UNLINKED FROM LỊCH ĐÁM)
  // =========================================================================
  private renderFundPage(): string {
    const state = this.store.getState();
    const summary = this.store.computeClanFundSummary();
    const sortedContribs = [...state.contributions]
      .filter((c) => {
        const entryType = c.type ?? 'income';
        return this.clanFundFilter === 'all' || entryType === this.clanFundFilter;
      })
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));

    const fundRatio =
      summary.totalAvailable > 0
        ? Math.min(
            100,
            Math.round((summary.totalClanExpense / summary.totalAvailable) * 100)
          )
        : summary.totalClanExpense > 0
          ? 100
          : 0;

    const filterDefs: Array<{
      id: 'all' | 'income' | 'expense';
      label: string;
      count: number;
    }> = [
      {id: 'all', label: 'Tất cả', count: state.contributions.length},
      {id: 'income', label: 'Đóng góp', count: summary.contributionCount},
      {id: 'expense', label: 'Khoản chi', count: summary.expenseCount},
    ];

    return `
      <section class="page-intro">
        <div>
          <h1 class="page-heading">Quản lý Quỹ Gia Tộc</h1>
          <p class="page-subheading">
            Sổ quỹ chung của gia tộc được quản lý độc lập để ghi nhận đóng góp và chi tiêu chung họ hàng, không cộng trừ vào Lịch đám hay Quỹ cá nhân của bạn.
          </p>
        </div>
      </section>

      <!-- 4-Column Standalone Clan Fund KPI Strip -->
      <section class="kpi-strip" aria-label="Tổng quan quỹ gia tộc">
        <div class="kpi-cell">
          <div class="kpi-label-row">
            <span class="kpi-label">Quỹ gia tộc gốc đầu năm</span>
            <div class="kpi-inline-tools">
              <button type="button" class="btn-micro" data-action="fund-delta" data-delta="-1000000">-1tr</button>
              <button type="button" class="btn-micro" data-action="fund-delta" data-delta="1000000">+1tr</button>
              <button type="button" class="btn-micro" data-action="toggle-edit-base-fund">${this.editingBaseFund ? 'Đóng' : 'Sửa'}</button>
            </div>
          </div>
          ${
            this.editingBaseFund
              ? `<form class="inline-fund-form" id="base-fund-edit-form">
                  <input type="number" id="base-fund-input" class="inline-num-input tabular" min="0" step="100000" value="${summary.baseBudget}" aria-label="Nhập số tiền quỹ gia tộc gốc đầu năm" />
                  <button type="submit" class="btn-micro-save">Lưu</button>
                </form>`
              : `<div class="kpi-value tabular">${escapeHtml(formatVND(summary.baseBudget))}</div>`
          }
          <div class="kpi-sub">Số dư chuyển tiếp đầu năm của gia tộc</div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng quỹ gia tộc hiện có</span>
          <div class="kpi-value tabular text-positive">${escapeHtml(formatVND(summary.totalAvailable))}</div>
          <div class="kpi-sub tabular">
            Gồm ${summary.contributionCount} khoản đóng góp (${escapeHtml(formatVND(summary.totalContributions))})
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng chi chung gia tộc</span>
          <div class="kpi-value tabular">${escapeHtml(formatVND(summary.totalClanExpense))}</div>
          <div class="kpi-sub tabular">
            ${summary.expenseCount} khoản chi chung · Tách biệt với Lịch đám
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Quỹ gia tộc còn lại</span>
          <div class="kpi-value tabular ${summary.remaining < 0 ? 'text-danger' : 'text-positive'}">
            ${escapeHtml(formatVND(summary.remaining))}
          </div>
          <div class="fund-meter" aria-hidden="true">
            <div class="fund-meter-fill ${summary.remaining < 0 ? 'is-over' : ''}" style="width: ${fundRatio}%"></div>
          </div>
          <div class="kpi-sub">
            ${summary.remaining >= 0 ? `Đã chi ${fundRatio}% quỹ gia tộc` : 'Đang vượt quỹ gia tộc'}
          </div>
        </div>
      </section>

      <div class="workspace-grid">
        <!-- Left Column: Add Clan Fund Income / Expense -->
        <section class="panel-surface quick-add-panel" aria-label="Ghi thu chi quỹ gia tộc">
          <div class="panel-header">
            <h2 class="panel-title">Ghi thu / chi quỹ gia tộc</h2>
            <span class="panel-hint">Quản lý riêng biệt</span>
          </div>

          <form id="add-contribution-form" class="quick-add-form" novalidate>
            <div class="field-group">
              <span class="field-label">Loại khoản mục</span>
              <div class="priority-toggle-row" role="group" aria-label="Chọn loại giao dịch quỹ gia tộc">
                <button
                  type="button"
                  class="seg-btn flex-1 ${this.draftContribType === 'income' ? 'is-active' : ''}"
                  data-action="select-contrib-type"
                  data-type="income"
                >Đóng góp vào quỹ</button>
                <button
                  type="button"
                  class="seg-btn flex-1 ${this.draftContribType === 'expense' ? 'is-active-urgent' : ''}"
                  data-action="select-contrib-type"
                  data-type="expense"
                >Chi quỹ gia tộc</button>
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-member">Thành viên gia tộc liên quan (tùy chọn)</label>
              <select id="ctb-member" class="text-input">
                <option value="">-- Nhập tên hoặc nội dung bên dưới --</option>
                ${state.members
                  .map(
                    (m) => `
                      <option value="${m.id}" ${this.draftContribMemberId === m.id ? 'selected' : ''}>
                        ${escapeHtml(m.name)} (${escapeHtml(m.relation)})
                      </option>
                    `
                  )
                  .join('')}
              </select>
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-name">
                ${this.draftContribType === 'expense' ? 'Nội dung khoản chi gia tộc' : 'Tên người đóng góp'}
              </label>
              <input
                id="ctb-name"
                type="text"
                class="text-input"
                maxlength="56"
                placeholder="${this.draftContribType === 'expense' ? 'Ví dụ: Sửa sang từ đường, Mua lễ chạp tổ...' : 'Ví dụ: Anh Tuấn, Bác Hai...'}"
                value="${escapeHtml(this.draftContribName)}"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-date">Ngày ghi nhận</label>
              <input
                id="ctb-date"
                type="date"
                class="text-input tabular"
                value="${escapeHtml(this.draftContribDateISO)}"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-amount">Số tiền (đồng)</label>
              <input
                id="ctb-amount"
                type="number"
                class="text-input tabular"
                min="0"
                step="100000"
                value="${this.draftContribAmount}"
              />
              <div class="button-row-wrap" role="group" aria-label="Chọn nhanh số tiền quỹ gia tộc">
                ${CONTRIBUTION_PRESETS.map(
                  (amt) => `
                    <button
                      type="button"
                      class="seg-btn tabular ${this.draftContribAmount === amt ? 'is-active' : ''}"
                      data-action="select-contrib-amount"
                      data-amount="${amt}"
                    >${escapeHtml(formatCompactVND(amt))}</button>
                  `
                ).join('')}
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-note">Ghi chú (tùy chọn)</label>
              <input
                id="ctb-note"
                type="text"
                class="text-input"
                maxlength="80"
                placeholder="${this.draftContribType === 'expense' ? 'Ví dụ: Chi theo quyết nghị họp họ' : 'Ví dụ: Đóng quỹ gia tộc năm nay'}"
                value="${escapeHtml(this.draftContribNote)}"
              />
            </div>

            <button type="submit" class="btn-submit-full">
              ${this.draftContribType === 'expense' ? 'Lưu khoản chi gia tộc' : 'Ghi nhận đóng góp quỹ'}
            </button>
          </form>
        </section>

        <!-- Right Column: Standalone Clan Fund Ledger -->
        <section class="panel-surface" aria-label="Sổ thu chi quỹ gia tộc">
          <div class="list-header">
            <div class="list-header-top">
              <h2 class="panel-title">Sổ thu chi quỹ gia tộc (${sortedContribs.length})</h2>
              <span class="panel-hint tabular">Còn lại: ${escapeHtml(formatVND(summary.remaining))}</span>
            </div>

            <div class="filter-bar" role="tablist" aria-label="Lọc sổ quỹ gia tộc">
              ${filterDefs
                .map(
                  (f) => `
                    <button
                      type="button"
                      role="tab"
                      aria-selected="${this.clanFundFilter === f.id}"
                      class="filter-tab tabular ${this.clanFundFilter === f.id ? 'is-active' : ''}"
                      data-action="set-clan-fund-filter"
                      data-filter="${f.id}"
                    >${escapeHtml(f.label)} (${f.count})</button>
                  `
                )
                .join('')}
            </div>
          </div>

          <div class="event-list">
            ${
              sortedContribs.length === 0
                ? `<div class="empty-state">
                    <p class="empty-title">Chưa có khoản thu chi nào trong mục này.</p>
                    <p class="empty-sub">Hãy ghi nhận đóng góp thành viên hoặc khoản chi chung gia tộc ở khung bên cạnh.</p>
                  </div>`
                : sortedContribs.map((c) => this.renderContributionRow(c)).join('')
            }
          </div>
        </section>
      </div>
    `;
  }

  private renderContributionRow(c: FundContribution): string {
    const entryType = c.type ?? 'income';
    const isExpense = entryType === 'expense';
    const lunar = solarISOToLunar(c.dateISO);

    if (this.editingContributionId === c.id) {
      const members = this.store.getState().members;
      return `
        <form class="inline-edit-box" data-action="save-contribution-edit" data-id="${c.id}">
          <div class="inline-edit-title">Chỉnh sửa khoản quỹ gia tộc</div>
          <div class="inline-edit-grid">
            <div class="field-group">
              <label class="field-label">Loại khoản mục</label>
              <select name="type" class="text-input">
                <option value="income" ${!isExpense ? 'selected' : ''}>Đóng góp vào quỹ</option>
                <option value="expense" ${isExpense ? 'selected' : ''}>Chi quỹ gia tộc</option>
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Thành viên liên quan</label>
              <select name="memberId" class="text-input">
                <option value="">-- Không chọn --</option>
                ${members
                  .map(
                    (m) =>
                      `<option value="${m.id}" ${c.memberId === m.id ? 'selected' : ''}>${escapeHtml(m.name)} (${escapeHtml(m.relation)})</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field-group span-2">
              <label class="field-label">Tên người đóng / Nội dung khoản chi</label>
              <input type="text" name="contributorName" class="text-input" value="${escapeHtml(c.contributorName)}" required maxlength="56" />
            </div>
            <div class="field-group">
              <label class="field-label">Ngày ghi nhận</label>
              <input type="date" name="dateISO" class="text-input tabular" value="${escapeHtml(c.dateISO)}" required />
            </div>
            <div class="field-group">
              <label class="field-label">Số tiền (đồng)</label>
              <input type="number" name="amount" class="text-input tabular" min="0" step="100000" value="${c.amount}" required />
            </div>
            <div class="field-group span-2">
              <label class="field-label">Ghi chú</label>
              <input type="text" name="note" class="text-input" value="${escapeHtml(c.note)}" maxlength="80" />
            </div>
          </div>
          <div class="inline-edit-footer">
            <button type="button" class="btn-secondary-sm" data-action="cancel-edit-contribution">Hủy</button>
            <button type="submit" class="btn-primary-sm">Lưu thay đổi</button>
          </div>
        </form>
      `;
    }

    return `
      <article class="event-row ${isExpense ? 'urgency-far' : 'urgency-attended'}">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency ${isExpense ? 'urgency-text-urgent' : 'urgency-text-attended'}">
              ${isExpense ? 'Chi gia tộc' : 'Đóng góp quỹ'}
            </span>
            <span aria-hidden="true">·</span>
            <span class="tabular">${escapeHtml(formatDateVN(c.dateISO))}</span>
            <span class="meta-lunar tabular">(${escapeHtml(formatLunarShort(lunar))})</span>
            ${
              c.note
                ? `<span aria-hidden="true">·</span><span>${escapeHtml(c.note)}</span>`
                : ''
            }
          </div>
          <h3 class="event-title">${escapeHtml(c.contributorName)}</h3>
        </div>
        <div class="event-right">
          <span class="amount-display tabular ${isExpense ? 'text-danger' : 'text-positive'}">
            ${isExpense ? '-' : '+'}${escapeHtml(formatVND(c.amount))}
          </span>
          <div class="event-actions">
            <button type="button" class="btn-edit" data-action="start-edit-contribution" data-id="${c.id}">Sửa</button>
            <button type="button" class="btn-delete" data-action="delete-contribution" data-id="${c.id}">Xóa</button>
          </div>
        </div>
      </article>
    `;
  }

  private renderFundEventRow(ev: FamilyEvent, now: Date): string {
    if (this.editingFundEventId === ev.id) {
      return this.renderEventInlineEditor(ev, 'fund');
    }
    const urgency = getRowUrgency(ev, now);
    const isSkipped = ev.status === 'skipped';
    const lunar = solarISOToLunar(ev.dateISO);

    return `
      <article class="event-row urgency-${urgency.cls}">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency urgency-text-${urgency.cls}">${escapeHtml(STATUS_LABELS[ev.status])}</span>
            <span aria-hidden="true">·</span>
            <span class="tabular">${escapeHtml(formatDateVN(ev.dateISO))}</span>
            <span class="meta-lunar tabular">(${escapeHtml(formatLunarShort(lunar))})</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(CATEGORY_LABELS[ev.category])}</span>
          </div>
          <h3 class="event-title ${isSkipped ? 'is-muted' : ''}">${escapeHtml(ev.title)}</h3>
        </div>
        <div class="event-right">
          <span class="amount-display tabular ${isSkipped ? 'is-muted' : ''}">
            ${isSkipped ? '0 đ (Không đi)' : `-${escapeHtml(formatVND(ev.amount))}`}
          </span>
          <div class="event-actions">
            <button type="button" class="btn-edit" data-action="start-edit-fund-event" data-id="${ev.id}">Sửa</button>
          </div>
        </div>
      </article>
    `;
  }

  // =========================================================================
  // TRANG 4: GIA ĐÌNH & GIA TỘC (FAMILY MEMBERS PAGE)
  // =========================================================================
  private renderFamilyPage(): string {
    const state = this.store.getState();
    const members = state.members;

    const smallFamilyCount = members.filter((m) => m.branch === 'gia_dinh').length;
    const extendedCount = members.length - smallFamilyCount;
    const totalMemberContribs = state.contributions
      .filter((c) => c.type !== 'expense')
      .reduce((acc, c) => acc + c.amount, 0);

    const branchFilters: Array<{id: 'all' | FamilyBranch; label: string}> = [
      {id: 'all', label: `Tất cả (${members.length})`},
      {
        id: 'gia_dinh',
        label: `Gia đình nhỏ (${members.filter((m) => m.branch === 'gia_dinh').length})`,
      },
      {
        id: 'ben_noi',
        label: `Bên Nội (${members.filter((m) => m.branch === 'ben_noi').length})`,
      },
      {
        id: 'ben_ngoai',
        label: `Bên Ngoại (${members.filter((m) => m.branch === 'ben_ngoai').length})`,
      },
      {
        id: 'chi_ho',
        label: `Chi họ (${members.filter((m) => m.branch === 'chi_ho').length})`,
      },
    ];

    const q = this.familySearchQuery.trim().toLowerCase();
    const visibleMembers = members.filter((m) => {
      if (
        this.familyBranchFilter !== 'all' &&
        m.branch !== this.familyBranchFilter
      ) {
        return false;
      }
      if (!q) return true;
      const hay = `${m.name} ${m.relation} ${BRANCH_LABELS[m.branch]} ${m.phone} ${m.note}`.toLowerCase();
      return hay.includes(q);
    });

    return `
      <section class="page-intro">
        <div>
          <h1 class="page-heading">Thành viên Gia đình & Gia tộc</h1>
          <p class="page-subheading">
            Lưu danh sách người thân, số điện thoại liên hệ, phân công đại diện đi đám và theo dõi đóng góp quỹ của từng thành viên.
          </p>
        </div>
      </section>

      <!-- 4-Column Family KPI Strip -->
      <section class="kpi-strip" aria-label="Thống kê thành viên gia đình">
        <div class="kpi-cell">
          <span class="kpi-label">Tổng số thành viên</span>
          <div class="kpi-value tabular">${members.length} người</div>
          <div class="kpi-sub">Đang lưu trong sổ gia đình</div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Gia đình nhỏ</span>
          <div class="kpi-value tabular">${smallFamilyCount} người</div>
          <div class="kpi-sub">Thành viên trực tiếp trong nhà</div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Họ hàng (Nội / Ngoại / Chi họ)</span>
          <div class="kpi-value tabular">${extendedCount} người</div>
          <div class="kpi-sub">Đầu mối liên hệ ngày giỗ chạp</div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng đóng góp quỹ đã ghi</span>
          <div class="kpi-value tabular text-positive">${escapeHtml(formatVND(totalMemberContribs))}</div>
          <div class="kpi-sub">Đồng bộ trực tiếp với trang Quỹ gia tộc</div>
        </div>
      </section>

      <div class="workspace-grid">
        <!-- Left Column: Add New Family Member -->
        <section class="panel-surface quick-add-panel" aria-label="Thêm thành viên gia đình">
          <div class="panel-header">
            <h2 class="panel-title">Thêm thành viên mới</h2>
            <span class="panel-hint">Dùng ngay cho lịch & quỹ</span>
          </div>

          <form id="add-member-form" class="quick-add-form" novalidate>
            <div class="field-group">
              <label class="field-label" for="mem-name">Họ và tên thành viên</label>
              <input
                id="mem-name"
                type="text"
                class="text-input"
                maxlength="56"
                placeholder="Ví dụ: Nguyễn Thị Mai, Chú Hùng..."
                value="${escapeHtml(this.draftMemberName)}"
                autocomplete="off"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="mem-relation">Vai vế / Quan hệ</label>
              <input
                id="mem-relation"
                type="text"
                class="text-input"
                maxlength="32"
                placeholder="Ví dụ: Bố, Mẹ, Chú, Bác Hai..."
                value="${escapeHtml(this.draftMemberRelation)}"
              />
              <div class="button-row-wrap" role="group" aria-label="Chọn nhanh vai vế">
                ${RELATION_PRESETS.map(
                  (rel) => `
                    <button
                      type="button"
                      class="seg-btn ${this.draftMemberRelation === rel ? 'is-active' : ''}"
                      data-action="select-relation-preset"
                      data-relation="${escapeHtml(rel)}"
                    >${escapeHtml(rel)}</button>
                  `
                ).join('')}
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="mem-branch">Nhóm / Nhánh gia tộc</label>
              <select id="mem-branch" class="text-input">
                ${(Object.keys(BRANCH_LABELS) as FamilyBranch[])
                  .map(
                    (b) =>
                      `<option value="${b}" ${this.draftMemberBranch === b ? 'selected' : ''}>${escapeHtml(BRANCH_LABELS[b])}</option>`
                  )
                  .join('')}
              </select>
            </div>

            <div class="field-group">
              <label class="field-label" for="mem-phone">Số điện thoại (tùy chọn)</label>
              <input
                id="mem-phone"
                type="tel"
                class="text-input tabular"
                maxlength="20"
                placeholder="Ví dụ: 0912 345 678"
                value="${escapeHtml(this.draftMemberPhone)}"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="mem-note">Ghi chú vai trò (tùy chọn)</label>
              <input
                id="mem-note"
                type="text"
                class="text-input"
                maxlength="90"
                placeholder="Ví dụ: Phụ trách đặt cỗ, thủ quỹ họ..."
                value="${escapeHtml(this.draftMemberNote)}"
              />
            </div>

            <button type="submit" class="btn-submit-full">
              Thêm vào danh sách gia đình
            </button>
          </form>
        </section>

        <!-- Right Column: Family Members Directory -->
        <section class="panel-surface list-panel" aria-label="Danh sách thành viên gia đình">
          <div class="list-header">
            <div class="list-header-top">
              <h2 class="panel-title">Danh sách thành viên (${visibleMembers.length})</h2>
              <span class="panel-hint">Bấm "Sửa" để cập nhật thông tin</span>
            </div>

            <div class="list-controls">
              <div class="filter-bar" role="tablist" aria-label="Lọc theo nhánh gia đình">
                ${branchFilters
                  .map(
                    (bf) => `
                      <button
                        type="button"
                        role="tab"
                        aria-selected="${this.familyBranchFilter === bf.id ? 'true' : 'false'}"
                        class="filter-tab ${this.familyBranchFilter === bf.id ? 'is-active' : ''}"
                        data-action="set-branch-filter"
                        data-branch="${bf.id}"
                      >${escapeHtml(bf.label)}</button>
                    `
                  )
                  .join('')}
              </div>

              <input
                id="search-members"
                type="search"
                class="search-input"
                placeholder="Tìm tên, vai vế, SĐT..."
                value="${escapeHtml(this.familySearchQuery)}"
                aria-label="Tìm kiếm thành viên gia đình"
              />
            </div>
          </div>

          <div class="event-list">
            ${
              visibleMembers.length === 0
                ? `<div class="empty-state">
                    <p class="empty-title">Chưa có thành viên nào trong nhóm này.</p>
                    <p class="empty-sub">Hãy thêm thành viên ở khung bên cạnh để dễ dàng phân công lịch giỗ và theo dõi đóng quỹ.</p>
                  </div>`
                : visibleMembers.map((m) => this.renderMemberRow(m)).join('')
            }
          </div>
        </section>
      </div>
    `;
  }

  private renderMemberRow(m: FamilyMember): string {
    if (this.editingMemberId === m.id) {
      return `
        <form class="inline-edit-box" data-action="save-member-edit" data-id="${m.id}">
          <div class="inline-edit-title">Chỉnh sửa thông tin thành viên</div>
          <div class="inline-edit-grid">
            <div class="field-group">
              <label class="field-label">Họ và tên</label>
              <input type="text" name="name" class="text-input" value="${escapeHtml(m.name)}" required maxlength="56" />
            </div>
            <div class="field-group">
              <label class="field-label">Vai vế / Quan hệ</label>
              <input type="text" name="relation" class="text-input" value="${escapeHtml(m.relation)}" required maxlength="32" />
            </div>
            <div class="field-group">
              <label class="field-label">Nhóm / Nhánh</label>
              <select name="branch" class="text-input">
                ${(Object.keys(BRANCH_LABELS) as FamilyBranch[])
                  .map(
                    (b) =>
                      `<option value="${b}" ${m.branch === b ? 'selected' : ''}>${escapeHtml(BRANCH_LABELS[b])}</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Số điện thoại</label>
              <input type="tel" name="phone" class="text-input tabular" value="${escapeHtml(m.phone)}" maxlength="20" />
            </div>
            <div class="field-group span-2">
              <label class="field-label">Ghi chú vai trò</label>
              <input type="text" name="note" class="text-input" value="${escapeHtml(m.note)}" maxlength="90" />
            </div>
          </div>
          <div class="inline-edit-footer">
            <button type="button" class="btn-secondary-sm" data-action="cancel-edit-member">Hủy</button>
            <button type="submit" class="btn-primary-sm">Lưu thay đổi</button>
          </div>
        </form>
      `;
    }

    const state = this.store.getState();
    const contributed = state.contributions
      .filter((c) => c.memberId === m.id && c.type !== 'expense')
      .reduce((acc, c) => acc + c.amount, 0);
    const assignedCount = state.events.filter((e) => e.assigneeId === m.id).length;

    return `
      <article class="event-row urgency-far">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency urgency-text-far">${escapeHtml(m.relation)}</span>
            <span aria-hidden="true">·</span>
            <span>${escapeHtml(BRANCH_LABELS[m.branch])}</span>
            ${
              m.phone
                ? `<span aria-hidden="true">·</span><span class="tabular">${escapeHtml(m.phone)}</span>`
                : ''
            }
          </div>
          <h3 class="event-title">${escapeHtml(m.name)}</h3>
          <div class="member-sub-line">
            ${
              m.note
                ? `<span>${escapeHtml(m.note)}</span>`
                : '<span class="text-muted">Chưa có ghi chú vai trò</span>'
            }
          </div>
          <div class="event-meta-line tabular">
            <span>Đã đóng quỹ: <strong>${escapeHtml(formatVND(contributed))}</strong></span>
            <span aria-hidden="true">·</span>
            <span>Đại diện: <strong>${assignedCount} đám</strong></span>
          </div>
        </div>

        <div class="event-right">
          <div class="event-actions">
            <button type="button" class="btn-edit" data-action="start-edit-member" data-id="${m.id}">Sửa</button>
            <button type="button" class="btn-delete" data-action="delete-member" data-id="${m.id}" aria-label="Xóa ${escapeHtml(m.name)}">Xóa</button>
          </div>
        </div>
      </article>
    `;
  }

  private getFilteredEvents(): FamilyEvent[] {
    const base = this.store.getSortedEvents(this.store.getState().filter);
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base.filter((ev) => {
      const assignee = this.store.getMemberById(ev.assigneeId);
      const lunarText = formatLunarShort(solarISOToLunar(ev.dateISO));
      const hay = `${ev.title} ${CATEGORY_LABELS[ev.category]} ${formatDateVN(ev.dateISO)} ${lunarText} ${assignee?.name ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  private handleQuickAddSubmit(): void {
    const titleInput = this.root.querySelector<HTMLInputElement>('#qa-title');
    const dateInput = this.root.querySelector<HTMLInputElement>('#qa-date');
    const amountInput = this.root.querySelector<HTMLInputElement>('#qa-amount');
    const assigneeSelect =
      this.root.querySelector<HTMLSelectElement>('#qa-assignee');

    const typedTitle = (titleInput?.value ?? this.draftTitle).trim();
    const fallbackTitle =
      QUICK_TITLE_TEMPLATES.find((t) => t.category === this.draftCategory)
        ?.title ?? 'Ngày đám gia đình';
    const finalTitle = typedTitle || fallbackTitle;
    const finalDate =
      this.draftCalendarMode === 'solar'
        ? dateInput?.value || this.draftDateISO
        : this.draftDateISO;
    const parsedAmount = Number(
      (amountInput?.value ?? '').replace(/[^\d]/g, '')
    );
    const finalAmount =
      Number.isFinite(parsedAmount) &&
      parsedAmount >= 0 &&
      amountInput?.value.trim() !== ''
        ? parsedAmount
        : this.draftAmount;
    const assigneeId = assigneeSelect?.value || this.draftAssigneeId || undefined;

    this.store.addEvent({
      title: finalTitle,
      dateISO: finalDate,
      calendarType: this.draftCalendarMode,
      category: this.draftCategory,
      priority: this.draftPriority,
      amount: finalAmount,
      assigneeId,
    });

    const lunarStr = formatLunarShort(solarISOToLunar(finalDate));
    this.draftTitle = '';
    this.draftDateISO = addDaysISO(new Date(), 0);
    this.syncDraftLunarFromSolar(this.draftDateISO);
    this.draftAssigneeId = '';
    this.audio.playComplete();
    this.render();
    this.showToast(
      `Đã ghi nhanh "${finalTitle}" (${formatDateVN(finalDate)} · ${lunarStr} · ${formatVND(finalAmount)})`
    );
  }

  private handleAddPersonalTxSubmit(): void {
    const titleInput = this.root.querySelector<HTMLInputElement>('#ptx-title');
    const dateInput = this.root.querySelector<HTMLInputElement>('#ptx-date');
    const amountInput = this.root.querySelector<HTMLInputElement>('#ptx-amount');
    const noteInput = this.root.querySelector<HTMLInputElement>('#ptx-note');

    const title = (titleInput?.value ?? this.draftPersonalTitle).trim();
    const dateISO = dateInput?.value || this.draftPersonalDateISO;
    const parsedAmount = Number(
      (amountInput?.value ?? '').replace(/[^\d]/g, '')
    );
    const amount =
      Number.isFinite(parsedAmount) && parsedAmount > 0
        ? parsedAmount
        : this.draftPersonalAmount;
    const note = (noteInput?.value ?? this.draftPersonalNote).trim();

    if (amount <= 0) {
      this.showToast('Vui lòng nhập số tiền lớn hơn 0 đ.');
      return;
    }

    const tx = this.store.addPersonalTransaction({
      type: this.draftPersonalType,
      title,
      dateISO,
      amount,
      note,
    });

    this.draftPersonalTitle = '';
    this.draftPersonalNote = '';
    this.draftPersonalDateISO = addDaysISO(new Date(), 0);
    this.audio.playComplete();
    this.render();
    this.showToast(
      tx.type === 'income'
        ? `Đã nạp ${formatVND(tx.amount)} vào quỹ cá nhân.`
        : `Đã ghi khoản chi "${tx.title}" (${formatVND(tx.amount)}) vào quỹ cá nhân.`
    );
  }

  private handleAddContributionSubmit(): void {
    const memberSelect =
      this.root.querySelector<HTMLSelectElement>('#ctb-member');
    const nameInput = this.root.querySelector<HTMLInputElement>('#ctb-name');
    const dateInput = this.root.querySelector<HTMLInputElement>('#ctb-date');
    const amountInput = this.root.querySelector<HTMLInputElement>('#ctb-amount');
    const noteInput = this.root.querySelector<HTMLInputElement>('#ctb-note');

    const memberId = memberSelect?.value || undefined;
    const member = this.store.getMemberById(memberId);
    const contributorName =
      (nameInput?.value ?? this.draftContribName).trim() ||
      (this.draftContribType === 'expense'
        ? 'Khoản chi quỹ gia tộc'
        : member?.name || 'Thành viên gia đình');
    const dateISO = dateInput?.value || this.draftContribDateISO;
    const parsedAmt = Number((amountInput?.value ?? '').replace(/[^\d]/g, ''));
    const amount =
      Number.isFinite(parsedAmt) && parsedAmt >= 0
        ? parsedAmt
        : this.draftContribAmount;
    const note = (noteInput?.value ?? this.draftContribNote).trim();

    this.store.addContribution({
      type: this.draftContribType,
      memberId,
      contributorName,
      dateISO,
      amount,
      note,
    });

    this.draftContribMemberId = '';
    this.draftContribName = '';
    this.draftContribNote = '';
    this.audio.playComplete();
    this.render();
    this.showToast(
      this.draftContribType === 'expense'
        ? `Đã ghi khoản chi quỹ gia tộc -${formatVND(amount)} (${contributorName}).`
        : `Đã ghi đóng góp quỹ gia tộc +${formatVND(amount)} từ ${contributorName}.`
    );
  }

  private handleAddMemberSubmit(): void {
    const nameInput = this.root.querySelector<HTMLInputElement>('#mem-name');
    const relInput = this.root.querySelector<HTMLInputElement>('#mem-relation');
    const branchSelect =
      this.root.querySelector<HTMLSelectElement>('#mem-branch');
    const phoneInput = this.root.querySelector<HTMLInputElement>('#mem-phone');
    const noteInput = this.root.querySelector<HTMLInputElement>('#mem-note');

    const name = (nameInput?.value ?? this.draftMemberName).trim();
    if (!name) {
      this.showToast('Vui lòng nhập họ và tên thành viên trước khi lưu.');
      nameInput?.focus();
      return;
    }

    const relation =
      (relInput?.value ?? this.draftMemberRelation).trim() || 'Người thân';
    const branch =
      (branchSelect?.value as FamilyBranch) || this.draftMemberBranch;
    const phone = (phoneInput?.value ?? this.draftMemberPhone).trim();
    const note = (noteInput?.value ?? this.draftMemberNote).trim();

    this.store.addMember({name, relation, branch, phone, note});

    this.draftMemberName = '';
    this.draftMemberPhone = '';
    this.draftMemberNote = '';
    this.audio.playComplete();
    this.render();
    this.showToast(`Đã thêm thành viên "${name}" (${relation}) vào sổ gia đình.`);
  }

  private bindEvents(): void {
    // --- Calendar Quick-Add Form ---
    const qaForm = this.root.querySelector<HTMLFormElement>('#quick-add-form');
    qaForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleQuickAddSubmit();
    });

    const qaTitle = this.root.querySelector<HTMLInputElement>('#qa-title');
    qaTitle?.addEventListener('input', () => {
      this.draftTitle = qaTitle.value;
    });

    const qaDate = this.root.querySelector<HTMLInputElement>('#qa-date');
    qaDate?.addEventListener('change', () => {
      if (qaDate.value) {
        this.draftDateISO = qaDate.value;
        this.syncDraftLunarFromSolar(qaDate.value);
        this.render();
      }
    });

    // Quick-Add Lunar pickers (synced live with #qa-date)
    const qaLunarDay =
      this.root.querySelector<HTMLSelectElement>('#qa-lunar-day');
    qaLunarDay?.addEventListener('change', () => {
      this.draftLunarDay = Number(qaLunarDay.value) || 1;
      this.draftCalendarMode = 'lunar';
      this.syncDraftSolarFromLunar();
      this.render();
    });

    const qaLunarMonth =
      this.root.querySelector<HTMLSelectElement>('#qa-lunar-month');
    qaLunarMonth?.addEventListener('change', () => {
      this.draftLunarMonth = Number(qaLunarMonth.value) || 1;
      this.draftCalendarMode = 'lunar';
      this.syncDraftSolarFromLunar();
      this.render();
    });

    const qaLunarYear =
      this.root.querySelector<HTMLSelectElement>('#qa-lunar-year');
    qaLunarYear?.addEventListener('change', () => {
      this.draftLunarYear = Number(qaLunarYear.value) || new Date().getFullYear();
      this.draftCalendarMode = 'lunar';
      this.syncDraftSolarFromLunar();
      this.render();
    });

    const qaLunarLeap =
      this.root.querySelector<HTMLInputElement>('#qa-lunar-leap');
    qaLunarLeap?.addEventListener('change', () => {
      this.draftLunarLeap = qaLunarLeap.checked;
      this.draftCalendarMode = 'lunar';
      this.syncDraftSolarFromLunar();
      this.render();
    });

    const qaAmount = this.root.querySelector<HTMLInputElement>('#qa-amount');
    qaAmount?.addEventListener('input', () => {
      const n = Number(qaAmount.value);
      if (Number.isFinite(n) && n >= 0) this.draftAmount = n;
    });

    const qaAssignee =
      this.root.querySelector<HTMLSelectElement>('#qa-assignee');
    qaAssignee?.addEventListener('change', () => {
      this.draftAssigneeId = qaAssignee.value;
    });

    // Calendar search input
    const searchEvents =
      this.root.querySelector<HTMLInputElement>('#search-events');
    searchEvents?.addEventListener('input', () => {
      const caret = searchEvents.selectionStart ?? searchEvents.value.length;
      this.searchQuery = searchEvents.value;
      this.render();
      const refreshed =
        this.root.querySelector<HTMLInputElement>('#search-events');
      if (refreshed) {
        refreshed.focus();
        refreshed.setSelectionRange(caret, caret);
      }
    });

    // --- Personal Fund Base Budget & Transaction Forms ---
    const personalBaseForm = this.root.querySelector<HTMLFormElement>(
      '#personal-base-edit-form'
    );
    personalBaseForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = this.root.querySelector<HTMLInputElement>(
        '#personal-base-input'
      );
      const val = Number(input?.value ?? 0);
      this.editingPersonalBaseFund = false;
      this.store.setPersonalFundBudget(val);
      this.audio.playTap(520);
      this.showToast(`Đã cập nhật Ngân sách cá nhân gốc thành ${formatVND(val)}.`);
    });

    const ptxForm = this.root.querySelector<HTMLFormElement>(
      '#add-personal-tx-form'
    );
    ptxForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddPersonalTxSubmit();
    });

    const ptxTitle = this.root.querySelector<HTMLInputElement>('#ptx-title');
    ptxTitle?.addEventListener('input', () => {
      this.draftPersonalTitle = ptxTitle.value;
    });

    const ptxDate = this.root.querySelector<HTMLInputElement>('#ptx-date');
    ptxDate?.addEventListener('change', () => {
      if (ptxDate.value) {
        this.draftPersonalDateISO = ptxDate.value;
        this.render();
      }
    });

    const ptxAmount = this.root.querySelector<HTMLInputElement>('#ptx-amount');
    ptxAmount?.addEventListener('input', () => {
      const n = Number(ptxAmount.value);
      if (Number.isFinite(n) && n >= 0) this.draftPersonalAmount = n;
    });

    const ptxNote = this.root.querySelector<HTMLInputElement>('#ptx-note');
    ptxNote?.addEventListener('input', () => {
      this.draftPersonalNote = ptxNote.value;
    });

    // --- Fund Base Budget Edit Form ---
    const baseFundForm = this.root.querySelector<HTMLFormElement>(
      '#base-fund-edit-form'
    );
    baseFundForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input =
        this.root.querySelector<HTMLInputElement>('#base-fund-input');
      const val = Number(input?.value ?? 0);
      this.editingBaseFund = false;
      this.store.setFundBudget(val);
      this.audio.playTap(520);
      this.showToast(`Đã cập nhật Quỹ gốc đầu năm thành ${formatVND(val)}.`);
    });

    // --- Add Contribution Form ---
    const ctbForm = this.root.querySelector<HTMLFormElement>(
      '#add-contribution-form'
    );
    ctbForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddContributionSubmit();
    });

    const ctbMember = this.root.querySelector<HTMLSelectElement>('#ctb-member');
    ctbMember?.addEventListener('change', () => {
      this.draftContribMemberId = ctbMember.value;
      const member = this.store.getMemberById(ctbMember.value);
      if (member && this.draftContribType === 'income') {
        this.draftContribName = member.name;
      }
      this.render();
    });

    const ctbName = this.root.querySelector<HTMLInputElement>('#ctb-name');
    ctbName?.addEventListener('input', () => {
      this.draftContribName = ctbName.value;
    });

    const ctbDate = this.root.querySelector<HTMLInputElement>('#ctb-date');
    ctbDate?.addEventListener('change', () => {
      if (ctbDate.value) this.draftContribDateISO = ctbDate.value;
    });

    const ctbAmount = this.root.querySelector<HTMLInputElement>('#ctb-amount');
    ctbAmount?.addEventListener('input', () => {
      const n = Number(ctbAmount.value);
      if (Number.isFinite(n) && n >= 0) this.draftContribAmount = n;
    });

    const ctbNote = this.root.querySelector<HTMLInputElement>('#ctb-note');
    ctbNote?.addEventListener('input', () => {
      this.draftContribNote = ctbNote.value;
    });

    // --- Add Member Form ---
    const memForm = this.root.querySelector<HTMLFormElement>('#add-member-form');
    memForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddMemberSubmit();
    });

    const memName = this.root.querySelector<HTMLInputElement>('#mem-name');
    memName?.addEventListener('input', () => {
      this.draftMemberName = memName.value;
    });

    const memRel = this.root.querySelector<HTMLInputElement>('#mem-relation');
    memRel?.addEventListener('input', () => {
      this.draftMemberRelation = memRel.value;
    });

    const memBranch = this.root.querySelector<HTMLSelectElement>('#mem-branch');
    memBranch?.addEventListener('change', () => {
      this.draftMemberBranch = memBranch.value as FamilyBranch;
    });

    const memPhone = this.root.querySelector<HTMLInputElement>('#mem-phone');
    memPhone?.addEventListener('input', () => {
      this.draftMemberPhone = memPhone.value;
    });

    const memNote = this.root.querySelector<HTMLInputElement>('#mem-note');
    memNote?.addEventListener('input', () => {
      this.draftMemberNote = memNote.value;
    });

    // Family search input
    const searchMembers =
      this.root.querySelector<HTMLInputElement>('#search-members');
    searchMembers?.addEventListener('input', () => {
      const caret = searchMembers.selectionStart ?? searchMembers.value.length;
      this.familySearchQuery = searchMembers.value;
      this.render();
      const refreshed =
        this.root.querySelector<HTMLInputElement>('#search-members');
      if (refreshed) {
        refreshed.focus();
        refreshed.setSelectionRange(caret, caret);
      }
    });

    // --- Inline Edit Form Submissions ---
    this.root
      .querySelectorAll<HTMLFormElement>(
        'form[data-action="save-event-edit"], form[data-action="save-fund-event-edit"]'
      )
      .forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const id = form.dataset.id;
          if (!id) return;
          const fd = new FormData(form);
          let nextDateISO = String(fd.get('dateISO') ?? '');
          if (this.editEventCalendarMode === 'lunar') {
            const ld = Number(fd.get('lunarDay') ?? 1);
            const lm = Number(fd.get('lunarMonth') ?? 1);
            const ly = Number(fd.get('lunarYear') ?? new Date().getFullYear());
            nextDateISO = lunarToSolarISO(ld, lm, ly, false);
          }
          this.editingEventId = null;
          this.editingFundEventId = null;
          this.store.updateEvent(id, {
            title: String(fd.get('title') ?? ''),
            dateISO: nextDateISO || undefined,
            calendarType: this.editEventCalendarMode,
            amount: Number(fd.get('amount') ?? 0),
            category: String(fd.get('category') ?? 'gio') as EventCategory,
            priority: String(fd.get('priority') ?? 'normal') as EventPriority,
            status: String(fd.get('status') ?? 'pending') as AttendanceStatus,
            assigneeId: String(fd.get('assigneeId') ?? ''),
          });
          this.audio.playComplete();
          this.showToast('Đã lưu thay đổi cho ngày đám.');
        });
      });

    this.root
      .querySelectorAll<HTMLFormElement>(
        'form[data-action="save-contribution-edit"]'
      )
      .forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const id = form.dataset.id;
          if (!id) return;
          const fd = new FormData(form);
          const entryType =
            (String(fd.get('type') ?? 'income') as 'income' | 'expense') ||
            'income';
          const memberId = String(fd.get('memberId') ?? '');
          const typedName = String(fd.get('contributorName') ?? '').trim();
          const member = this.store.getMemberById(memberId);
          this.editingContributionId = null;
          this.store.updateContribution(id, {
            type: entryType,
            memberId,
            contributorName:
              typedName ||
              (entryType === 'expense'
                ? 'Khoản chi quỹ gia tộc'
                : member?.name || 'Thành viên gia đình'),
            dateISO: String(fd.get('dateISO') ?? ''),
            amount: Number(fd.get('amount') ?? 0),
            note: String(fd.get('note') ?? ''),
          });
          this.audio.playComplete();
          this.showToast('Đã lưu thay đổi khoản quỹ gia tộc.');
        });
      });

    this.root
      .querySelectorAll<HTMLFormElement>('form[data-action="save-member-edit"]')
      .forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const id = form.dataset.id;
          if (!id) return;
          const fd = new FormData(form);
          this.editingMemberId = null;
          this.store.updateMember(id, {
            name: String(fd.get('name') ?? ''),
            relation: String(fd.get('relation') ?? ''),
            branch: String(fd.get('branch') ?? 'gia_dinh') as FamilyBranch,
            phone: String(fd.get('phone') ?? ''),
            note: String(fd.get('note') ?? ''),
          });
          this.audio.playComplete();
          this.showToast('Đã lưu thông tin thành viên gia đình.');
        });
      });

    this.root
      .querySelectorAll<HTMLFormElement>('form[data-action="save-personal-tx-edit"]')
      .forEach((form) => {
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const id = form.dataset.id;
          if (!id) return;
          const fd = new FormData(form);
          this.editingPersonalTxId = null;
          this.store.updatePersonalTransaction(id, {
            title: String(fd.get('title') ?? ''),
            type: String(fd.get('type') ?? 'expense') as PersonalTransactionType,
            dateISO: String(fd.get('dateISO') ?? ''),
            amount: Number(fd.get('amount') ?? 0),
            note: String(fd.get('note') ?? ''),
          });
          this.audio.playComplete();
          this.showToast('Đã lưu thay đổi khoản quỹ cá nhân.');
        });
      });

    // --- Click Actions ---
    this.root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      const action = el.dataset.action;
      if (
        !action ||
        action === 'save-event-edit' ||
        action === 'save-fund-event-edit' ||
        action === 'save-contribution-edit' ||
        action === 'save-member-edit' ||
        action === 'save-personal-tx-edit'
      ) {
        return;
      }

      el.addEventListener('click', (e) => {
        if (el.tagName === 'A') e.preventDefault();

        switch (action) {
          case 'nav-page': {
            const page = el.dataset.page as AppPage;
            if (page) this.switchPage(page);
            break;
          }
          case 'trigger-reminder': {
            this.audio.playReminderBell();
            const rev = this.store.getDailyReviewHeadline();
            if (this.activePage !== 'calendar') {
              this.activePage = 'calendar';
              this.render();
            }
            const reminderEl = this.root.querySelector<HTMLElement>(
              '#upcoming-reminders-section'
            );
            reminderEl?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
            if (rev.focusEvent) {
              const days = getDaysUntil(rev.focusEvent.dateISO);
              const lunarStr = formatLunarShort(
                solarISOToLunar(rev.focusEvent.dateISO)
              );
              const dayText =
                days < 0
                  ? `Quá ${Math.abs(days)} ngày`
                  : days === 0
                    ? 'Hôm nay'
                    : days === 1
                      ? 'Ngày mai'
                      : `Còn ${days} ngày`;
              this.showToast(
                `Nhắc lịch (${dayText}): ${rev.focusEvent.title} · ${formatDateVN(rev.focusEvent.dateISO)} (${lunarStr}) · ${formatVND(rev.focusEvent.amount)}`
              );
            } else {
              this.showToast('Hôm nay không có ngày đám gần đến. Cả nhà yên tâm!');
            }
            break;
          }
          case 'set-reminder-window': {
            const days = Number(el.dataset.days ?? 14) as 3 | 7 | 14 | 30;
            if (![3, 7, 14, 30].includes(days)) return;
            this.reminderWindowDays = days;
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'dismiss-reminder': {
            const id = el.dataset.id;
            if (!id) return;
            this.dismissedReminderIds.add(id);
            this.audio.playTap(360);
            this.render();
            this.showToast('Đã ẩn thông báo nhắc cho ngày này.');
            break;
          }
          case 'restore-reminders': {
            this.dismissedReminderIds.clear();
            this.audio.playTap(500);
            this.render();
            this.showToast('Đã hiện lại toàn bộ thông báo nhắc ngày gần đến.');
            break;
          }
          case 'quick-attend-focus': {
            const id = el.dataset.id;
            if (!id) return;
            this.store.setEventStatus(id, 'attended');
            this.audio.playComplete();
            this.showToast('Đã đánh dấu "Đã đi" và cập nhật Quỹ cá nhân.');
            break;
          }
          case 'set-draft-cal-mode': {
            const mode = el.dataset.mode as CalendarMode;
            if (!mode || mode === this.draftCalendarMode) return;
            this.draftCalendarMode = mode;
            if (mode === 'lunar') {
              this.syncDraftLunarFromSolar(this.draftDateISO);
            }
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'set-edit-cal-mode': {
            const mode = el.dataset.mode as CalendarMode;
            if (!mode || mode === this.editEventCalendarMode) return;
            this.editEventCalendarMode = mode;
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'fund-delta': {
            const delta = Number(el.dataset.delta ?? 0);
            this.store.adjustFund(delta);
            this.audio.playTap(delta > 0 ? 540 : 380);
            this.showToast(
              delta > 0
                ? 'Đã bổ sung thêm 1.000.000 đ vào Quỹ gốc đầu năm.'
                : 'Đã giảm 1.000.000 đ trong Quỹ gốc đầu năm.'
            );
            break;
          }
          case 'toggle-edit-base-fund': {
            this.editingBaseFund = !this.editingBaseFund;
            this.render();
            if (this.editingBaseFund) {
              this.root.querySelector<HTMLInputElement>('#base-fund-input')?.focus();
            }
            break;
          }
          case 'select-template': {
            const cat = el.dataset.category as EventCategory;
            const tpl = QUICK_TITLE_TEMPLATES.find((t) => t.category === cat);
            if (!tpl) return;
            this.draftCategory = tpl.category;
            this.draftPriority = tpl.priority;
            this.draftAmount = tpl.defaultAmount;
            if (!this.draftTitle.trim()) this.draftTitle = tpl.title;
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'select-date-preset': {
            const iso = el.dataset.date;
            if (!iso) return;
            this.draftDateISO = iso;
            this.syncDraftLunarFromSolar(iso);
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'select-lunar-day-preset': {
            const day = Number(el.dataset.day ?? 1);
            this.draftLunarDay = day;
            this.draftCalendarMode = 'lunar';
            this.syncDraftSolarFromLunar();
            this.audio.playTap(500);
            this.render();
            break;
          }
          case 'select-amount-preset': {
            this.draftAmount = Number(el.dataset.amount ?? 0);
            this.audio.playTap(520);
            this.render();
            break;
          }
          case 'select-priority': {
            this.draftPriority = el.dataset.priority as EventPriority;
            this.audio.playTap(500);
            this.render();
            break;
          }
          case 'set-filter': {
            this.audio.playTap(460);
            this.store.setFilter(el.dataset.filter as FilterMode);
            break;
          }
          case 'reset-sample': {
            this.searchQuery = '';
            this.editingEventId = null;
            this.editingFundEventId = null;
            this.editingContributionId = null;
            this.editingMemberId = null;
            this.audio.playTap(400);
            this.store.resetSampleData();
            this.showToast('Đã khôi phục dữ liệu giỗ chạp, quỹ và gia đình mẫu.');
            break;
          }
          case 'toggle-priority': {
            const id = el.dataset.id;
            if (!id) return;
            this.audio.playTap(520);
            this.store.toggleEventPriority(id);
            break;
          }
          case 'toggle-attend': {
            const id = el.dataset.id;
            if (!id) return;
            const next = this.store.toggleEventStatus(id, 'attended');
            if (next === 'attended') {
              this.audio.playComplete();
              this.showToast('Đã đánh dấu "Đã đi".');
            } else {
              this.audio.playTap(400);
              this.showToast('Đã chuyển lại trạng thái sắp đi.');
            }
            break;
          }
          case 'toggle-skip': {
            const id = el.dataset.id;
            if (!id) return;
            const next = this.store.toggleEventStatus(id, 'skipped');
            this.audio.playTap(340);
            this.showToast(
              next === 'skipped'
                ? 'Đã đánh dấu "Không đi" (hoàn vào Quỹ cá nhân còn lại).'
                : 'Đã mở lại lịch đi đám.'
            );
            break;
          }
          case 'start-edit-event': {
            const id = el.dataset.id ?? null;
            const ev = this.store.getState().events.find((x) => x.id === id);
            this.editingEventId = id;
            this.editEventCalendarMode = ev?.calendarType ?? 'solar';
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'cancel-edit-event': {
            this.editingEventId = null;
            this.render();
            break;
          }
          case 'delete-event': {
            const id = el.dataset.id;
            if (!id) return;
            this.audio.playTap(280);
            this.store.deleteEvent(id);
            this.showToast('Đã xóa ngày đám khỏi sổ.');
            break;
          }
          // --- Personal Fund Page Actions ---
          case 'personal-fund-delta': {
            const delta = Number(el.dataset.delta ?? 0);
            this.store.adjustPersonalFund(delta);
            this.audio.playTap(delta > 0 ? 540 : 380);
            this.showToast(
              delta > 0
                ? 'Đã bổ sung thêm 500.000 đ vào Ngân sách cá nhân gốc.'
                : 'Đã giảm 500.000 đ trong Ngân sách cá nhân gốc.'
            );
            break;
          }
          case 'toggle-edit-personal-base': {
            this.editingPersonalBaseFund = !this.editingPersonalBaseFund;
            this.render();
            if (this.editingPersonalBaseFund) {
              this.root
                .querySelector<HTMLInputElement>('#personal-base-input')
                ?.focus();
            }
            break;
          }
          case 'select-personal-type': {
            const nextType = el.dataset.type as PersonalTransactionType;
            if (!nextType) return;
            this.draftPersonalType = nextType;
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'select-personal-amount': {
            this.draftPersonalAmount = Number(el.dataset.amount ?? 0);
            this.audio.playTap(520);
            this.render();
            break;
          }
          case 'set-personal-filter': {
            this.personalFilter =
              (el.dataset.filter as 'all' | PersonalTransactionType) ?? 'all';
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'start-edit-personal-tx': {
            this.editingPersonalTxId = el.dataset.id ?? null;
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'cancel-edit-personal-tx': {
            this.editingPersonalTxId = null;
            this.render();
            break;
          }
          case 'delete-personal-tx': {
            const id = el.dataset.id;
            if (!id) return;
            this.audio.playTap(280);
            this.store.deletePersonalTransaction(id);
            this.showToast('Đã xóa khoản thu chi khỏi quỹ cá nhân.');
            break;
          }
          // --- Fund Page Actions (Standalone Quỹ gia tộc) ---
          case 'select-contrib-type': {
            const nextType = el.dataset.type as 'income' | 'expense';
            if (!nextType) return;
            this.draftContribType = nextType;
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'set-clan-fund-filter': {
            this.clanFundFilter =
              (el.dataset.filter as 'all' | 'income' | 'expense') ?? 'all';
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'select-contrib-amount': {
            this.draftContribAmount = Number(el.dataset.amount ?? 0);
            this.audio.playTap(520);
            this.render();
            break;
          }
          case 'start-edit-contribution': {
            this.editingContributionId = el.dataset.id ?? null;
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'cancel-edit-contribution': {
            this.editingContributionId = null;
            this.render();
            break;
          }
          case 'delete-contribution': {
            const id = el.dataset.id;
            if (!id) return;
            this.audio.playTap(280);
            this.store.deleteContribution(id);
            this.showToast('Đã xóa khoản đóng góp khỏi quỹ gia tộc.');
            break;
          }
          case 'start-edit-fund-event': {
            const id = el.dataset.id ?? null;
            const ev = this.store.getState().events.find((x) => x.id === id);
            this.editingFundEventId = id;
            this.editEventCalendarMode = ev?.calendarType ?? 'solar';
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'cancel-fund-event-edit': {
            this.editingFundEventId = null;
            this.render();
            break;
          }
          // --- Family Page Actions ---
          case 'select-relation-preset': {
            this.draftMemberRelation = el.dataset.relation ?? 'Người thân';
            this.audio.playTap(480);
            this.render();
            break;
          }
          case 'set-branch-filter': {
            this.familyBranchFilter =
              (el.dataset.branch as 'all' | FamilyBranch) ?? 'all';
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'start-edit-member': {
            this.editingMemberId = el.dataset.id ?? null;
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'cancel-edit-member': {
            this.editingMemberId = null;
            this.render();
            break;
          }
          case 'delete-member': {
            const id = el.dataset.id;
            if (!id) return;
            this.audio.playTap(280);
            this.store.deleteMember(id);
            this.showToast('Đã xóa thành viên khỏi danh sách gia đình.');
            break;
          }
        }
      });
    });
  }
}
