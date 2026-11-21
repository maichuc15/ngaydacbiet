/**
 * Vietnamese Lunar Calendar (Âm lịch Việt Nam, UTC+7) conversion utilities.
 * Based on Hồ Ngọc Đức's astronomical algorithm (Jean Meeus).
 */

export interface LunarDate {
  day: number;
  month: number;
  year: number;
  leap: boolean;
  jd: number;
}

const PI = Math.PI;
const VN_TZ = 7;

const CAN = [
  'Giáp',
  'Ất',
  'Bính',
  'Đinh',
  'Mậu',
  'Kỷ',
  'Canh',
  'Tân',
  'Nhâm',
  'Quý',
] as const;

const CHI = [
  'Tý',
  'Sửu',
  'Dần',
  'Mão',
  'Thìn',
  'Tỵ',
  'Ngọ',
  'Mùi',
  'Thân',
  'Dậu',
  'Tuất',
  'Hợi',
] as const;

function INT(d: number): number {
  return Math.floor(d);
}

/** Compute Julian day number from Gregorian date (dd, mm, yy). */
export function jdFromDate(dd: number, mm: number, yy: number): number {
  const a = INT((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd =
    dd +
    INT((153 * m + 2) / 5) +
    365 * y +
    INT(y / 4) -
    INT(y / 100) +
    INT(y / 400) -
    32045;
  if (jd < 2299161) {
    jd =
      dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
  }
  return jd;
}

/** Convert Julian day number to Gregorian date [dd, mm, yy]. */
export function jdToDate(jd: number): [number, number, number] {
  let a: number;
  let b: number;
  let c: number;
  if (jd > 2299160) {
    a = jd + 32044;
    b = INT((4 * a + 3) / 146097);
    c = a - INT((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = INT((4 * c + 3) / 1461);
  const e = c - INT((1461 * d) / 4);
  const m = INT((5 * e + 2) / 153);
  const day = e - INT((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * INT(m / 10);
  const year = b * 100 + d - 4800 + INT(m / 10);
  return [day, month, year];
}

/** Compute Julian day number of the k-th new moon after 1900-01-01. */
function getNewMoonDay(k: number, timeZone = VN_TZ): number {
  const T = k / 1236.85;
  const T2 = T * T;
  const T3 = T2 * T;
  const dr = PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 =
    (0.1734 - 0.000393 * T) * Math.sin(M * dr) +
    0.0021 * Math.sin(2 * dr * M);
  C1 -= 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 -= 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 += 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 -= 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 -= 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 += 0.001 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat: number;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  const JdNew = Jd1 + C1 - deltat;
  return INT(JdNew + 0.5 + timeZone / 24);
}

/** Compute solar longitude sector (0..11) at midnight of given Julian day. */
function getSunLongitude(jdn: number, timeZone = VN_TZ): number {
  const T = (jdn - 2451545.5 - timeZone / 24) / 36525;
  const T2 = T * T;
  const dr = PI / 180;
  const M = 357.5291 + 35999.0503 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.9146 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.00029 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - PI * 2 * INT(L / (PI * 2));
  return INT((L / PI) * 6);
}

/** Find the day that starts the lunar month 11 of a given year. */
function getLunarMonth11(yy: number, timeZone = VN_TZ): number {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = INT(off / 29.530588853);
  let nm = getNewMoonDay(k, timeZone);
  const sunLong = getSunLongitude(nm, timeZone);
  if (sunLong >= 9) {
    nm = getNewMoonDay(k - 1, timeZone);
  }
  return nm;
}

/** Find the index of the leap month after the month starting on day a11. */
function getLeapMonthOffset(a11: number, timeZone = VN_TZ): number {
  const k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let last = 0;
  let i = 1;
  let arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i, timeZone), timeZone);
  } while (arc !== last && i < 14);
  return i - 1;
}

/** Convert Gregorian date (dd, mm, yy) to Vietnamese Lunar date. */
export function solarToLunar(
  dd: number,
  mm: number,
  yy: number,
  timeZone = VN_TZ
): LunarDate {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = INT((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1, timeZone);
  if (monthStart > dayNumber) {
    monthStart = getNewMoonDay(k, timeZone);
  }
  let a11 = getLunarMonth11(yy, timeZone);
  let b11 = a11;
  let lunarYear: number;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1, timeZone);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1, timeZone);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = INT((monthStart - a11) / 29);
  let lunarLeap = false;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11, timeZone);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) {
        lunarLeap = true;
      }
    }
  }
  if (lunarMonth > 12) {
    lunarMonth -= 12;
  }
  if (lunarMonth >= 11 && diff < 4) {
    lunarYear -= 1;
  }
  return {
    day: lunarDay,
    month: lunarMonth,
    year: lunarYear,
    leap: lunarLeap,
    jd: dayNumber,
  };
}

/** Convert Vietnamese Lunar date to Gregorian [dd, mm, yy]. */
export function lunarToSolar(
  lunarDay: number,
  lunarMonth: number,
  lunarYear: number,
  lunarLeap = false,
  timeZone = VN_TZ
): [number, number, number] {
  let a11: number;
  let b11: number;
  if (lunarMonth < 11) {
    a11 = getLunarMonth11(lunarYear - 1, timeZone);
    b11 = getLunarMonth11(lunarYear, timeZone);
  } else {
    a11 = getLunarMonth11(lunarYear, timeZone);
    b11 = getLunarMonth11(lunarYear + 1, timeZone);
  }
  const k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
  let off = lunarMonth - 11;
  if (off < 0) {
    off += 12;
  }
  if (b11 - a11 > 365) {
    const leapOff = getLeapMonthOffset(a11, timeZone);
    let leapMonth = leapOff - 2;
    if (leapMonth < 0) {
      leapMonth += 12;
    }
    if (lunarLeap && lunarMonth !== leapMonth) {
      // Fallback gracefully to non-leap month if invalid leap requested
      lunarLeap = false;
    } else if (lunarLeap || off >= leapOff) {
      off += 1;
    }
  }
  const monthStart = getNewMoonDay(k + off, timeZone);
  const nextMonthStart = getNewMoonDay(k + off + 1, timeZone);
  const maxDaysInMonth = Math.max(29, nextMonthStart - monthStart);
  const clampedDay = Math.min(Math.max(1, lunarDay), maxDaysInMonth);
  return jdToDate(monthStart + clampedDay - 1);
}

