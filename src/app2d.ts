import {ChimeSynthesizer} from './audio/ChimeSynthesizer.ts';
import {
  FamilyLedgerStore,
  addDaysISO,
  formatCompactVND,
  formatDateVN,
  formatTodayHeaderVN,
  formatVND,
  getDaysUntil,
} from './store.ts';
import {
  AMOUNT_PRESETS,
  AppPage,
  AttendanceStatus,
  BRANCH_LABELS,
  CATEGORY_LABELS,
  CONTRIBUTION_PRESETS,
  EventCategory,
  EventPriority,
  FamilyBranch,
  FamilyEvent,
  FamilyMember,
  FilterMode,
  FundContribution,
  PRIORITY_LABELS,
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
 * 2D Vietnamese multi-page application controller for "Sổ Giỗ Chạp Gia Đình":
 * - Trang 1: Lịch đám (Nhắc việc hàng ngày, ghi nhanh, tick hoàn thành, chỉnh sửa)
 * - Trang 2: Quỹ đám (Ngân sách quỹ, đóng góp quỹ, bảng kê thu chi, chỉnh sửa)
 * - Trang 3: Gia đình (Danh sách thành viên gia đình / gia tộc, thêm & chỉnh sửa)
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
  private draftCategory: EventCategory = 'gio';
  private draftPriority: EventPriority = 'important';
  private draftAmount = 500_000;
  private draftAssigneeId = '';
  private searchQuery = '';
  private editingEventId: string | null = null;

  // --- Fund page draft & edit states ---
  private editingBaseFund = false;
  private draftContribMemberId = '';
  private draftContribName = '';
  private draftContribDateISO = addDaysISO(new Date(), 0);
  private draftContribAmount = 1_000_000;
  private draftContribNote = '';
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
    this.store.subscribe(() => this.render());
    this.render();
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
    }, 3200);
  }

  private switchPage(page: AppPage): void {
    if (this.activePage === page) return;
    this.activePage = page;
    this.editingEventId = null;
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
      {id: 'fund', label: 'Quỹ đám'},
      {id: 'family', label: 'Gia đình'},
    ];

    let pageHtml = '';
    if (this.activePage === 'calendar') {
      pageHtml = this.renderCalendarPage(now);
    } else if (this.activePage === 'fund') {
      pageHtml = this.renderFundPage(now);
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

        <!-- Mobile Thumb-Zone Bottom Tab Bar -->
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
            class="mobile-tab ${this.activePage === 'fund' ? 'is-active' : ''}"
            data-action="nav-page"
            data-page="fund"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <rect x="2" y="5" width="20" height="14" rx="2"></rect>
              <line x1="2" y1="10" x2="22" y2="10"></line>
            </svg>
            <span>Quỹ đám</span>
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
    const review = this.store.getDailyReviewHeadline();
    const visibleEvents = this.getFilteredEvents();

    const fundRatio =
      summary.fundBudget > 0
        ? Math.min(
            100,
            Math.round((summary.totalActiveAmount / summary.fundBudget) * 100)
          )
        : summary.totalActiveAmount > 0
          ? 100
          : 0;

    const counts: Record<FilterMode, number> = {
      all: state.events.length,
      upcoming: state.events.filter(
        (e) => e.status === 'pending' && getDaysUntil(e.dateISO, now) <= 14
      ).length,
      important: state.events.filter((e) => e.priority === 'important').length,
      attended: summary.attendedCount,
      skipped: summary.skippedCount,
    };

    const upcomingIn7 = state.events.filter(
      (e) => e.status === 'pending' && getDaysUntil(e.dateISO, now) <= 7
    );

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

    return `
      <!-- Daily Review Banner -->
      <section class="daily-banner severity-${review.severity}" aria-label="Thông báo ngày đám hôm nay">
        <div class="daily-banner-content">
          <div class="daily-kicker">
            ${escapeHtml(formatTodayHeaderVN(now))} · ${upcomingIn7.length} đám trong 7 ngày tới
          </div>
          <h1 class="daily-title">${escapeHtml(review.title)}</h1>
          <p class="daily-detail">${escapeHtml(review.detail)}</p>
        </div>
        <div class="daily-banner-actions">
          ${
            review.focusEvent
              ? `<button type="button" class="btn-attend-hero" data-action="quick-attend-focus" data-id="${review.focusEvent.id}">
                  Đánh dấu đã đi
                </button>`
              : ''
          }
        </div>
      </section>

      <!-- 4-Column Financial & Attendance Report Strip -->
      <section class="kpi-strip" aria-label="Báo cáo quỹ đám và lịch tham dự">
        <div class="kpi-cell">
          <div class="kpi-label-row">
            <span class="kpi-label">Tiền quỹ đám</span>
            <button type="button" class="btn-micro" data-action="nav-page" data-page="fund">Chi tiết quỹ</button>
          </div>
          <div class="kpi-value tabular">${escapeHtml(formatVND(summary.fundBudget))}</div>
          <div class="kpi-sub tabular">
            Quỹ gốc ${escapeHtml(formatCompactVND(summary.baseFundBudget))} · Đóng góp ${escapeHtml(formatCompactVND(summary.totalContributions))}
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng tiền đám</span>
          <div class="kpi-value tabular">${escapeHtml(formatVND(summary.totalActiveAmount))}</div>
          <div class="kpi-sub tabular">
            Đã đi ${escapeHtml(formatCompactVND(summary.totalSpent))} · Dự chi ${escapeHtml(formatCompactVND(summary.totalUpcomingAmount))}
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tiền quỹ còn lại</span>
          <div class="kpi-value tabular ${summary.remainingFund < 0 ? 'text-danger' : 'text-positive'}">
            ${escapeHtml(formatVND(summary.remainingFund))}
          </div>
          <div class="fund-meter" aria-hidden="true">
            <div class="fund-meter-fill ${summary.remainingFund < 0 ? 'is-over' : ''}" style="width: ${fundRatio}%"></div>
          </div>
          <div class="kpi-sub">
            ${summary.remainingFund >= 0 ? `Đã dùng ${fundRatio}% quỹ năm` : 'Đang vượt quỹ · Nên bổ sung thêm'}
          </div>
        </div>

        <div class="kpi-cell">
          <div class="kpi-label-row">
            <span class="kpi-label">Báo cáo đi / không đi</span>
            <button type="button" class="btn-micro" data-action="nav-page" data-page="family">${state.members.length} thành viên</button>
          </div>
          <div class="kpi-value tabular">${summary.attendedCount} đã đi · ${summary.skippedCount} không đi</div>
          <div class="kpi-sub tabular">
            ${summary.pendingCount} ngày sắp tới · ${summary.urgentCount} ngày gấp
          </div>
        </div>
      </section>

      <!-- Main 2-Column Workspace -->
      <div class="workspace-grid">
        <!-- Left Column: Quick Add Task -->
        <section class="panel-surface quick-add-panel" aria-label="Ghi nhanh ngày đám">
          <div class="panel-header">
            <h2 class="panel-title">Ghi nhanh ngày đám</h2>
            <span class="panel-hint">Chạm mẫu hoặc nhập tên</span>
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
              <label class="field-label" for="qa-date">Ngày diễn ra</label>
              <input
                id="qa-date"
                type="date"
                class="text-input tabular"
                value="${escapeHtml(this.draftDateISO)}"
              />
              <div class="button-row-wrap" role="group" aria-label="Chọn nhanh ngày">
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
              </div>
            </div>

            <div class="field-group">
              <label class="field-label" for="qa-amount">Tiền đám dự kiến (đồng)</label>
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
                placeholder="Tìm tên đám hoặc ngày..."
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

  private renderEventRow(ev: FamilyEvent, now: Date): string {
    const urgency = getRowUrgency(ev, now);
    const isAttended = ev.status === 'attended';
    const isSkipped = ev.status === 'skipped';
    const isEditing = this.editingEventId === ev.id;
    const assignee = this.store.getMemberById(ev.assigneeId);

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

    return `
      <form class="inline-edit-box" data-action="${formAction}" data-id="${ev.id}">
        <div class="inline-edit-title">Chỉnh sửa thông tin ngày đám</div>
        <div class="inline-edit-grid">
          <div class="field-group span-2">
            <label class="field-label">Tên ngày đám / ngày giỗ</label>
            <input type="text" name="title" class="text-input" value="${escapeHtml(ev.title)}" required maxlength="64" />
          </div>
          <div class="field-group">
            <label class="field-label">Ngày diễn ra</label>
            <input type="date" name="dateISO" class="text-input tabular" value="${escapeHtml(ev.dateISO)}" required />
          </div>
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
  // TRANG 2: QUỸ ĐÁM (FUND MANAGEMENT PAGE)
  // =========================================================================
  private renderFundPage(now: Date): string {
    const state = this.store.getState();
    const summary = this.store.computeSummary();
    const sortedEvents = this.store.getSortedEvents('all');
    const sortedContribs = [...state.contributions].sort((a, b) =>
      b.dateISO.localeCompare(a.dateISO)
    );

    const fundRatio =
      summary.fundBudget > 0
        ? Math.min(
            100,
            Math.round((summary.totalActiveAmount / summary.fundBudget) * 100)
          )
        : summary.totalActiveAmount > 0
          ? 100
          : 0;

    return `
      <section class="page-intro">
        <div>
          <h1 class="page-heading">Quản lý Tiền Quỹ Đám</h1>
          <p class="page-subheading">
            Theo dõi ngân sách quỹ đầu năm, ghi nhận đóng góp của thành viên và kiểm soát toàn bộ tiền đám đã đi, sắp tới.
          </p>
        </div>
      </section>

      <!-- 4-Column Fund KPI Strip -->
      <section class="kpi-strip" aria-label="Tổng quan tiền quỹ đám">
        <div class="kpi-cell">
          <div class="kpi-label-row">
            <span class="kpi-label">Quỹ gốc đầu năm</span>
            <div class="kpi-inline-tools">
              <button type="button" class="btn-micro" data-action="fund-delta" data-delta="-1000000">-1tr</button>
              <button type="button" class="btn-micro" data-action="fund-delta" data-delta="1000000">+1tr</button>
              <button type="button" class="btn-micro" data-action="toggle-edit-base-fund">${this.editingBaseFund ? 'Đóng' : 'Sửa'}</button>
            </div>
          </div>
          ${
            this.editingBaseFund
              ? `<form class="inline-fund-form" id="base-fund-edit-form">
                  <input type="number" id="base-fund-input" class="inline-num-input tabular" min="0" step="100000" value="${summary.baseFundBudget}" aria-label="Nhập số tiền quỹ gốc đầu năm" />
                  <button type="submit" class="btn-micro-save">Lưu</button>
                </form>`
              : `<div class="kpi-value tabular">${escapeHtml(formatVND(summary.baseFundBudget))}</div>`
          }
          <div class="kpi-sub">Ngân sách chuẩn bị ban đầu</div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng quỹ đám hiện có</span>
          <div class="kpi-value tabular text-positive">${escapeHtml(formatVND(summary.fundBudget))}</div>
          <div class="kpi-sub tabular">
            Gồm ${state.contributions.length} khoản đóng góp (${escapeHtml(formatVND(summary.totalContributions))})
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tổng tiền đám (Đã đi + Dự chi)</span>
          <div class="kpi-value tabular">${escapeHtml(formatVND(summary.totalActiveAmount))}</div>
          <div class="kpi-sub tabular">
            Đã chi ${escapeHtml(formatVND(summary.totalSpent))} · Dự chi ${escapeHtml(formatVND(summary.totalUpcomingAmount))}
          </div>
        </div>

        <div class="kpi-cell">
          <span class="kpi-label">Tiền quỹ còn lại (sau dự chi)</span>
          <div class="kpi-value tabular ${summary.remainingFund < 0 ? 'text-danger' : 'text-positive'}">
            ${escapeHtml(formatVND(summary.remainingFund))}
          </div>
          <div class="fund-meter" aria-hidden="true">
            <div class="fund-meter-fill ${summary.remainingFund < 0 ? 'is-over' : ''}" style="width: ${fundRatio}%"></div>
          </div>
          <div class="kpi-sub tabular">
            Thực tế đang cầm: ${escapeHtml(formatVND(summary.cashOnHand))}
          </div>
        </div>
      </section>

      <div class="workspace-grid">
        <!-- Left Column: Add Contribution to Fund -->
        <section class="panel-surface quick-add-panel" aria-label="Ghi nhận đóng góp quỹ đám">
          <div class="panel-header">
            <h2 class="panel-title">Thêm khoản đóng quỹ</h2>
            <span class="panel-hint">Tự cộng vào tổng quỹ</span>
          </div>

          <form id="add-contribution-form" class="quick-add-form" novalidate>
            <div class="field-group">
              <label class="field-label" for="ctb-member">Chọn thành viên trong gia đình</label>
              <select id="ctb-member" class="text-input">
                <option value="">-- Nhập tên người đóng bên dưới --</option>
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
              <label class="field-label" for="ctb-name">Tên người đóng góp</label>
              <input
                id="ctb-name"
                type="text"
                class="text-input"
                maxlength="56"
                placeholder="Ví dụ: Anh Tuấn, Cô Lan..."
                value="${escapeHtml(this.draftContribName)}"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-date">Ngày đóng góp</label>
              <input
                id="ctb-date"
                type="date"
                class="text-input tabular"
                value="${escapeHtml(this.draftContribDateISO)}"
              />
            </div>

            <div class="field-group">
              <label class="field-label" for="ctb-amount">Số tiền đóng góp (đồng)</label>
              <input
                id="ctb-amount"
                type="number"
                class="text-input tabular"
                min="0"
                step="100000"
                value="${this.draftContribAmount}"
              />
              <div class="button-row-wrap" role="group" aria-label="Chọn nhanh số tiền đóng quỹ">
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
                placeholder="Ví dụ: Đóng quỹ giỗ chạp năm nay"
                value="${escapeHtml(this.draftContribNote)}"
              />
            </div>

            <button type="submit" class="btn-submit-full">
              Ghi nhận đóng góp quỹ
            </button>
          </form>
        </section>

        <!-- Right Column: Contributions Ledger + Detailed Event Expenses -->
        <div class="stack-col">
          <section class="panel-surface" aria-label="Lịch sử đóng góp quỹ đám">
            <div class="panel-header">
              <h2 class="panel-title">Các khoản đóng góp vào quỹ (${sortedContribs.length})</h2>
              <span class="panel-hint tabular">Tổng thu: ${escapeHtml(formatVND(summary.totalContributions))}</span>
            </div>

            <div class="event-list">
              ${
                sortedContribs.length === 0
                  ? `<div class="empty-state">
                      <p class="empty-title">Chưa có khoản đóng góp nào.</p>
                      <p class="empty-sub">Hãy ghi nhận các khoản đóng quỹ của thành viên ở khung bên cạnh.</p>
                    </div>`
                  : sortedContribs.map((c) => this.renderContributionRow(c)).join('')
              }
            </div>
          </section>

          <section class="panel-surface" aria-label="Bảng kê tiền chi theo từng ngày đám">
            <div class="panel-header">
              <h2 class="panel-title">Chi tiết tiền từng ngày đám (${sortedEvents.length})</h2>
              <span class="panel-hint">Bấm "Sửa" để cập nhật nhanh số tiền hoặc trạng thái</span>
            </div>

            <div class="event-list">
              ${
                sortedEvents.length === 0
                  ? `<div class="empty-state">
                      <p class="empty-title">Chưa có ngày đám nào trong sổ.</p>
                    </div>`
                  : sortedEvents
                      .map((ev) => this.renderFundEventRow(ev, now))
                      .join('')
              }
            </div>
          </section>
        </div>
      </div>
    `;
  }

  private renderContributionRow(c: FundContribution): string {
    if (this.editingContributionId === c.id) {
      const members = this.store.getState().members;
      return `
        <form class="inline-edit-box" data-action="save-contribution-edit" data-id="${c.id}">
          <div class="inline-edit-title">Chỉnh sửa khoản đóng góp quỹ</div>
          <div class="inline-edit-grid">
            <div class="field-group">
              <label class="field-label">Thành viên liên kết</label>
              <select name="memberId" class="text-input">
                <option value="">-- Người đóng tự nhập --</option>
                ${members
                  .map(
                    (m) =>
                      `<option value="${m.id}" ${c.memberId === m.id ? 'selected' : ''}>${escapeHtml(m.name)} (${escapeHtml(m.relation)})</option>`
                  )
                  .join('')}
              </select>
            </div>
            <div class="field-group">
              <label class="field-label">Tên người đóng góp</label>
              <input type="text" name="contributorName" class="text-input" value="${escapeHtml(c.contributorName)}" required maxlength="56" />
            </div>
            <div class="field-group">
              <label class="field-label">Ngày đóng</label>
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
      <article class="event-row urgency-attended">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency urgency-text-attended">Đóng góp quỹ</span>
            <span aria-hidden="true">·</span>
            <span class="tabular">${escapeHtml(formatDateVN(c.dateISO))}</span>
            ${
              c.note
                ? `<span aria-hidden="true">·</span><span>${escapeHtml(c.note)}</span>`
                : ''
            }
          </div>
          <h3 class="event-title">${escapeHtml(c.contributorName)}</h3>
        </div>
        <div class="event-right">
          <span class="amount-display tabular text-positive">+${escapeHtml(formatVND(c.amount))}</span>
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

    return `
      <article class="event-row urgency-${urgency.cls}">
        <div class="event-main">
          <div class="event-meta-line">
            <span class="meta-urgency urgency-text-${urgency.cls}">${escapeHtml(STATUS_LABELS[ev.status])}</span>
            <span aria-hidden="true">·</span>
            <span class="tabular">${escapeHtml(formatDateVN(ev.dateISO))}</span>
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
  // TRANG 3: GIA ĐÌNH & GIA TỘC (FAMILY MEMBERS PAGE)
  // =========================================================================
  private renderFamilyPage(): string {
    const state = this.store.getState();
    const members = state.members;

    const smallFamilyCount = members.filter((m) => m.branch === 'gia_dinh').length;
    const extendedCount = members.length - smallFamilyCount;
    const totalMemberContribs = state.contributions.reduce(
      (acc, c) => acc + c.amount,
      0
    );

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
          <div class="kpi-sub">Đồng bộ trực tiếp với trang Quỹ đám</div>
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
      .filter((c) => c.memberId === m.id)
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
      const hay = `${ev.title} ${CATEGORY_LABELS[ev.category]} ${formatDateVN(ev.dateISO)} ${assignee?.name ?? ''}`.toLowerCase();
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
    const finalDate = dateInput?.value || this.draftDateISO;
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
      category: this.draftCategory,
      priority: this.draftPriority,
      amount: finalAmount,
      assigneeId,
    });

    this.draftTitle = '';
    this.draftDateISO = addDaysISO(new Date(), 0);
    this.draftAssigneeId = '';
    this.audio.playComplete();
    this.render();
    this.showToast(
      `Đã ghi nhanh "${finalTitle}" (${formatDateVN(finalDate)} · ${formatVND(finalAmount)})`
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
      member?.name ||
      'Thành viên gia đình';
    const dateISO = dateInput?.value || this.draftContribDateISO;
    const parsedAmt = Number((amountInput?.value ?? '').replace(/[^\d]/g, ''));
    const amount =
      Number.isFinite(parsedAmt) && parsedAmt >= 0 ? parsedAmt : this.draftContribAmount;
    const note = (noteInput?.value ?? this.draftContribNote).trim();

    this.store.addContribution({
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
      `Đã ghi đóng góp quỹ +${formatVND(amount)} từ ${contributorName}.`
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
    const branch = (branchSelect?.value as FamilyBranch) || this.draftMemberBranch;
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
        this.render();
      }
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
      if (member) {
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
          this.editingEventId = null;
          this.editingFundEventId = null;
          this.store.updateEvent(id, {
            title: String(fd.get('title') ?? ''),
            dateISO: String(fd.get('dateISO') ?? ''),
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
          const memberId = String(fd.get('memberId') ?? '');
          const typedName = String(fd.get('contributorName') ?? '').trim();
          const member = this.store.getMemberById(memberId);
          this.editingContributionId = null;
          this.store.updateContribution(id, {
            memberId,
            contributorName: typedName || member?.name || 'Thành viên gia đình',
            dateISO: String(fd.get('dateISO') ?? ''),
            amount: Number(fd.get('amount') ?? 0),
            note: String(fd.get('note') ?? ''),
          });
          this.audio.playComplete();
          this.showToast('Đã lưu thay đổi khoản đóng góp quỹ.');
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

    // --- Click Actions ---
    this.root.querySelectorAll<HTMLElement>('[data-action]').forEach((el) => {
      const action = el.dataset.action;
      if (
        !action ||
        action === 'save-event-edit' ||
        action === 'save-fund-event-edit' ||
        action === 'save-contribution-edit' ||
        action === 'save-member-edit'
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
            if (rev.focusEvent) {
              this.showToast(
                `Nhắc hôm nay: ${rev.focusEvent.title} (${formatDateVN(rev.focusEvent.dateISO)} · ${formatVND(rev.focusEvent.amount)})`
              );
            } else {
              this.showToast('Hôm nay không có ngày đám gấp. Cả nhà yên tâm!');
            }
            break;
          }
          case 'quick-attend-focus': {
            const id = el.dataset.id;
            if (!id) return;
            this.store.setEventStatus(id, 'attended');
            this.audio.playComplete();
            this.showToast('Đã đánh dấu "Đã đi" và cập nhật số tiền quỹ còn lại.');
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
            this.audio.playTap(480);
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
                ? 'Đã đánh dấu "Không đi" (hoàn vào tiền quỹ còn lại).'
                : 'Đã mở lại lịch đi đám.'
            );
            break;
          }
          case 'start-edit-event': {
            this.editingEventId = el.dataset.id ?? null;
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
            this.showToast('Đã xóa khoản đóng góp khỏi quỹ đám.');
            break;
          }
          case 'start-edit-fund-event': {
            this.editingFundEventId = el.dataset.id ?? null;
            this.audio.playTap(460);
            this.render();
            break;
          }
          case 'cancel-fund-event-edit': {
            this.editingFundEventId = null;
            this.render();
            break;
          }
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
