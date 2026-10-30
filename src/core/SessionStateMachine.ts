/**
 * Конечный автомат, который превращает поток событий редактора в сегменты работы.
 *
 * @module
 */

import { ActivityContext, Segment } from './types';

/**
 * Состояние трекера.
 *
 * - `idle`: пользователь ничего не делает, время не идёт;
 * - `active`: идёт сегмент работы в конкретном файле;
 * - `paused`: учёт выключен пользователем.
 */
export type TrackerState = 'idle' | 'active' | 'paused';

/** Открытый (ещё не завершённый) сегмент. */
export interface OpenSegment extends ActivityContext {
    start: number;
    /** Момент последнего действия пользователя. */
    lastBeat: number;
    chars: number;
}

/**
 * Автомат учёта времени.
 *
 * ```
 *            heartbeat                 тишина > таймаута / потеря фокуса
 *   idle ─────────────────► active ───────────────────────────────► idle
 *    ▲  ◄───── resume ────┐   │ ▲
 *    │                    │   │ │ heartbeat в другом файле:
 *    └─── pause ─────► paused │ └─ закрыть сегмент, открыть новый
 *                         ▲   │
 *                         └───┘ pause
 * ```
 *
 * Каждое действие пользователя (печать, перемещение курсора, прокрутка,
 * сохранение) — это «heartbeat». Пока heartbeat-ы приходят чаще, чем раз в
 * `idleTimeoutMs`, сегмент продолжается. Когда наступает тишина, сегмент
 * закрывается в момент **последнего действия**, и простой не засчитывается.
 *
 * Класс не знает про VS Code: события передаёт `ActivityTracker`,
 * а время передаётся явно. Поэтому автомат легко покрыть тестами.
 */
export class SessionStateMachine {
    private state: TrackerState = 'idle';
    private current: OpenSegment | null = null;

    /**
     * @param idleTimeoutMs сколько мс тишины завершает сегмент
     * @param onSegment вызывается для каждого завершённого сегмента
     */
    constructor(
        private idleTimeoutMs: number,
        private readonly onSegment: (segment: Segment) => void,
    ) {}

    /** Текущее состояние автомата. */
    getState(): TrackerState {
        return this.state;
    }

    /**
     * Меняет таймаут простоя (например, после изменения настроек).
     *
     * @param ms новый таймаут, мс
     */
    setIdleTimeout(ms: number): void {
        this.idleTimeoutMs = ms;
    }

    /**
     * Обрабатывает действие пользователя.
     *
     * @param time момент действия, мс
     * @param ctx файл, язык и проект, где произошло действие
     * @param chars сколько символов напечатано (0 для навигации)
     */
    heartbeat(time: number, ctx: ActivityContext, chars = 0): void {
        if (this.state === 'paused') {
            return;
        }
        const cur = this.current;
        if (this.state === 'active' && cur) {
            if (time - cur.lastBeat > this.idleTimeoutMs) {
                // Пользователь отходил: старый сегмент заканчивается на последнем действии.
                this.close(cur.lastBeat);
            } else if (sameContext(cur, ctx)) {
                cur.lastBeat = Math.max(cur.lastBeat, time);
                cur.chars += chars;
                return;
            } else {
                // Переключение файла: время до переключения принадлежит старому файлу.
                this.close(time);
            }
        }
        this.current = { ...ctx, start: time, lastBeat: time, chars };
        this.state = 'active';
    }

    /**
     * Периодическая проверка по таймеру: закрывает сегмент при долгой тишине.
     *
     * @param time текущий момент, мс
     */
    tick(time: number): void {
        if (this.state === 'active' && this.current && time - this.current.lastBeat > this.idleTimeoutMs) {
            this.close(this.current.lastBeat);
            this.state = 'idle';
        }
    }

    /**
     * Окно VS Code потеряло фокус: пользователь ушёл в другую программу.
     *
     * @param time момент потери фокуса, мс
     */
    blur(time: number): void {
        if (this.state === 'active' && this.current) {
            const quiet = time - this.current.lastBeat > this.idleTimeoutMs;
            this.close(quiet ? this.current.lastBeat : time);
            this.state = 'idle';
        }
    }

    /**
     * Сохраняет «промежуточный итог» длинного сегмента, не прерывая его.
     * Нужна, чтобы при аварийном закрытии редактора не потерять час работы.
     *
     * @param time текущий момент, мс
     */
    checkpoint(time: number): void {
        const cur = this.current;
        if (this.state !== 'active' || !cur || time - cur.lastBeat > this.idleTimeoutMs) {
            return;
        }
        const cut = cur.lastBeat;
        if (cut <= cur.start && cur.chars === 0) {
            return;
        }
        this.close(cut);
        this.current = { ...cur, start: cut, chars: 0 };
    }

    /**
     * Ставит учёт на паузу. Открытый сегмент закрывается.
     *
     * @param time момент паузы, мс
     */
    pause(time: number): void {
        if (this.state === 'active' && this.current) {
            this.close(Math.min(time, this.current.lastBeat + this.idleTimeoutMs));
        }
        this.state = 'paused';
    }

    /** Снимает паузу. Новый сегмент начнётся со следующего действия. */
    resume(): void {
        if (this.state === 'paused') {
            this.state = 'idle';
        }
    }

    /**
     * Снимок открытого сегмента на момент `time`, без его закрытия.
     * Нужен, чтобы статистика «за сегодня» росла в реальном времени.
     *
     * @param time текущий момент, мс
     * @returns сегмент или `undefined`, если сейчас нет активности
     */
    peek(time: number): Segment | undefined {
        const cur = this.current;
        if (this.state !== 'active' || !cur) {
            return undefined;
        }
        const end = time - cur.lastBeat > this.idleTimeoutMs ? cur.lastBeat : Math.max(cur.lastBeat, time);
        return { file: cur.file, language: cur.language, project: cur.project, start: cur.start, end, chars: cur.chars };
    }

    /**
     * Закрывает открытый сегмент и отдаёт его наружу.
     *
     * @param end момент окончания
     */
    private close(end: number): void {
        const cur = this.current;
        this.current = null;
        if (!cur) {
            return;
        }
        const segment: Segment = {
            file: cur.file,
            language: cur.language,
            project: cur.project,
            start: cur.start,
            end: Math.max(cur.start, end),
            chars: cur.chars,
        };
        if (segment.end > segment.start || segment.chars > 0) {
            this.onSegment(segment);
        }
    }
}

/**
 * Сравнивает два контекста: тот же ли это файл того же проекта.
 *
 * @param a первый контекст
 * @param b второй контекст
 */
function sameContext(a: ActivityContext, b: ActivityContext): boolean {
    return a.file === b.file && a.project === b.project && a.language === b.language;
}
