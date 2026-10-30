/**
 * Точка входа расширения Code Diary.
 *
 * VS Code вызывает {@link activate} после запуска редактора
 * (`activationEvents: onStartupFinished` в `package.json`) и {@link deactivate}
 * при закрытии окна. Здесь создаются все компоненты и связываются между собой:
 *
 * ```
 * события редактора → ActivityTracker → SessionStateMachine → сегменты
 *   → DiaryRepository (Diary + diary.json) → computeDashboard()
 *   → StatusBarController / SummaryTreeProvider / DashboardPanel
 * ```
 *
 * @module
 */

import * as vscode from 'vscode';
import { generateDemoDiary } from './core/demoData';
import { Diary } from './core/Diary';
import { buildWeeklyReport } from './core/report';
import { computeDashboard, DashboardData, StatsOptions } from './core/statistics';
import { dayKey, formatDuration, MINUTE, parseDurationToMinutes } from './core/time';
import { StatsRange } from './core/types';
import { DiaryRepository } from './storage/DiaryRepository';
import { ActivityTracker } from './tracker/ActivityTracker';
import { DashboardPanel, DashboardSource } from './ui/DashboardPanel';
import { StatusBarController } from './ui/StatusBarController';
import { SummaryTreeProvider } from './ui/SummaryTreeProvider';

/** Как часто обновлять интерфейс, чтобы счётчик «сегодня» шёл в реальном времени. */
const UI_REFRESH_MS = 10_000;
/** Перерыв, который не разрывает сессию (но не меньше таймаута простоя). */
const SESSION_GAP_MS = 5 * MINUTE;

const RANGE_KEY = 'codeDiary.range';
const GOAL_NOTIFIED_KEY = 'codeDiary.goalNotifiedDay';

/** Настройки плагина из `settings.json`. */
interface Settings {
    dailyGoalMinutes: number;
    idleTimeoutMinutes: number;
    focusSessionMinutes: number;
    showStatusBar: boolean;
}

/** Читает актуальные настройки пользователя. */
function readSettings(): Settings {
    const c = vscode.workspace.getConfiguration('codeDiary');
    return {
        dailyGoalMinutes: c.get<number>('dailyGoalMinutes', 120),
        idleTimeoutMinutes: c.get<number>('idleTimeoutMinutes', 2),
        focusSessionMinutes: c.get<number>('focusSessionMinutes', 25),
        showStatusBar: c.get<boolean>('showStatusBar', true),
    };
}

let tracker: ActivityTracker | undefined;
let repository: DiaryRepository | undefined;

