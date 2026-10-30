/**
 * Расчёт всей статистики для дашборда, боковой панели и отчёта.
 *
 * Все функции чистые: на вход дневник и параметры, на выход простые объекты,
 * которые можно передать в webview через `postMessage`.
 *
 * @module
 */

import { Diary } from './Diary';
import { mergeIntervals, totalLength } from './intervals';
import { topK } from './MinHeap';
import { addDays, dayKey, MINUTE, parseDayKey, weekdayMonFirst } from './time';
import { DayRecord, Interval, StatsRange } from './types';

/** День считается «активным» для серии, если в нём не меньше минуты работы. */
export const ACTIVE_DAY_MS = MINUTE;

/** Сколько недель показывает тепловая карта (как на GitHub). */
export const HEATMAP_WEEKS = 53;

/** Подписи периодов. */
export const RANGE_LABELS: Record<StatsRange, string> = {
    today: 'Сегодня',
    week: '7 дней',
    month: '30 дней',
    all: 'Всё время',
};

/** Человекочитаемые названия частых языков. */
const LANGUAGE_NAMES: Record<string, string> = {
    typescript: 'TypeScript',
    typescriptreact: 'TSX',
    javascript: 'JavaScript',
    javascriptreact: 'JSX',
    python: 'Python',
    cpp: 'C++',
    c: 'C',
    csharp: 'C#',
    java: 'Java',
    kotlin: 'Kotlin',
    go: 'Go',
    rust: 'Rust',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    json: 'JSON',
    jsonc: 'JSON',
    markdown: 'Markdown',
    sql: 'SQL',
    shellscript: 'Shell',
    yaml: 'YAML',
    plaintext: 'Текст',
    vue: 'Vue',
    php: 'PHP',
    ruby: 'Ruby',
    swift: 'Swift',
};

/**
 * Красивое имя языка по идентификатору VS Code.
 *
 * @param id идентификатор языка, например `cpp`
 */
