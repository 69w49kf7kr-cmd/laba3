/**
 * Подписка на события редактора и передача их в автомат учёта времени.
 *
 * @module
 */

import * as vscode from 'vscode';
import { RingBuffer } from '../core/RingBuffer';
import { SessionStateMachine, TrackerState } from '../core/SessionStateMachine';
import { MINUTE } from '../core/time';
import { ActivityContext, Segment } from '../core/types';

/** Как часто проверять тишину, мс. */
const TICK_MS = 15_000;
/** Как часто сохранять промежуточный итог длинного сегмента, мс. */
const CHECKPOINT_MS = 60_000;
/** Изменение длиннее этого считается вставкой или автоформатированием, а не набором. */
const MAX_TYPED_CHUNK = 64;
/** Окно для расчёта скорости печати, мс. */
const SPEED_WINDOW_MS = MINUTE;

/** Схемы документов, которые учитываются (обычные и безымянные файлы). */
const TRACKED_SCHEMES = new Set(['file', 'untitled', 'vscode-remote', 'vscode-vfs']);

/**
 * Трекер активности.
 *
 * Слушает события VS Code и превращает каждое в heartbeat для
 * {@link SessionStateMachine}:
 *
 * | Событие VS Code                         | Что значит                |
 * |-----------------------------------------|---------------------------|
 * | `onDidChangeTextDocument`               | печать (считаем символы)  |
 * | `onDidChangeActiveTextEditor`           | переключение файла        |
 * | `onDidChangeTextEditorSelection`        | перемещение курсора       |
 * | `onDidChangeTextEditorVisibleRanges`    | прокрутка (чтение кода)   |
 * | `onDidSaveTextDocument`                 | сохранение                |
 * | `onDidChangeWindowState`                | окно потеряло фокус       |
 */
export class ActivityTracker implements vscode.Disposable {
    private readonly machine: SessionStateMachine;
    /** Последние порции набранного текста: `[момент, символов]`. */
    private readonly keystrokes = new RingBuffer<[number, number]>(512);
    private readonly disposables: vscode.Disposable[] = [];
    private readonly stateChanged = new vscode.EventEmitter<TrackerState>();
    private timer: NodeJS.Timeout | undefined;
    private lastCheckpoint = Date.now();

    /** Событие: изменилось состояние (активен / простой / пауза). */
    readonly onDidChangeState = this.stateChanged.event;

    /**
     * @param onSegment куда отдавать завершённые сегменты
     * @param idleTimeoutMs таймаут простоя, мс
     */
    constructor(onSegment: (segment: Segment) => void, idleTimeoutMs: number) {
        this.machine = new SessionStateMachine(idleTimeoutMs, onSegment);
    }

