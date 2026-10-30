/**
 * Работа с датами и форматирование длительностей на русском языке.
 *
 * @module
 */

/** Миллисекунд в минуте. */
export const MINUTE = 60_000;
/** Миллисекунд в часе. */
export const HOUR = 60 * MINUTE;

/**
 * Возвращает ключ дня `YYYY-MM-DD` для момента времени в локальном часовом поясе.
 *
 * @param time момент времени, мс
 * @returns строка вида `2026-10-30`
 */
export function dayKey(time: number): string {
    const d = new Date(time);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Разбирает ключ дня обратно в момент полуночи этого дня.
 *
 * @param key строка `YYYY-MM-DD`
 * @returns полночь указанного дня, мс
 */
export function parseDayKey(key: string): number {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}

/**
 * Сдвигает день на `delta` календарных дней.
 * Работает через конструктор `Date`, поэтому корректно переживает переход на летнее время.
 *
 * @param key исходный день `YYYY-MM-DD`
 * @param delta на сколько дней сдвинуть (может быть отрицательным)
 * @returns новый ключ дня
 */
export function addDays(key: string, delta: number): string {
    const [y, m, d] = key.split('-').map(Number);
    return dayKey(new Date(y, m - 1, d + delta).getTime());
}

/**
 * Начало следующего часа после момента `time`.
 * Используется, чтобы резать сегменты по границам часов и дней.
 *
 * @param time момент времени, мс
 * @returns момент `HH+1:00:00.000`, мс
 */
export function nextHourStart(time: number): number {
    const d = new Date(time);
    d.setMinutes(60, 0, 0);
    return d.getTime();
}

/**
 * День недели с понедельника: 0 = понедельник, 6 = воскресенье.
 *
 * @param key день `YYYY-MM-DD`
 */
export function weekdayMonFirst(key: string): number {
    return (new Date(parseDayKey(key)).getDay() + 6) % 7;
}

/**
 * Выбирает форму русского слова для числа.
 *
 * @example plural(1, ['день', 'дня', 'дней']) // 'день'
 * @example plural(3, ['день', 'дня', 'дней']) // 'дня'
 * @example plural(11, ['день', 'дня', 'дней']) // 'дней'
 *
 * @param n число
 * @param forms формы для 1, 2–4 и 5+
 */
export function plural(n: number, forms: [string, string, string]): string {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) {
        return forms[0];
    }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
        return forms[1];
    }
    return forms[2];
}

/**
 * Форматирует длительность коротко: `2ч 14м`, `45м`, `<1м`.
 *
 * @param ms длительность, мс
 */
export function formatDuration(ms: number): string {
    const totalMinutes = Math.floor(ms / MINUTE);
    if (totalMinutes < 1) {
        return ms > 0 ? '<1м' : '0м';
    }
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) {
        return `${m}м`;
    }
    return m === 0 ? `${h}ч` : `${h}ч ${m}м`;
}

/**
 * Время суток `HH:MM` для момента.
 *
 * @param time момент, мс
 */
export function formatClock(time: number): string {
    const d = new Date(time);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Разбирает длительность, введённую человеком, и возвращает минуты.
 *
 * Поддерживаемые форматы: `90`, `1:30`, `1ч 30м`, `2ч`, `45м`, `1.5ч`, `2h 15m`.
 *
 * @param input строка пользователя
 * @returns количество минут или `undefined`, если строку не удалось разобрать
 */
export function parseDurationToMinutes(input: string): number | undefined {
    const s = input.trim().toLowerCase().replace(',', '.');
    if (s === '') {
        return undefined;
    }
    // Просто число — это минуты.
    if (/^\d+(\.\d+)?$/.test(s)) {
        return Math.round(Number(s));
    }
    // Формат часы:минуты.
    const clock = /^(\d+):([0-5]?\d)$/.exec(s);
    if (clock) {
        return Number(clock[1]) * 60 + Number(clock[2]);
    }
    // Формат с единицами: «1ч 30м», «1.5h», «45 мин».
    // Длинные варианты идут первыми, иначе «часа» совпадёт как «ч» + мусор.
    const re = /(\d+(?:\.\d+)?)\s*(часов|часа|час|ч|h|минуты|минут|мин|м|m)/g;
    let total = 0;
    let consumed = '';
    let match: RegExpExecArray | null;
    while ((match = re.exec(s)) !== null) {
        const value = Number(match[1]);
        total += /^(ч|h)/.test(match[2]) ? value * 60 : value;
        consumed += match[0];
    }
    // Если в строке остался «мусор», считаем ввод некорректным.
    if (consumed.replace(/\s/g, '') !== s.replace(/\s/g, '')) {
        return undefined;
    }
    return Math.round(total);
}
