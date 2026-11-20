import {
  AppState,
  AttendanceStatus,
  EventCategory,
  EventPriority,
  FamilyBranch,
  FamilyEvent,
  FamilyMember,
  FilterMode,
  FinancialSummary,
  FundContribution,
  UrgencyVisual,
} from './types.ts';

const STORAGE_KEY = 'so_gio_chap_gia_dinh_v2';
const LEGACY_STORAGE_KEY = 'so_gio_chap_gia_dinh_v1';
const DEFAULT_FUND_BUDGET = 6_000_000;

export function toLocalDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(baseDate: Date, offsetDays: number): string {
  const d = new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate() + offsetDays
  );
  return toLocalDateISO(d);
}

export function parseLocalDateISO(dateISO: string): Date {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y || 2026, (m || 1) - 1, d || 1);
}

export function formatDateVN(dateISO: string): string {
  const d = parseLocalDateISO(dateISO);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function formatShortDateVN(dateISO: string): string {
  const d = parseLocalDateISO(dateISO);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function formatTodayHeaderVN(now = new Date()): string {
  const weekdays = [
    'Chủ Nhật',
    'Thứ Hai',
    'Thứ Ba',
    'Thứ Tư',
    'Thứ Năm',
    'Thứ Sáu',
    'Thứ Bảy',
  ];
  const w = weekdays[now.getDay()];
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${w}, ${dd}/${mm}/${now.getFullYear()}`;
}

export function formatVND(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.round(amount));
  return `${sign}${abs.toLocaleString('vi-VN')} đ`;
}

export function formatCompactVND(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(Math.round(amount));
  if (abs >= 1_000_000) {
    const tr = abs / 1_000_000;
    const text = Number.isInteger(tr)
      ? `${tr}`
      : tr.toFixed(1).replace('.', ',');
    return `${sign}${text} tr`;
  }
  if (abs >= 1_000) {
    return `${sign}${Math.round(abs / 1_000)}k`;
  }
  return `${sign}${abs} đ`;
}

export function getDaysUntil(dateISO: string, now = new Date()): number {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = parseLocalDateISO(dateISO);
  const diffMs = target.getTime() - todayStart.getTime();
  return Math.round(diffMs / 86_400_000);
}

export function getDayOfYearFraction(dateISO: string): number {
  const d = parseLocalDateISO(dateISO);
  const start = new Date(d.getFullYear(), 0, 1);
  const diff = (d.getTime() - start.getTime()) / 86_400_000;
  return (((diff % 365) + 365) % 365) / 365;
}

export function getUrgencyVisual(
  event: FamilyEvent,
  now = new Date()
): UrgencyVisual {
  if (event.status === 'attended') {
    return {
      band: 'past',
      label: 'Đã đi',
      colorHex: '#4ade80',
      colorInt: 0x4ade80,
      surfaceBg: 'rgba(34, 92, 56, 0.34)',
      borderColor: 'rgba(74, 222, 128, 0.48)',
    };
  }
  if (event.status === 'skipped') {
    return {
      band: 'past',
      label: 'Không đi',
      colorHex: '#94a3b8',
      colorInt: 0x94a3b8,
      surfaceBg: 'rgba(71, 85, 105, 0.25)',
      borderColor: 'rgba(148, 163, 184, 0.34)',
    };
  }

  const days = getDaysUntil(event.dateISO, now);
  if (days < 0) {
    return {
      band: 'urgent',
      label: `Quá ${Math.abs(days)} ngày`,
      colorHex: '#f87171',
      colorInt: 0xf87171,
      surfaceBg: 'rgba(127, 29, 29, 0.38)',
      borderColor: 'rgba(248, 113, 113, 0.58)',
    };
  }
  if (days === 0) {
    return {
      band: 'urgent',
      label: 'HÔM NAY · Gấp',
      colorHex: '#ff6b6b',
      colorInt: 0xff5a5f,
      surfaceBg: 'rgba(153, 27, 27, 0.44)',
      borderColor: 'rgba(255, 107, 107, 0.75)',
    };
  }
  if (days <= 3) {
    return {
      band: 'urgent',
      label: `Còn ${days} ngày · Gấp`,
      colorHex: '#ff7b72',
      colorInt: 0xe5484d,
      surfaceBg: 'rgba(136, 32, 36, 0.38)',
      borderColor: 'rgba(248, 113, 113, 0.62)',
    };
  }
  if (days <= 14) {
    return {
      band: 'soon',
      label: `Còn ${days} ngày · Sắp tới`,
      colorHex: '#fbbf24',
      colorInt: 0xf5a524,
      surfaceBg: 'rgba(120, 74, 18, 0.34)',
      borderColor: 'rgba(251, 191, 36, 0.52)',
    };
  }
  return {
    band: 'far',
    label: `Còn ${days} ngày · Còn xa`,
    colorHex: '#34d399',
    colorInt: 0x38b787,
    surfaceBg: 'rgba(18, 72, 58, 0.30)',
    borderColor: 'rgba(52, 211, 153, 0.38)',
  };
}

function createInitialMembers(): FamilyMember[] {
  return [
    {
      id: 'mem_bo',
      name: 'Nguyễn Văn Minh',
      relation: 'Bố',
      branch: 'gia_dinh',
      phone: '0912 345 678',
      note: 'Giữ sổ lịch giỗ bên Nội & đại diện họp họ',
    },
    {
      id: 'mem_me',
      name: 'Trần Thị Hoa',
      relation: 'Mẹ',
      branch: 'gia_dinh',
      phone: '0913 456 789',
      note: 'Thủ quỹ đám gia đình, chuẩn bị lễ vật',
    },
    {
      id: 'mem_anh_ca',
      name: 'Nguyễn Minh Tuấn',
      relation: 'Anh cả',
      branch: 'gia_dinh',
      phone: '0988 234 567',
      note: 'Hỗ trợ đưa đón cả nhà về quê ngày giỗ',
    },
    {
      id: 'mem_bac_hai',
      name: 'Nguyễn Văn Hải',
      relation: 'Bác Hai',
      branch: 'ben_noi',
      phone: '0904 678 910',
      note: 'Trưởng chi họ Nguyễn · Nhà thờ họ',
    },
    {
      id: 'mem_cau_ut',
      name: 'Trần Quốc Dũng',
      relation: 'Cậu Út',
      branch: 'ben_ngoai',
      phone: '0977 890 123',
      note: 'Báo ngày giỗ chạp bên Ngoại',
    },
  ];
}

function createInitialContributions(now = new Date()): FundContribution[] {
  return [
    {
      id: 'ctb_1',
      memberId: 'mem_bo',
      contributorName: 'Nguyễn Văn Minh',
      dateISO: addDaysISO(now, -25),
      amount: 3_000_000,
      note: 'Đóng quỹ đám đầu năm',
    },
    {
      id: 'ctb_2',
      memberId: 'mem_me',
      contributorName: 'Trần Thị Hoa',
      dateISO: addDaysISO(now, -20),
      amount: 2_000_000,
      note: 'Góp quỹ giỗ chạp trong năm',
    },
    {
      id: 'ctb_3',
      memberId: 'mem_anh_ca',
      contributorName: 'Nguyễn Minh Tuấn',
      dateISO: addDaysISO(now, -10),
      amount: 1_500_000,
      note: 'Góp thêm cho giỗ Ông Nội & đám cuối năm',
    },
  ];
}

function createInitialEvents(now = new Date()): FamilyEvent[] {
  return [
    {
      id: 'ev_gio_ong_noi',
      title: 'Giỗ Ông Nội (Cỗ tại nhà bác cả)',
      dateISO: addDaysISO(now, 0),
      category: 'gio',
      priority: 'important',
      amount: 1_500_000,
      status: 'pending',
      assigneeId: 'mem_bo',
    },
    {
      id: 'ev_cuoi_chu_hung',
      title: 'Đám cưới con gái chú Hùng',
      dateISO: addDaysISO(now, 2),
      category: 'dam_cuoi',
      priority: 'important',
      amount: 1_000_000,
      status: 'pending',
      assigneeId: 'mem_anh_ca',
    },
    {
      id: 'ev_chap_ho',
      title: 'Chạp họ Nguyễn · Cúng từ đường',
      dateISO: addDaysISO(now, 9),
      category: 'chap_ho',
      priority: 'important',
      amount: 500_000,
      status: 'pending',
      assigneeId: 'mem_bac_hai',
    },
    {
      id: 'ev_thoi_noi_an',
      title: 'Đám thôi nôi bé An nhà anh Minh',
      dateISO: addDaysISO(now, 22),
      category: 'khac',
      priority: 'normal',
      amount: 500_000,
      status: 'pending',
      assigneeId: 'mem_me',
    },
    {
      id: 'ev_gio_ba_ngoai',
      title: 'Giỗ Bà Ngoại (Về quê sáng sớm)',
      dateISO: addDaysISO(now, 48),
      category: 'gio',
      priority: 'important',
      amount: 1_000_000,
      status: 'pending',
      assigneeId: 'mem_cau_ut',
    },
    {
      id: 'ev_mung_tho_bac',
      title: 'Mừng thọ 80 tuổi Bác Hai',
      dateISO: addDaysISO(now, -6),
      category: 'khac',
      priority: 'important',
      amount: 1_000_000,
      status: 'attended',
      assigneeId: 'mem_bo',
    },
    {
      id: 'ev_tan_gia_co_lan',
      title: 'Tân gia nhà cô Lan (Đi công tác)',
      dateISO: addDaysISO(now, -14),
      category: 'khac',
      priority: 'normal',
      amount: 500_000,
      status: 'skipped',
      assigneeId: 'mem_anh_ca',
    },
  ];
}

type Listener = (state: AppState) => void;

export class FamilyLedgerStore {
  private state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = this.loadState();
  }

  private loadState(): AppState {
    try {
      const raw =
        window.localStorage.getItem(STORAGE_KEY) ||
        window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppState>;
        if (
          typeof parsed.fundBudget === 'number' &&
          Array.isArray(parsed.events)
        ) {
          return {
            fundBudget: Math.max(0, parsed.fundBudget),
            events: parsed.events,
            contributions: Array.isArray(parsed.contributions)
              ? parsed.contributions
              : createInitialContributions(),
            members: Array.isArray(parsed.members)
              ? parsed.members
              : createInitialMembers(),
            filter: parsed.filter ?? 'all',
            selectedEventId: parsed.selectedEventId ?? null,
          };
        }
      }
    } catch {
      // Ignore storage errors in sandboxed contexts.
    }
    return {
      fundBudget: DEFAULT_FUND_BUDGET,
      events: createInitialEvents(),
      contributions: createInitialContributions(),
      members: createInitialMembers(),
      filter: 'all',
      selectedEventId: 'ev_gio_ong_noi',
    };
  }

  private saveState(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Ignore quota / storage errors.
    }
  }

  private emit(): void {
    this.saveState();
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): AppState {
    return this.state;
  }

  setFilter(filter: FilterMode): void {
    if (this.state.filter === filter) return;
    this.state = {...this.state, filter};
    this.emit();
  }

  selectEvent(id: string | null): void {
    this.state = {...this.state, selectedEventId: id};
    this.emit();
  }

  // --- Base Fund Budget ---
  adjustFund(delta: number): void {
    const next = Math.max(0, this.state.fundBudget + delta);
    this.state = {...this.state, fundBudget: next};
    this.emit();
  }

  setFundBudget(amount: number): void {
    const clean = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
    this.state = {...this.state, fundBudget: clean};
    this.emit();
  }

  // --- Events CRUD ---
  addEvent(input: {
    title: string;
    dateISO: string;
    category: EventCategory;
    priority: EventPriority;
    amount: number;
    assigneeId?: string;
  }): FamilyEvent {
    const cleanTitle = input.title.trim() || 'Ngày đám gia đình';
    const newEvent: FamilyEvent = {
      id: `ev_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      title: cleanTitle,
      dateISO: input.dateISO,
      category: input.category,
      priority: input.priority,
      amount: Math.max(0, Math.round(input.amount)),
      status: 'pending',
      assigneeId: input.assigneeId || undefined,
    };
    this.state = {
      ...this.state,
      events: [newEvent, ...this.state.events],
      selectedEventId: newEvent.id,
      filter: 'all',
    };
    this.emit();
    return newEvent;
  }

  updateEvent(
    id: string,
    patch: {
      title?: string;
      dateISO?: string;
      category?: EventCategory;
      priority?: EventPriority;
      amount?: number;
      status?: AttendanceStatus;
      assigneeId?: string;
    }
  ): void {
    const events = this.state.events.map((ev) => {
      if (ev.id !== id) return ev;
      return {
        ...ev,
        title: patch.title !== undefined ? patch.title.trim() || ev.title : ev.title,
        dateISO: patch.dateISO ?? ev.dateISO,
        category: patch.category ?? ev.category,
        priority: patch.priority ?? ev.priority,
        amount:
          patch.amount !== undefined && Number.isFinite(patch.amount)
            ? Math.max(0, Math.round(patch.amount))
            : ev.amount,
        status: patch.status ?? ev.status,
        assigneeId:
          patch.assigneeId !== undefined
            ? patch.assigneeId || undefined
            : ev.assigneeId,
      };
    });
    this.state = {...this.state, events, selectedEventId: id};
    this.emit();
  }

  setEventAmount(id: string, amount: number): void {
    this.updateEvent(id, {amount});
  }

  setEventStatus(id: string, status: AttendanceStatus): void {
    this.updateEvent(id, {status});
  }

  toggleEventStatus(
    id: string,
    target: 'attended' | 'skipped'
  ): AttendanceStatus {
    let nextStatus: AttendanceStatus = target;
    const events = this.state.events.map((ev) => {
      if (ev.id !== id) return ev;
      nextStatus = ev.status === target ? 'pending' : target;
      return {...ev, status: nextStatus};
    });
    this.state = {...this.state, events, selectedEventId: id};
    this.emit();
    return nextStatus;
  }

  toggleEventPriority(id: string): void {
    const events = this.state.events.map((ev) =>
      ev.id === id
        ? {
            ...ev,
            priority:
              ev.priority === 'important'
                ? ('normal' as const)
                : ('important' as const),
          }
        : ev
    );
    this.state = {...this.state, events, selectedEventId: id};
    this.emit();
  }

  deleteEvent(id: string): void {
    const events = this.state.events.filter((ev) => ev.id !== id);
    const selectedEventId =
      this.state.selectedEventId === id
        ? (events[0]?.id ?? null)
        : this.state.selectedEventId;
    this.state = {...this.state, events, selectedEventId};
    this.emit();
  }

  // --- Fund Contributions CRUD ---
  addContribution(input: {
    memberId?: string;
    contributorName: string;
    dateISO: string;
    amount: number;
    note: string;
  }): FundContribution {
    const cleanName = input.contributorName.trim() || 'Thành viên gia đình';
    const item: FundContribution = {
      id: `ctb_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      memberId: input.memberId || undefined,
      contributorName: cleanName,
      dateISO: input.dateISO,
      amount: Math.max(0, Math.round(input.amount)),
      note: input.note.trim(),
    };
    this.state = {
      ...this.state,
      contributions: [item, ...this.state.contributions],
    };
    this.emit();
    return item;
  }

  updateContribution(
    id: string,
    patch: {
      memberId?: string;
      contributorName?: string;
      dateISO?: string;
      amount?: number;
      note?: string;
    }
  ): void {
    const contributions = this.state.contributions.map((c) => {
      if (c.id !== id) return c;
      return {
        ...c,
        memberId:
          patch.memberId !== undefined ? patch.memberId || undefined : c.memberId,
        contributorName:
          patch.contributorName !== undefined
            ? patch.contributorName.trim() || c.contributorName
            : c.contributorName,
        dateISO: patch.dateISO ?? c.dateISO,
        amount:
          patch.amount !== undefined && Number.isFinite(patch.amount)
            ? Math.max(0, Math.round(patch.amount))
            : c.amount,
        note: patch.note !== undefined ? patch.note.trim() : c.note,
      };
    });
    this.state = {...this.state, contributions};
    this.emit();
  }

  deleteContribution(id: string): void {
    const contributions = this.state.contributions.filter((c) => c.id !== id);
    this.state = {...this.state, contributions};
    this.emit();
  }

  // --- Family Members CRUD ---
  addMember(input: {
    name: string;
    relation: string;
    branch: FamilyBranch;
    phone: string;
    note: string;
  }): FamilyMember {
    const item: FamilyMember = {
      id: `mem_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: input.name.trim() || 'Thành viên mới',
      relation: input.relation.trim() || 'Người thân',
      branch: input.branch,
      phone: input.phone.trim(),
      note: input.note.trim(),
    };
    this.state = {
      ...this.state,
      members: [...this.state.members, item],
    };
    this.emit();
    return item;
  }

  updateMember(
    id: string,
    patch: {
      name?: string;
      relation?: string;
      branch?: FamilyBranch;
      phone?: string;
      note?: string;
    }
  ): void {
    let updatedName: string | undefined;
    const members = this.state.members.map((m) => {
      if (m.id !== id) return m;
      updatedName = patch.name !== undefined ? patch.name.trim() || m.name : m.name;
      return {
        ...m,
        name: updatedName,
        relation:
          patch.relation !== undefined
            ? patch.relation.trim() || m.relation
            : m.relation,
        branch: patch.branch ?? m.branch,
        phone: patch.phone !== undefined ? patch.phone.trim() : m.phone,
        note: patch.note !== undefined ? patch.note.trim() : m.note,
      };
    });

    // Keep contributor names in sync when member name is updated
    const contributions = updatedName
      ? this.state.contributions.map((c) =>
          c.memberId === id ? {...c, contributorName: updatedName!} : c
        )
      : this.state.contributions;

    this.state = {...this.state, members, contributions};
    this.emit();
  }

  deleteMember(id: string): void {
    const members = this.state.members.filter((m) => m.id !== id);
    const events = this.state.events.map((ev) =>
      ev.assigneeId === id ? {...ev, assigneeId: undefined} : ev
    );
    const contributions = this.state.contributions.map((c) =>
      c.memberId === id ? {...c, memberId: undefined} : c
    );
    this.state = {...this.state, members, events, contributions};
    this.emit();
  }

  getMemberById(id?: string): FamilyMember | undefined {
    if (!id) return undefined;
    return this.state.members.find((m) => m.id === id);
  }

  resetSampleData(): void {
    this.state = {
      fundBudget: DEFAULT_FUND_BUDGET,
      events: createInitialEvents(),
      contributions: createInitialContributions(),
      members: createInitialMembers(),
      filter: 'all',
      selectedEventId: 'ev_gio_ong_noi',
    };
    this.emit();
  }

  getSortedEvents(filter: FilterMode = this.state.filter): FamilyEvent[] {
    const now = new Date();
    const filtered = this.state.events.filter((ev) => {
      if (filter === 'all') return true;
      if (filter === 'upcoming') {
        return ev.status === 'pending' && getDaysUntil(ev.dateISO, now) <= 14;
      }
      if (filter === 'important') return ev.priority === 'important';
      if (filter === 'attended') return ev.status === 'attended';
      if (filter === 'skipped') return ev.status === 'skipped';
      return true;
    });

    return [...filtered].sort((a, b) => {
      const rank = (s: AttendanceStatus) =>
        s === 'pending' ? 0 : s === 'attended' ? 1 : 2;
      const rDiff = rank(a.status) - rank(b.status);
      if (rDiff !== 0) return rDiff;
      const dA = getDaysUntil(a.dateISO, now);
      const dB = getDaysUntil(b.dateISO, now);
      if (a.status === 'pending') return dA - dB;
      return dB - dA;
    });
  }

  computeSummary(): FinancialSummary {
    const now = new Date();
    let totalSpent = 0;
    let totalUpcomingAmount = 0;
    let attendedCount = 0;
    let skippedCount = 0;
    let pendingCount = 0;
    let urgentCount = 0;
    let todayCount = 0;

    for (const ev of this.state.events) {
      if (ev.status === 'attended') {
        attendedCount += 1;
        totalSpent += ev.amount;
      } else if (ev.status === 'skipped') {
        skippedCount += 1;
      } else {
        pendingCount += 1;
        totalUpcomingAmount += ev.amount;
        const days = getDaysUntil(ev.dateISO, now);
        if (days === 0) todayCount += 1;
        if (days <= 3) urgentCount += 1;
      }
    }

    const totalContributions = this.state.contributions.reduce(
      (acc, c) => acc + c.amount,
      0
    );
    const baseFundBudget = this.state.fundBudget;
    const fundBudget = baseFundBudget + totalContributions;
    const totalActiveAmount = totalSpent + totalUpcomingAmount;
    const remainingFund = fundBudget - totalActiveAmount;
    const cashOnHand = fundBudget - totalSpent;

    return {
      baseFundBudget,
      totalContributions,
      fundBudget,
      totalActiveAmount,
      totalSpent,
      totalUpcomingAmount,
      remainingFund,
      cashOnHand,
      attendedCount,
      skippedCount,
      pendingCount,
      urgentCount,
      todayCount,
    };
  }

  getDailyReviewHeadline(): {
    severity: 'urgent' | 'soon' | 'calm';
    title: string;
    detail: string;
    focusEvent: FamilyEvent | null;
  } {
    const now = new Date();
    const pending = this.state.events
      .filter((e) => e.status === 'pending')
      .sort((a, b) => getDaysUntil(a.dateISO, now) - getDaysUntil(b.dateISO, now));

    if (pending.length === 0) {
      return {
        severity: 'calm',
        title: 'Hôm nay thảnh thơi · Không có đám sắp tới',
        detail: 'Tất cả các ngày giỗ chạp trong sổ đã được xử lý gọn gàng.',
        focusEvent: null,
      };
    }

    const next = pending[0];
    const days = getDaysUntil(next.dateISO, now);
    const inWeek = pending.filter((e) => getDaysUntil(e.dateISO, now) <= 7).length;
    const assignee = this.getMemberById(next.assigneeId);
    const assigneeNote = assignee ? ` · Đại diện: ${assignee.name}` : '';

    if (days <= 0) {
      return {
        severity: 'urgent',
        title:
          days === 0
            ? `NHẮC HÔM NAY: ${next.title}`
            : `QUÁ HẸN ${Math.abs(days)} NGÀY: ${next.title}`,
        detail: `Dự chi ${formatVND(next.amount)} · ${next.priority === 'important' ? 'Quan trọng' : 'Bình thường'}${assigneeNote} · Còn ${inWeek} đám trong 7 ngày tới`,
        focusEvent: next,
      };
    }
    if (days <= 3) {
      return {
        severity: 'urgent',
        title: `SẮP ĐẾN (Còn ${days} ngày): ${next.title}`,
        detail: `Ngày ${formatDateVN(next.dateISO)} · Dự chi ${formatVND(next.amount)}${assigneeNote} · Sắp xếp công việc sớm nhé!`,
        focusEvent: next,
      };
    }
    if (days <= 14) {
      return {
        severity: 'soon',
        title: `Sắp tới (Còn ${days} ngày): ${next.title}`,
        detail: `Ngày ${formatDateVN(next.dateISO)} · Dự chi ${formatVND(next.amount)}${assigneeNote} · Tổng ${pending.length} đám chưa đi trong năm`,
        focusEvent: next,
      };
    }
    return {
      severity: 'calm',
      title: `Kế tiếp (Còn ${days} ngày): ${next.title}`,
      detail: `Ngày ${formatDateVN(next.dateISO)} · Dự chi ${formatVND(next.amount)}${assigneeNote} · Còn rộng thời gian chuẩn bị`,
      focusEvent: next,
    };
  }
}