    /** Подписывается на события и запускает таймер. */
    start(): void {
        const w = vscode.window;
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => this.onTextChange(e)),
            vscode.workspace.onDidSaveTextDocument((doc) => this.beat(doc)),
            w.onDidChangeActiveTextEditor((editor) => editor && this.beat(editor.document)),
            w.onDidChangeTextEditorSelection((e) => this.beatIfActive(e.textEditor)),
            w.onDidChangeTextEditorVisibleRanges((e) => this.beatIfActive(e.textEditor)),
            w.onDidChangeWindowState((state) => this.onWindowState(state)),
        );
        this.timer = setInterval(() => this.onTimer(), TICK_MS);
        if (w.state.focused && w.activeTextEditor) {
            this.beat(w.activeTextEditor.document);
        }
    }

    /** Текущее состояние автомата. */
    get state(): TrackerState {
        return this.machine.getState();
    }

    /**
     * Меняет таймаут простоя.
     *
     * @param ms таймаут, мс
     */
    setIdleTimeout(ms: number): void {
        this.machine.setIdleTimeout(ms);
    }

    /**
     * Ставит учёт на паузу или снимает с неё.
     *
     * @returns новое состояние
     */
    togglePause(): TrackerState {
        if (this.machine.getState() === 'paused') {
            this.machine.resume();
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                this.beat(editor.document);
            }
        } else {
            this.machine.pause(Date.now());
        }
        this.stateChanged.fire(this.machine.getState());
        return this.machine.getState();
    }

    /**
     * Открытый сегмент на текущий момент (для живой статистики).
     *
     * @param now текущий момент, мс
     */
    peek(now: number): Segment | undefined {
        return this.machine.peek(now);
    }

    /**
     * Скорость печати за последнюю минуту.
     *
     * @param now текущий момент, мс
     * @returns символов в минуту
     */
    typingSpeed(now: number): number {
        let chars = 0;
        for (const [time, count] of this.keystrokes.toArray()) {
            if (now - time <= SPEED_WINDOW_MS) {
                chars += count;
            }
        }
        return Math.round(chars * (MINUTE / SPEED_WINDOW_MS));
    }

    /** Закрывает открытый сегмент и отписывается от событий. */
    dispose(): void {
        this.machine.blur(Date.now());
        if (this.timer) {
            clearInterval(this.timer);
        }
        this.disposables.forEach((d) => d.dispose());
        this.stateChanged.dispose();
    }

    /**
     * Обработчик изменения текста: считает напечатанные символы.
     *
     * @param e событие изменения документа
     */
    private onTextChange(e: vscode.TextDocumentChangeEvent): void {
        const editor = vscode.window.activeTextEditor;
        // Учитываем только правки в активном редакторе: изменения от git,
        // форматтеров в фоне и других расширений не являются работой пользователя.
        if (!editor || editor.document !== e.document || e.contentChanges.length === 0) {
            return;
        }
        let typed = 0;
        for (const change of e.contentChanges) {
            if (change.text.length <= MAX_TYPED_CHUNK) {
                typed += change.text.replace(/\s+/g, ' ').length;
            }
        }
        const now = Date.now();
        if (typed > 0) {
            this.keystrokes.push([now, typed]);
        }
        this.beat(e.document, typed, now);
    }

    /**
     * Обработчик фокуса окна.
     *
     * @param state состояние окна
     */
    private onWindowState(state: vscode.WindowState): void {
        const before = this.machine.getState();
        if (!state.focused) {
            this.machine.blur(Date.now());
        } else if (vscode.window.activeTextEditor) {
            this.beat(vscode.window.activeTextEditor.document);
        }
        if (before !== this.machine.getState()) {
            this.stateChanged.fire(this.machine.getState());
        }
    }

    /** Периодическая проверка простоя и сохранение промежуточного итога. */
    private onTimer(): void {
        const now = Date.now();
        const before = this.machine.getState();
        this.machine.tick(now);
        if (now - this.lastCheckpoint >= CHECKPOINT_MS) {
            this.machine.checkpoint(now);
            this.lastCheckpoint = now;
        }
        if (before !== this.machine.getState()) {
            this.stateChanged.fire(this.machine.getState());
        }
    }

    /**
     * Heartbeat только для активного редактора (события выделения и прокрутки
     * приходят и от невидимых редакторов).
     *
     * @param editor редактор, в котором произошло событие
     */
    private beatIfActive(editor: vscode.TextEditor): void {
        if (editor === vscode.window.activeTextEditor) {
            this.beat(editor.document);
        }
    }

    /**
     * Передаёт действие пользователя в автомат.
     *
     * @param doc документ, в котором произошло действие
     * @param chars напечатано символов
     * @param now момент действия
     */
    private beat(doc: vscode.TextDocument, chars = 0, now = Date.now()): void {
        if (!vscode.window.state.focused) {
            return;
        }
        const ctx = contextOf(doc);
        if (!ctx) {
            return;
        }
        const before = this.machine.getState();
        this.machine.heartbeat(now, ctx, chars);
        if (before !== this.machine.getState()) {
            this.stateChanged.fire(this.machine.getState());
        }
    }
}

/**
 * Определяет файл, язык и проект документа.
 *
 * @param doc документ VS Code
 * @returns контекст или `undefined` для служебных документов (вывод, git, настройки)
 */
export function contextOf(doc: vscode.TextDocument): ActivityContext | undefined {
    if (!TRACKED_SCHEMES.has(doc.uri.scheme)) {
        return undefined;
    }
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const file = folder
        ? vscode.workspace.asRelativePath(doc.uri, false)
        : doc.uri.path.split('/').pop() || doc.uri.path;
    return {
        file,
        language: doc.languageId,
        project: folder?.name ?? 'Вне проекта',
    };
}