/** Convert local YYYY-MM-DD solar string to LunarDate. */
export function solarISOToLunar(dateISO: string): LunarDate {
  const parts = dateISO.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    const now = new Date();
    return solarToLunar(now.getDate(), now.getMonth() + 1, now.getFullYear());
  }
  return solarToLunar(parts[2], parts[1], parts[0]);
}

/** Convert Vietnamese Lunar date directly to local YYYY-MM-DD solar string. */
export function lunarToSolarISO(
  day: number,
  month: number,
  year: number,
  leap = false
): string {
  const [dd, mm, yy] = lunarToSolar(day, month, year, leap);
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/** Return the leap month number (1..12) of a lunar year, or 0 if none. */
export function getLeapMonthOfYear(lunarYear: number): number {
  const a11Prev = getLunarMonth11(lunarYear - 1, VN_TZ);
  const a11Curr = getLunarMonth11(lunarYear, VN_TZ);
  if (a11Curr - a11Prev > 365) {
    const leapOff = getLeapMonthOffset(a11Prev, VN_TZ);
    let leapMonth = leapOff - 2;
    if (leapMonth <= 0) leapMonth += 12;
    if (leapMonth < 11) return leapMonth;
  }
  const a11Next = getLunarMonth11(lunarYear + 1, VN_TZ);
  if (a11Next - a11Curr > 365) {
    const leapOff = getLeapMonthOffset(a11Curr, VN_TZ);
    let leapMonth = leapOff - 2;
    if (leapMonth <= 0) leapMonth += 12;
    if (leapMonth >= 11) return leapMonth;
  }
  return 0;
}

/** Return Vietnamese Can Chi of a lunar year (e.g. "Bính Ngọ"). */
export function getCanChiYear(lunarYear: number): string {
  const can = CAN[(lunarYear + 6) % 10];
  const chi = CHI[(lunarYear + 8) % 12];
  return `${can} ${chi}`;
}

/** Return Vietnamese Can Chi of a lunar month (1..12) in a given lunar year. */
export function getCanChiMonth(lunarMonth: number, lunarYear: number): string {
  const canIdx = (lunarYear * 12 + lunarMonth + 3) % 10;
  const chiIdx = (lunarMonth + 1) % 12;
  return `${CAN[(canIdx + 10) % 10]} ${CHI[(chiIdx + 12) % 12]}`;
}

/** Return Vietnamese Can Chi of a day given its Julian Day number. */
export function getCanChiDay(jd: number): string {
  const can = CAN[(jd + 9) % 10];
  const chi = CHI[(jd + 1) % 12];
  return `${can} ${chi}`;
}

/** Return traditional Vietnamese lunar festival name if applicable. */
export function getLunarFestivalName(lunar: LunarDate): string | null {
  if (lunar.leap) return null;
  const key = `${lunar.day}/${lunar.month}`;
  switch (key) {
    case '1/1':
      return 'Tết Nguyên Đán';
    case '2/1':
      return 'Mùng 2 Tết';
    case '3/1':
      return 'Mùng 3 Tết';
    case '15/1':
      return 'Rằm tháng Giêng';
    case '3/3':
      return 'Tết Hàn Thực';
    case '10/3':
      return 'Giỗ Tổ Hùng Vương';
    case '15/4':
      return 'Lễ Phật Đản';
    case '5/5':
      return 'Tết Đoan Ngọ';
    case '15/7':
      return 'Lễ Vu Lan';
    case '15/8':
      return 'Tết Trung Thu';
    case '9/9':
      return 'Tết Trùng Cửu';
    case '10/10':
      return 'Tết Cơm Mới';
    case '23/12':
      return 'Ông Công Ông Táo';
    case '30/12':
      return 'Giao Thừa';
    default:
      return null;
  }
}

/** Compact cell label for monthly calendar grid (e.g. "1/7" or "15"). */
export function formatLunarCell(lunar: LunarDate): string {
  if (lunar.day === 1) {
    return `1/${lunar.month}${lunar.leap ? 'N' : ''}`;
  }
  return `${lunar.day}`;
}

/** Short Vietnamese lunar date label (e.g. "15/7 ÂL" or "15/4 nhuận ÂL"). */
export function formatLunarShort(lunar: LunarDate): string {
  const leapSuffix = lunar.leap ? ' nhuận' : '';
  return `${lunar.day}/${lunar.month}${leapSuffix} ÂL`;
}

/** Full readable Vietnamese lunar date (e.g. "Mùng 5 tháng 7 Âm lịch (năm Bính Ngọ)"). */
export function formatLunarFull(lunar: LunarDate): string {
  const dayLabel = lunar.day <= 10 ? `Mùng ${lunar.day}` : `Ngày ${lunar.day}`;
  const monthName =
    lunar.month === 1
      ? 'tháng Giêng'
      : lunar.month === 12
        ? 'tháng Chạp'
        : `tháng ${lunar.month}`;
  const leapSuffix = lunar.leap ? ' nhuận' : '';
  return `${dayLabel} ${monthName}${leapSuffix} Âm lịch · Năm ${getCanChiYear(lunar.year)}`;
}
