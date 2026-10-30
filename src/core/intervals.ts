/**
 * Алгоритмы над интервалами времени.
 *
 * Активность за день хранится как отсортированный список непересекающихся
 * интервалов. Это гарантирует, что одно и то же время не будет засчитано дважды,
 * например когда открыто два окна VS Code и оба пишут в дневник.
 *
 * @module
 */

import { Interval } from './types';

/**
 * Склеивает пересекающиеся (и близкие) интервалы.
 *
 * Классический алгоритм: сортируем по началу, затем идём слева направо
 * и либо расширяем последний интервал результата, либо начинаем новый.
 * Сложность O(n log n) из-за сортировки.
 *
 * @example mergeIntervals([[1, 3], [2, 6], [8, 10]]) // [[1, 6], [8, 10]]
 * @example mergeIntervals([[0, 10], [15, 20]], 5)    // [[0, 20]]
 *
 * @param intervals интервалы в произвольном порядке
 * @param gap интервалы, между которыми разрыв не больше `gap`, тоже склеиваются
 *            (так из отдельных отрезков получаются «сессии»)
 * @returns новый отсортированный список без пересечений
 */
export function mergeIntervals(intervals: readonly Interval[], gap = 0): Interval[] {
    if (intervals.length === 0) {
        return [];
    }
    const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
    const result: Interval[] = [[sorted[0][0], sorted[0][1]]];
    for (let i = 1; i < sorted.length; i++) {
        const last = result[result.length - 1];
        const [start, end] = sorted[i];
        if (start <= last[1] + gap) {
            last[1] = Math.max(last[1], end);
        } else {
            result.push([start, end]);
        }
    }
    return result;
}

/**
 * Находит бинарным поиском первую позицию, где интервал заканчивается не раньше `time`.
 *
 * @param list отсортированные непересекающиеся интервалы
 * @param time момент времени
 * @returns индекс в диапазоне `[0, list.length]`
 */
export function lowerBoundByEnd(list: readonly Interval[], time: number): number {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (list[mid][1] < time) {
            lo = mid + 1;
        } else {
            hi = mid;
        }
    }
    return lo;
}

/**
 * Вставляет интервал в отсортированный список непересекающихся интервалов,
 * склеивая его с соседями при пересечении или касании.
 *
 * Бинарный поиск находит место вставки за O(log n), а дальше поглощаются
 * только реально пересекающиеся соседи. Исходный массив не меняется.
 *
 * @example insertInterval([[1, 2], [5, 9]], [2, 5]) // [[1, 9]]
 *
 * @param list отсортированные непересекающиеся интервалы
 * @param interval новый интервал
 * @returns новый список
 */
export function insertInterval(list: readonly Interval[], interval: Interval): Interval[] {
    let [start, end] = interval;
    if (end < start) {
        return list.map((iv) => [iv[0], iv[1]] as Interval);
    }
    const i = lowerBoundByEnd(list, start);
    let j = i;
    while (j < list.length && list[j][0] <= end) {
        start = Math.min(start, list[j][0]);
        end = Math.max(end, list[j][1]);
        j++;
    }
    const before = list.slice(0, i).map((iv) => [iv[0], iv[1]] as Interval);
    const after = list.slice(j).map((iv) => [iv[0], iv[1]] as Interval);
    return [...before, [start, end], ...after];
}

/**
 * Суммарная длина интервалов.
 *
 * @param intervals непересекающиеся интервалы
 * @returns сумма `end - start`, мс
 */
export function totalLength(intervals: readonly Interval[]): number {
    let sum = 0;
    for (const [start, end] of intervals) {
        sum += end - start;
    }
    return sum;
}

/**
 * Обрезает интервалы окном `[from, to)` и отбрасывает пустые.
 *
 * @param intervals интервалы
 * @param from начало окна
 * @param to конец окна
 */
export function clipIntervals(intervals: readonly Interval[], from: number, to: number): Interval[] {
    const result: Interval[] = [];
    for (const [start, end] of intervals) {
        const s = Math.max(start, from);
        const e = Math.min(end, to);
        if (e > s) {
            result.push([s, e]);
        }
    }
    return result;
}
