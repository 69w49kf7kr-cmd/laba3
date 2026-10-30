/**
 * Элемент строки состояния со временем за сегодня.
 *
 * @module
 */

import * as vscode from 'vscode';
import { DashboardData } from '../core/statistics';
import { formatDuration, plural } from '../core/time';

/**
 * Показывает в строке состояния `⏱ 2ч 14м  🔥 5`.
 * По клику открывается дашборд, при наведении видна подробная подсказка.
 */
export class StatusBarController implements vscode.Disposable {
    private readonly item: vscode.StatusBarItem;

    constructor() {
        this.item = vscode.window.createStatusBarItem('codeDiary.status', vscode.StatusBarAlignment.Right, 100);
        this.item.name = 'Code Diary';
        this.item.command = 'codeDiary.openDashboard';
    }

    /**
     * Включает или скрывает элемент (настройка `codeDiary.showStatusBar`).
     *
     * @param visible показывать ли
     */
    setVisible(visible: boolean): void {
        if (visible) {
            this.item.show();
        } else {
            this.item.hide();
        }
    }

    /**
     * Обновляет текст и подсказку.
     *
     * @param data свежая статистика
     */
    update(data: DashboardData): void {
        const { today, streak } = data;
        const goalReached = today.goalMs > 0 && today.ms >= today.goalMs;

        if (data.paused) {
            this.item.text = '$(debug-pause) Пауза';
        } else {
            const goalIcon = goalReached ? ' $(pass-filled)' : '';
            const streakText = streak.current > 1 ? `  $(flame) ${streak.current}` : '';
            this.item.text = `$(watch) ${formatDuration(today.ms)}${goalIcon}${streakText}`;
        }

        const percent = Math.round(today.goalShare * 100);
        const tip = new vscode.MarkdownString(undefined, true);
        tip.isTrusted = { enabledCommands: ['codeDiary.openDashboard', 'codeDiary.togglePause'] };
        tip.appendMarkdown('**Code Diary**\n\n');
        tip.appendMarkdown(`$(watch) Сегодня: **${formatDuration(today.ms)}** из ${formatDuration(today.goalMs)} (${percent}%)\n\n`);
        tip.appendMarkdown(
            `$(flame) Серия: **${streak.current}** ${plural(streak.current, ['день', 'дня', 'дней'])} · рекорд ${streak.longest}\n\n`,
        );
        tip.appendMarkdown(`$(keyboard) Скорость сейчас: **${data.typingCpm}** зн/мин\n\n`);
        tip.appendMarkdown('---\n\n');
        tip.appendMarkdown('[Открыть дашборд](command:codeDiary.openDashboard) · ');
        tip.appendMarkdown(`[${data.paused ? 'Продолжить учёт' : 'Пауза'}](command:codeDiary.togglePause)`);
        this.item.tooltip = tip;
    }

    /** Удаляет элемент из строки состояния. */
    dispose(): void {
        this.item.dispose();
    }
}
