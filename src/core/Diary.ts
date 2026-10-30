/**
 * Дневник: агрегированная статистика по дням.
 *
 * @module
 */

import { insertInterval, totalLength } from './intervals';
import { dayKey, nextHourStart } from './time';
import { DayRecord, DiaryData, Interval, Segment } from './types';

/**
 * Создаёт пустую запись дня.
 *
 * @param date ключ дня `YYYY-MM-DD`
 */
export function emptyDay(date: string): DayRecord {
    return {
        date,
        intervals: [],
        languages: {},
        files: {},
        projects: {},
        hours: new Array<number>(24).fill(0),
        chars: 0,
    };
}

/**
 * Прибавляет значение к счётчику в словаре.
 *
 * @param map словарь «имя → мс»
 * @param key имя
 * @param value прибавка
 */
function addTo(map: Record<string, number>, key: string, value: number): void {
    map[key] = (map[key] ?? 0) + value;
}

/**
 * Дневник программирования.
 *
 * Внутри хеш-таблица `Map<дата, DayRecord>`: доступ к любому дню за O(1).
 * Сегменты от трекера раскладываются по дням и часам. Если сегмент
 * переходит через полночь, он делится на две части и каждая попадает в свой день.
 */
export class Diary {
    private readonly days = new Map<string, DayRecord>();

    /**
     * Восстанавливает дневник из JSON. Битые записи пропускаются,
     * поэтому повреждённый файл не ломает плагин целиком.
     *
     * @param data содержимое `diary.json` (уже разобранное)
     */
    static fromJSON(data: unknown): Diary {
        const diary = new Diary();
        if (!data || typeof data !== 'object' || !('days' in data)) {
            return diary;
        }
        const days = (data as { days: unknown }).days;
        if (!days || typeof days !== 'object') {
            return diary;
        }
        for (const [key, raw] of Object.entries(days as Record<string, unknown>)) {
            const day = Diary.sanitizeDay(key, raw);
            if (day) {
                diary.days.set(key, day);
            }
        }
        return diary;
    }

    /**
     * Проверяет и нормализует одну запись дня из файла.
     *
     * @param key ключ дня
     * @param raw необработанное значение
     * @returns корректная запись или `undefined`
     */
    private static sanitizeDay(key: string, raw: unknown): DayRecord | undefined {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !raw || typeof raw !== 'object') {
            return undefined;
        }
        const r = raw as Partial<DayRecord>;
        const day = emptyDay(key);
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
        const dict = (v: unknown) => {
            const out: Record<string, number> = {};
            if (v && typeof v === 'object') {
                for (const [k, val] of Object.entries(v)) {
                    if (num(val) > 0) {
                        out[k] = num(val);
                    }
                }
            }
            return out;
        };
        if (Array.isArray(r.intervals)) {
            for (const iv of r.intervals) {
                if (Array.isArray(iv) && iv.length === 2 && num(iv[0]) && num(iv[1]) >= num(iv[0])) {
                    day.intervals = insertInterval(day.intervals, [iv[0], iv[1]]);
                }
            }
        }
        day.languages = dict(r.languages);
        day.files = dict(r.files);
        day.projects = dict(r.projects);
        if (Array.isArray(r.hours) && r.hours.length === 24) {
            day.hours = r.hours.map(num);
        }
        day.chars = num(r.chars);
        return day;
    }

    /** Сериализует дневник в формат файла. */
    toJSON(): DiaryData {
        const days: Record<string, DayRecord> = {};
        for (const key of this.dayKeys()) {
            days[key] = this.days.get(key) as DayRecord;
        }
        return { version: 1, days };
    }

    /** Полная независимая копия дневника. */
    clone(): Diary {
        return Diary.fromJSON(JSON.parse(JSON.stringify(this.toJSON())));
    }

    /**
     * Добавляет завершённый сегмент работы.
     *
     * Сегмент режется по границам часов: каждый кусок попадает в свой час,
     * а значит и в свой день. Интервалы вставляются через {@link insertInterval},
     * так что пересечения (например, от двух окон VS Code) не удваивают время.
     *
     * @param segment сегмент от трекера
     */
    addSegment(segment: Segment): void {
        if (!(segment.end >= segment.start)) {
            return;
        }
        let cursor = segment.start;
        while (cursor < segment.end) {
            const pieceEnd = Math.min(nextHourStart(cursor), segment.end);
            const length = pieceEnd - cursor;
            const day = this.ensureDay(dayKey(cursor));
            const piece: Interval = [cursor, pieceEnd];

            day.intervals = insertInterval(day.intervals, piece);
            day.hours[new Date(cursor).getHours()] += length;
            addTo(day.languages, segment.language, length);
            addTo(day.files, `${segment.project}/${segment.file}`, length);
            addTo(day.projects, segment.project, length);

            cursor = pieceEnd;
        }
        if (segment.chars > 0) {
            this.ensureDay(dayKey(segment.end)).chars += segment.chars;
        }
    }

    /**
     * Запись дня или `undefined`, если в этот день активности не было.
     *
     * @param key ключ дня
     */
    getDay(key: string): DayRecord | undefined {
        return this.days.get(key);
    }

    /**
     * Суммарное время за день без двойного счёта, мс.
     *
     * @param key ключ дня
     */
    dayTotal(key: string): number {
        const day = this.days.get(key);
        return day ? totalLength(day.intervals) : 0;
    }

    /** Все дни с данными в хронологическом порядке. */
    dayKeys(): string[] {
        return [...this.days.keys()].sort();
    }

    /** `true`, если в дневнике нет ни одного дня. */
    isEmpty(): boolean {
        return this.days.size === 0;
    }

    /**
     * Возвращает запись дня, создавая пустую при необходимости.
     *
     * @param key ключ дня
     */
    private ensureDay(key: string): DayRecord {
        let day = this.days.get(key);
        if (!day) {
            day = emptyDay(key);
            this.days.set(key, day);
        }
        return day;
    }
}