export function languageName(id: string): string {
    return LANGUAGE_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** Параметры расчёта. */
export interface StatsOptions {
    /** Текущий момент, мс. */
    now: number;
    /** Выбранный период. */
    range: StatsRange;
    /** Цель на день, мс. */
    dailyGoalMs: number;
    /** Минимальная длина сессии фокуса, мс. */
    focusSessionMs: number;
    /** Перерыв, который ещё не разрывает сессию, мс. */
    sessionGapMs: number;
    /** Текущая скорость печати, символов в минуту. */
    typingCpm: number;
    /** Стоит ли учёт на паузе. */
    paused: boolean;
}

/** Строка рейтинга: язык, файл или проект. */
export interface NamedValue {
    /** Отображаемое имя. */
    name: string;
    /** Время, мс. */
    ms: number;
    /** Доля от суммы, 0..1. */
    share: number;
    /** Дополнительная подпись (например, путь к файлу). */
    detail?: string;
}

/** Клетка тепловой карты. */
export interface HeatCell {
    /** День `YYYY-MM-DD`. */
    date: string;
    /** Время за день, мс. */
    ms: number;
    /** Уровень яркости 0..4 (0 — нет активности). */
    level: 0 | 1 | 2 | 3 | 4;
    /** День ещё не наступил. */
    future: boolean;
}

/** Серия дней подряд. */
export interface StreakInfo {
    /** Текущая серия. */
    current: number;
    /** Самая длинная серия за всё время. */
    longest: number;
    /** Был ли сегодня уже активный день. */
    activeToday: boolean;
}

/** Показатели фокуса. */
export interface FocusInfo {
    /** Доля времени, проведённого в длинных сессиях, 0..1. */
    share: number;
    /** Количество сессий фокуса. */
    focusSessions: number;
    /** Количество всех сессий. */
    totalSessions: number;
    /** Самая длинная сессия, мс. */
    longestSessionMs: number;
}

/** Все данные, нужные дашборду. */
export interface DashboardData {
    now: number;
    range: StatsRange;
    rangeLabel: string;
    paused: boolean;
    isEmpty: boolean;
    today: {
        ms: number;
        goalMs: number;
        goalShare: number;
        chars: number;
        /** Сессии за сегодня для временной шкалы. */
        sessions: Interval[];
    };
    period: {
        ms: number;
        days: number;
        activeDays: number;
        avgPerActiveDayMs: number;
        chars: number;
        /** Время по дням периода (для «Сегодня» — один день). */
        daily: { date: string; ms: number }[];
    };
    streak: StreakInfo;
    focus: FocusInfo;
    /** Порог сессии фокуса из настроек, мс. */
    focusSessionMs: number;
    heatmap: {
        weeks: HeatCell[][];
        months: { label: string; week: number }[];
        /** Границы уровней 1–3, мс. */
        thresholds: number[];
    };
    languages: NamedValue[];
    projects: NamedValue[];
    files: NamedValue[];
    /** Время по часам суток за период, мс. */
    hours: number[];
    typingCpm: number;
}

/**
 * Дни, входящие в период.
 *
 * @param diary дневник
 * @param range период
 * @param today ключ сегодняшнего дня
 * @returns ключи дней от старого к новому
 */
export function rangeDays(diary: Diary, range: StatsRange, today: string): string[] {
    if (range === 'all') {
        const keys = diary.dayKeys().filter((k) => k <= today);
        if (keys.length === 0) {
            return [today];
        }
        const result: string[] = [];
        for (let k = keys[0]; k <= today; k = addDays(k, 1)) {
            result.push(k);
        }
        return result;
    }
    const length = range === 'today' ? 1 : range === 'week' ? 7 : 30;
    const result: string[] = [];
    for (let i = length - 1; i >= 0; i--) {
        result.push(addDays(today, -i));
    }
    return result;
}

/**
 * Квантиль отсортированного массива с линейной интерполяцией.
 *
 * @param sorted значения по возрастанию
 * @param p уровень квантиля, 0..1
 */
export function quantile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    const pos = (sorted.length - 1) * p;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Считает текущую и самую длинную серии активных дней.
 *
 * Текущая серия не обрывается, если сегодня ещё не программировали:
 * она отсчитывается от вчерашнего дня, пока день не закончился.
 *
 * @param diary дневник
 * @param today ключ сегодняшнего дня
 */
export function computeStreak(diary: Diary, today: string): StreakInfo {
    const active = new Set(diary.dayKeys().filter((k) => k <= today && diary.dayTotal(k) >= ACTIVE_DAY_MS));
    const activeToday = active.has(today);

    let current = 0;
    for (let k = activeToday ? today : addDays(today, -1); active.has(k); k = addDays(k, -1)) {
        current++;
    }

    let longest = 0;
    let run = 0;
    let prev: string | undefined;
    for (const k of [...active].sort()) {
        run = prev !== undefined && addDays(prev, 1) === k ? run + 1 : 1;
        longest = Math.max(longest, run);
        prev = k;
    }
    return { current, longest, activeToday };
}

/**
 * Делит активность на сессии и считает долю времени в «сессиях фокуса».
 *
 * @param days записи дней периода
 * @param sessionGapMs допустимый перерыв внутри сессии
 * @param focusSessionMs минимальная длина сессии фокуса
 */
export function computeFocus(days: readonly DayRecord[], sessionGapMs: number, focusSessionMs: number): FocusInfo {
    let total = 0;
    let focused = 0;
    let focusSessions = 0;
    let totalSessions = 0;
    let longest = 0;
    for (const day of days) {
        for (const [start, end] of mergeIntervals(day.intervals, sessionGapMs)) {
            // Время сессии без перерывов внутри неё.
            const busy = totalLength(day.intervals.filter(([s, e]) => s >= start && e <= end));
            total += busy;
            totalSessions++;
            longest = Math.max(longest, busy);
            if (busy >= focusSessionMs) {
                focused += busy;
                focusSessions++;
            }
        }
    }
    return {
        share: total > 0 ? focused / total : 0,
        focusSessions,
        totalSessions,
        longestSessionMs: longest,
    };
}

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/**
 * Строит тепловую карту активности за последний год.
 *
 * Столбцы — недели (с понедельника), строки — дни недели.
 * Уровни цвета считаются по квартилям ненулевых дней, поэтому карта
 * выглядит осмысленно и у того, кто пишет по 20 минут в день, и у того,
 * кто пишет по 8 часов.
 *
 * @param diary дневник
 * @param today ключ сегодняшнего дня
 */
export function computeHeatmap(diary: Diary, today: string): DashboardData['heatmap'] {
    const firstMonday = addDays(today, -weekdayMonFirst(today) - (HEATMAP_WEEKS - 1) * 7);
    const values: number[] = [];
    const raw: { date: string; ms: number; future: boolean }[][] = [];
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
        const week: { date: string; ms: number; future: boolean }[] = [];
        for (let d = 0; d < 7; d++) {
            const date = addDays(firstMonday, w * 7 + d);
            const future = date > today;
            const ms = future ? 0 : diary.dayTotal(date);
            if (ms > 0) {
                values.push(ms);
            }
            week.push({ date, ms, future });
        }
        raw.push(week);
    }
    values.sort((a, b) => a - b);
    const thresholds = [quantile(values, 0.25), quantile(values, 0.5), quantile(values, 0.75)];
    const level = (ms: number): HeatCell['level'] => {
        if (ms <= 0) {
            return 0;
        }
        if (ms <= thresholds[0]) {
            return 1;
        }
        if (ms <= thresholds[1]) {
            return 2;
        }
        return ms <= thresholds[2] ? 3 : 4;
    };
    const weeks = raw.map((week) => week.map((c) => ({ ...c, level: level(c.ms) })));

    // Подпись месяца ставится над первой неделей, в которую попало 1-е число.
    const months: { label: string; week: number }[] = [];
    weeks.forEach((week, w) => {
        const first = week.find((c) => c.date.endsWith('-01'));
        if (first) {
            months.push({ label: MONTHS_SHORT[new Date(parseDayKey(first.date)).getMonth()], week: w });
        }
    });
    return { weeks, months, thresholds };
}

