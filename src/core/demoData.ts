/**
 * Генератор правдоподобных демо-данных для показа дашборда.
 *
 * @module
 */

import { Diary } from './Diary';
import { addDays, dayKey, MINUTE, parseDayKey, weekdayMonFirst } from './time';

/**
 * Генератор псевдослучайных чисел Mulberry32.
 * При одинаковом `seed` всегда выдаёт одну и ту же последовательность,
 * поэтому демо-данные воспроизводимы.
 *
 * @param seed начальное значение
 * @returns функция, возвращающая числа в `[0, 1)`
 */
export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Выбирает элемент по весам (рулеточный отбор).
 *
 * @param items варианты с весами
 * @param rnd генератор случайных чисел
 */
function pickWeighted<T>(items: readonly { value: T; weight: number }[], rnd: () => number): T {
    const total = items.reduce((acc, it) => acc + it.weight, 0);
    let r = rnd() * total;
    for (const it of items) {
        r -= it.weight;
        if (r <= 0) {
            return it.value;
        }
    }
    return items[items.length - 1].value;
}

interface DemoProject {
    name: string;
    weight: number;
    files: { file: string; language: string }[];
}

const PROJECTS: DemoProject[] = [
    {
        name: 'isrpo-lab3',
        weight: 5,
        files: [
            { file: 'src/extension.ts', language: 'typescript' },
            { file: 'src/core/statistics.ts', language: 'typescript' },
            { file: 'src/core/Diary.ts', language: 'typescript' },
            { file: 'media/dashboard.js', language: 'javascript' },
            { file: 'media/dashboard.css', language: 'css' },
            { file: 'README.md', language: 'markdown' },
        ],
    },
    {
        name: 'algorithms',
        weight: 3,
        files: [
            { file: 'graphs/dijkstra.cpp', language: 'cpp' },
            { file: 'trees/segment_tree.cpp', language: 'cpp' },
            { file: 'dp/knapsack.py', language: 'python' },
            { file: 'strings/kmp.py', language: 'python' },
        ],
    },
    {
        name: 'geometric_lib',
        weight: 1.5,
        files: [
            { file: 'rectangle.py', language: 'python' },
            { file: 'triangle.py', language: 'python' },
            { file: 'docs/README.md', language: 'markdown' },
        ],
    },
    {
        name: 'portfolio',
        weight: 1,
        files: [
            { file: 'index.html', language: 'html' },
            { file: 'styles/main.css', language: 'css' },
            { file: 'app.js', language: 'javascript' },
        ],
    },
];

/** Когда обычно начинаются сессии: утро, день, вечер. */
const START_HOURS = [
    { value: 10, weight: 2 },
    { value: 11, weight: 2 },
    { value: 13, weight: 1 },
    { value: 15, weight: 2 },
    { value: 17, weight: 2 },
    { value: 19, weight: 3 },
    { value: 20, weight: 3 },
    { value: 21, weight: 2 },
    { value: 22, weight: 1 },
];

/**
 * Создаёт дневник с демо-данными за последние `days` дней (по умолчанию — год,
 * чтобы заполнить тепловую карту).
 * Учитывает реалистичные закономерности: в будни пишут чаще, вечером больше,
 * бывают пропуски и «марафоны». Последние дни всегда активны, чтобы была видна серия.
 *
 * @param now текущий момент, мс (сессии из будущего не создаются)
 * @param days глубина истории в днях
 * @param seed зерно генератора
 */
export function generateDemoDiary(now: number, days = 365, seed = 3106): Diary {
    const rnd = mulberry32(seed);
    const diary = new Diary();
    const today = dayKey(now);

    for (let back = days; back >= 0; back--) {
        const key = addDays(today, -back);
        const weekend = weekdayMonFirst(key) >= 5;
        const recent = back <= 6;
        const chance = recent ? 1 : weekend ? 0.45 : 0.78;
        if (rnd() > chance) {
            continue;
        }
        const sessionCount = 1 + Math.floor(rnd() * (weekend ? 2 : 3));
        let busyUntil = 0;
        for (let s = 0; s < sessionCount; s++) {
            const hour = pickWeighted(START_HOURS, rnd);
            let cursor = Math.max(parseDayKey(key) + hour * 60 * MINUTE + Math.floor(rnd() * 50) * MINUTE, busyUntil + 20 * MINUTE);
            // Длина сессии: короткие «заходы», обычные 25–60 минут и редкие «марафоны».
            const tier = rnd();
            const length = (tier < 0.3 ? 5 + rnd() * 18 : tier < 0.85 ? 25 + rnd() * 40 : 70 + rnd() * 110) * MINUTE;
            const sessionEnd = cursor + length;
            const project = pickWeighted(PROJECTS.map((p) => ({ value: p, weight: p.weight })), rnd);
            while (cursor < sessionEnd && cursor < now) {
                const target = project.files[Math.floor(rnd() * project.files.length)];
                const pieceEnd = Math.min(sessionEnd, cursor + (4 + rnd() * 22) * MINUTE, now);
                const minutes = (pieceEnd - cursor) / MINUTE;
                diary.addSegment({
                    file: target.file,
                    language: target.language,
                    project: project.name,
                    start: cursor,
                    end: pieceEnd,
                    chars: Math.round(minutes * (60 + rnd() * 140)),
                });
                // Короткие паузы внутри сессии: чай, документация, мысли.
                cursor = pieceEnd + (rnd() < 0.3 ? Math.floor(rnd() * 4) * MINUTE : 0);
            }
            busyUntil = sessionEnd;
        }
    }
    return diary;
}
