/**
 * Общие типы данных плагина.
 *
 * Модуль не зависит от API VS Code, поэтому всё ядро (`src/core`)
 * можно тестировать обычным Node.js без запуска редактора.
 *
 * @module
 */

/** Отрезок времени `[начало, конец)` в миллисекундах Unix-времени. */
export type Interval = [start: number, end: number];

/** Контекст активности: где именно сейчас работает пользователь. */
export interface ActivityContext {
    /** Путь к файлу относительно рабочей папки (или имя безымянного файла). */
    file: string;
    /** Идентификатор языка VS Code: `typescript`, `python`, `cpp`… */
    language: string;
    /** Имя рабочей папки (проекта). */
    project: string;
}

/**
 * Завершённый отрезок непрерывной работы в одном файле.
 * Именно сегменты трекер отдаёт в `Diary` на хранение.
 */
export interface Segment extends ActivityContext {
    /** Момент начала, мс. */
    start: number;
    /** Момент окончания, мс (`end >= start`). */
    end: number;
    /** Сколько символов было напечатано за сегмент. */
    chars: number;
}

/**
 * Статистика одного календарного дня. Это единица хранения дневника:
 * сырые события не сохраняются, только агрегаты.
 */
export interface DayRecord {
    /** Дата в формате `YYYY-MM-DD` (локальное время). */
    date: string;
    /** Отсортированные непересекающиеся интервалы активности. */
    intervals: Interval[];
    /** Время по языкам, мс. */
    languages: Record<string, number>;
    /** Время по файлам, мс. Ключ: `проект/путь`. */
    files: Record<string, number>;
    /** Время по проектам, мс. */
    projects: Record<string, number>;
    /** Распределение по часам суток: 24 ячейки, мс. */
    hours: number[];
    /** Напечатано символов за день. */
    chars: number;
}

/** Сериализуемое представление всего дневника (формат файла `diary.json`). */
export interface DiaryData {
    /** Версия формата, нужна для будущих миграций. */
    version: 1;
    /** Дни, ключ — дата `YYYY-MM-DD`. */
    days: Record<string, DayRecord>;
}

/** Период, за который строится статистика на дашборде. */
export type StatsRange = 'today' | 'week' | 'month' | 'all';