/**
 * Суммирует словари «имя → мс» нескольких дней и оставляет топ-`k`.
 * Всё, что не вошло в топ, при `withOther` собирается в строку «Другие».
 *
 * @param maps словари по дням
 * @param k размер топа
 * @param withOther добавлять ли строку «Другие»
 */
export function rankTotals(maps: readonly Record<string, number>[], k: number, withOther: boolean): NamedValue[] {
    const totals = new Map<string, number>();
    for (const map of maps) {
        for (const [name, ms] of Object.entries(map)) {
            totals.set(name, (totals.get(name) ?? 0) + ms);
        }
    }
    let sum = 0;
    for (const ms of totals.values()) {
        sum += ms;
    }
    const top = topK(totals.entries(), k);
    const result: NamedValue[] = top.map(([name, ms]) => ({ name, ms, share: sum > 0 ? ms / sum : 0 }));
    const rest = sum - top.reduce((acc, [, ms]) => acc + ms, 0);
    if (withOther && rest > 0) {
        result.push({ name: 'Другие', ms: rest, share: rest / sum });
    }
    return result;
}

/**
 * Главная функция модуля: собирает {@link DashboardData}.
 *
 * @param diary дневник (уже с учётом открытого сегмента)
 * @param options параметры расчёта
 */
export function computeDashboard(diary: Diary, options: StatsOptions): DashboardData {
    const today = dayKey(options.now);
    const keys = rangeDays(diary, options.range, today);
    const records = keys.map((k) => diary.getDay(k)).filter((d): d is DayRecord => d !== undefined);

    const daily = keys.map((date) => ({ date, ms: diary.dayTotal(date) }));
    const periodMs = daily.reduce((acc, d) => acc + d.ms, 0);
    const activeDays = daily.filter((d) => d.ms >= ACTIVE_DAY_MS).length;

    const hours = new Array<number>(24).fill(0);
    for (const day of records) {
        day.hours.forEach((ms, h) => (hours[h] += ms));
    }

    const languages = rankTotals(records.map((d) => d.languages), 6, true).map((v) =>
        v.name === 'Другие' ? v : { ...v, name: languageName(v.name) },
    );
    const files = rankTotals(records.map((d) => d.files), 7, false).map((v) => {
        const slash = v.name.indexOf('/');
        const project = v.name.slice(0, slash);
        const path = v.name.slice(slash + 1);
        return { ...v, name: path.split('/').pop() ?? path, detail: `${project} · ${path}` };
    });

    const todayRecord = diary.getDay(today);
    const todayMs = diary.dayTotal(today);

    return {
        now: options.now,
        range: options.range,
        rangeLabel: RANGE_LABELS[options.range],
        paused: options.paused,
        isEmpty: diary.isEmpty(),
        today: {
            ms: todayMs,
            goalMs: options.dailyGoalMs,
            goalShare: options.dailyGoalMs > 0 ? todayMs / options.dailyGoalMs : 0,
            chars: todayRecord?.chars ?? 0,
            sessions: todayRecord ? mergeIntervals(todayRecord.intervals, options.sessionGapMs) : [],
        },
        period: {
            ms: periodMs,
            days: keys.length,
            activeDays,
            avgPerActiveDayMs: activeDays > 0 ? periodMs / activeDays : 0,
            chars: records.reduce((acc, d) => acc + d.chars, 0),
            daily,
        },
        streak: computeStreak(diary, today),
        focus: computeFocus(records, options.sessionGapMs, options.focusSessionMs),
        focusSessionMs: options.focusSessionMs,
        heatmap: computeHeatmap(diary, today),
        languages,
        projects: rankTotals(records.map((d) => d.projects), 5, true),
        files,
        hours,
        typingCpm: options.typingCpm,
    };
}