/**
 * Активация расширения: создание компонентов, регистрация команд и подписок.
 *
 * @param context контекст расширения от VS Code
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const repo = new DiaryRepository(context.globalStorageUri);
    await repo.load();
    repository = repo;

    const activity = new ActivityTracker((segment) => repo.add(segment), readSettings().idleTimeoutMinutes * MINUTE);
    tracker = activity;

    const statusBar = new StatusBarController();
    statusBar.setVisible(readSettings().showStatusBar);
    const tree = new SummaryTreeProvider();

    /** Параметры расчёта статистики на текущий момент. */
    const statsOptions = (range: StatsRange): StatsOptions => {
        const s = readSettings();
        const now = Date.now();
        return {
            now,
            range,
            dailyGoalMs: s.dailyGoalMinutes * MINUTE,
            focusSessionMs: s.focusSessionMinutes * MINUTE,
            sessionGapMs: Math.max(SESSION_GAP_MS, s.idleTimeoutMinutes * MINUTE),
            typingCpm: activity.typingSpeed(now),
            paused: activity.state === 'paused',
        };
    };

    /** Дневник вместе с ещё открытым сегментом, чтобы цифры росли «вживую». */
    const liveDiary = (now: number): Diary => {
        const open = activity.peek(now);
        if (!open || open.end <= open.start) {
            return repo.getDiary();
        }
        const copy = repo.getDiary().clone();
        copy.addSegment(open);
        return copy;
    };

    const source: DashboardSource = {
        compute: (range) => {
            const options = statsOptions(range);
            return computeDashboard(liveDiary(options.now), options);
        },
        getRange: () => context.globalState.get<StatsRange>(RANGE_KEY, 'week'),
        setRange: (range) => {
            void context.globalState.update(RANGE_KEY, range);
            refresh();
        },
    };

    /** Один раз в день поздравляет с достижением цели. */
    const checkGoal = (data: DashboardData): void => {
        const today = dayKey(data.now);
        if (data.today.goalMs <= 0 || data.today.ms < data.today.goalMs) {
            return;
        }
        if (context.globalState.get<string>(GOAL_NOTIFIED_KEY) === today) {
            return;
        }
        void context.globalState.update(GOAL_NOTIFIED_KEY, today);
        void vscode.window
            .showInformationMessage(`Цель на сегодня выполнена: ${formatDuration(data.today.goalMs)}. Хорошая работа!`, 'Открыть дашборд')
            .then((choice) => choice && vscode.commands.executeCommand('codeDiary.openDashboard'));
    };

    /** Пересчитывает статистику и обновляет все элементы интерфейса. */
    const refresh = (): void => {
        const data = source.compute(source.getRange());
        statusBar.update(data);
        tree.update(data);
        DashboardPanel.refresh();
        checkGoal(data);
    };

    const timer = setInterval(refresh, UI_REFRESH_MS);

    context.subscriptions.push(
        statusBar,
        repo,
        activity,
        { dispose: () => clearInterval(timer) },
        vscode.window.registerTreeDataProvider('codeDiary.summary', tree),
        repo.onDidChange(refresh),
        activity.onDidChangeState(refresh),
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (!e.affectsConfiguration('codeDiary')) {
                return;
            }
            const s = readSettings();
            activity.setIdleTimeout(s.idleTimeoutMinutes * MINUTE);
            statusBar.setVisible(s.showStatusBar);
            refresh();
        }),

        vscode.commands.registerCommand('codeDiary.openDashboard', () => DashboardPanel.show(context.extensionUri, source)),

        vscode.commands.registerCommand('codeDiary.setDailyGoal', async () => {
            const current = readSettings().dailyGoalMinutes;
            const input = await vscode.window.showInputBox({
                title: 'Code Diary: цель на день',
                prompt: 'Сколько времени вы хотите программировать в день? Например: 90, 1:30, 2ч, 1ч 30м',
                value: formatDuration(current * MINUTE),
                validateInput: (value) => {
                    const minutes = parseDurationToMinutes(value);
                    if (minutes === undefined) {
                        return 'Не получилось разобрать. Примеры: 90, 1:30, 2ч, 1ч 30м';
                    }
                    if (minutes < 5 || minutes > 1440) {
                        return 'Цель должна быть от 5 минут до 24 часов';
                    }
                    return undefined;
                },
            });
            const minutes = input === undefined ? undefined : parseDurationToMinutes(input);
            if (minutes !== undefined) {
                await vscode.workspace
                    .getConfiguration('codeDiary')
                    .update('dailyGoalMinutes', minutes, vscode.ConfigurationTarget.Global);
                void vscode.window.showInformationMessage(`Новая цель на день: ${formatDuration(minutes * MINUTE)}`);
            }
        }),

        vscode.commands.registerCommand('codeDiary.togglePause', () => {
            const state = activity.togglePause();
            void vscode.window.setStatusBarMessage(
                state === 'paused' ? 'Code Diary: учёт на паузе' : 'Code Diary: учёт продолжен',
                3000,
            );
            refresh();
        }),

        vscode.commands.registerCommand('codeDiary.exportReport', async () => {
            const options = statsOptions('week');
            const content = buildWeeklyReport(liveDiary(options.now), options);
            const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content });
            await vscode.window.showTextDocument(doc, { preview: false });
        }),

        vscode.commands.registerCommand('codeDiary.generateDemoData', async () => {
            const answer = await vscode.window.showWarningMessage(
                'Заполнить дневник демонстрационными данными за последний год?',
                { modal: true, detail: 'Текущая статистика будет сохранена в резервную копию. Вернуть её можно командой «Восстановить данные из резервной копии».' },
                'Заполнить',
            );
            if (answer === 'Заполнить') {
                await repo.replace(generateDemoDiary(Date.now()));
                DashboardPanel.show(context.extensionUri, source);
            }
        }),

        vscode.commands.registerCommand('codeDiary.restoreBackup', async () => {
            const restored = await repo.restoreBackup();
            void vscode.window.showInformationMessage(
                restored ? 'Данные восстановлены из резервной копии.' : 'Резервной копии нет.',
            );
        }),

        vscode.commands.registerCommand('codeDiary.clearData', async () => {
            const answer = await vscode.window.showWarningMessage(
                'Удалить всю статистику Code Diary?',
                { modal: true, detail: 'Перед удалением будет сделана резервная копия.' },
                'Удалить',
            );
            if (answer === 'Удалить') {
                await repo.replace(new Diary());
            }
        }),
    );

    activity.start();
    refresh();
}

/**
 * Деактивация: закрываем открытый сегмент и дописываем всё на диск.
 * VS Code ждёт возвращённый промис, поэтому данные не теряются при закрытии окна.
 */
export async function deactivate(): Promise<void> {
    tracker?.dispose();
    await repository?.flush();
}
