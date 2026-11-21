export type AppPage = 'calendar' | 'personal' | 'fund' | 'family';

export type CalendarMode = 'solar' | 'lunar';

export type EventPriority = 'important' | 'normal';

export type EventCategory = 'gio' | 'dam_cuoi' | 'chap_ho' | 'khac';

export type AttendanceStatus = 'pending' | 'attended' | 'skipped';

export type UrgencyBand = 'urgent' | 'soon' | 'far' | 'past';

export type FilterMode = 'all' | 'upcoming' | 'important' | 'attended' | 'skipped';

export type FamilyBranch = 'gia_dinh' | 'ben_noi' | 'ben_ngoai' | 'chi_ho';

export interface FamilyEvent {
  id: string;
  title: string;
  /** Local Gregorian date formatted as YYYY-MM-DD */
  dateISO: string;
  /** Indicates whether user prefers tracking this event by lunar or solar date */
  calendarType?: CalendarMode;
  category: EventCategory;
  priority: EventPriority;
  /** Contribution / expense amount in VND */
  amount: number;
  status: AttendanceStatus;
  /** Optional assigned family member ID */
  assigneeId?: string;
}

export interface FundContribution {
  id: string;
  memberId?: string;
  contributorName: string;
  dateISO: string;
  amount: number;
  note: string;
}

export interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  branch: FamilyBranch;
  phone: string;
  note: string;
}

export type PersonalTransactionType = 'income' | 'expense';

export interface PersonalTransaction {
  id: string;
  type: PersonalTransactionType;
  title: string;
  dateISO: string;
  amount: number;
  note: string;
}

export interface PersonalFundSummary {
  baseBudget: number;
  totalIncome: number;
  totalAvailable: number;
  totalExpense: number;
  remaining: number;
  incomeCount: number;
  expenseCount: number;
}

export interface AppState {
  /** Base annual clan fund budget set by family */
  fundBudget: number;
  /** Base personal fund budget set by user */
  personalFundBudget: number;
  events: FamilyEvent[];
  contributions: FundContribution[];
  personalTransactions: PersonalTransaction[];
  members: FamilyMember[];
  filter: FilterMode;
  selectedEventId: string | null;
}

export interface FinancialSummary {
  /** Base budget set directly */
  baseFundBudget: number;
  /** Sum of member contributions */
  totalContributions: number;
  /** Total available fund = baseFundBudget + totalContributions */
  fundBudget: number;
  /** Planned + attended (excludes skipped events) */
  totalActiveAmount: number;
  /** Already attended events */
  totalSpent: number;
  /** Pending upcoming events */
  totalUpcomingAmount: number;
  /** Remaining fund = fundBudget - totalActiveAmount */
  remainingFund: number;
  /** Actual cash on hand = fundBudget - totalSpent */
  cashOnHand: number;
  attendedCount: number;
  skippedCount: number;
  pendingCount: number;
  urgentCount: number;
  todayCount: number;
}

export interface UrgencyVisual {
  band: UrgencyBand;
  label: string;
  colorHex: string;
  colorInt: number;
  surfaceBg: string;
  borderColor: string;
}

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  gio: 'Ngày giỗ',
  dam_cuoi: 'Đám hỷ',
  chap_ho: 'Chạp họ',
  khac: 'Việc đặc biệt',
};

export const PRIORITY_LABELS: Record<EventPriority, string> = {
  important: 'Quan trọng',
  normal: 'Bình thường',
};

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  pending: 'Sắp đi',
  attended: 'Đã đi',
  skipped: 'Không đi',
};

export const BRANCH_LABELS: Record<FamilyBranch, string> = {
  gia_dinh: 'Gia đình nhỏ',
  ben_noi: 'Bên Nội',
  ben_ngoai: 'Bên Ngoại',
  chi_ho: 'Chi họ',
};

export const RELATION_PRESETS = [
  'Bố',
  'Mẹ',
  'Vợ / Chồng',
  'Anh / Chị',
  'Em',
  'Bác / Chú / Cô',
  'Con / Cháu',
] as const;

export const AMOUNT_PRESETS = [300_000, 500_000, 1_000_000, 2_000_000] as const;

export const CONTRIBUTION_PRESETS = [
  500_000, 1_000_000, 2_000_000, 5_000_000,
] as const;

export const QUICK_TITLE_TEMPLATES: ReadonlyArray<{
  label: string;
  title: string;
  category: EventCategory;
  priority: EventPriority;
  defaultAmount: number;
}> = [
  {
    label: 'Ngày giỗ',
    title: 'Giỗ gia đình',
    category: 'gio',
    priority: 'important',
    defaultAmount: 1_000_000,
  },
  {
    label: 'Đám cưới',
    title: 'Đám cưới họ hàng',
    category: 'dam_cuoi',
    priority: 'normal',
    defaultAmount: 500_000,
  },
  {
    label: 'Chạp họ',
    title: 'Chạp tổ từ đường',
    category: 'chap_ho',
    priority: 'important',
    defaultAmount: 500_000,
  },
  {
    label: 'Việc riêng',
    title: 'Mừng thọ / Tân gia',
    category: 'khac',
    priority: 'normal',
    defaultAmount: 500_000,
  },
];
