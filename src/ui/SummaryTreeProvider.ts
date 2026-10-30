/**
 * Боковая панель «Сводка» на панели активности.
 *
 * @module
 */

import * as vscode from 'vscode';
import { DashboardData, NamedValue } from '../core/statistics';
import { formatDuration, plural } from '../core/time';

/** Узел дерева сводки. */
export class SummaryItem extends vscode.TreeItem {
    /** Дочерние узлы (для раскрывающихся групп). */
    children: SummaryItem[] = [];

    /**
     * @param id стабильный идентификатор (сохраняет раскрытие группы при обновлении)
     * @param label заголовок
     * @param description серый текст справа
     * @param icon значок из набора Codicons
     */
    constructor(id: string, label: string, description: string, icon: string) {
        super(label, vscode.TreeItemCollapsibleState.None);
        this.id = id;
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

/**
 * Поставщик данных для дерева сводки.
 *
 * Дерево строится заново при каждом обновлении статистики. Узлы имеют
 * постоянные `id`, поэтому VS Code помнит, какие группы раскрыты.
 */
export class SummaryTreeProvider implements vscode.TreeDataProvider<SummaryItem> {
    private readonly changed = new vscode.EventEmitter<void>();
    private roots: SummaryItem[] = [];

    /** Событие для VS Code: дерево нужно перерисовать. */
    readonly onDidChangeTreeData = this.changed.event;

    /**
     * Перестраивает дерево по новой статистике.
     *
     * @param data статистика за неделю
     */
    update(data: DashboardData): void {
        const { today, streak, focus } = data;
        const todayItem = new SummaryItem(
            'today',
            'Сегодня',
            `${formatDuration(today.ms)} · ${Math.round(today.goalShare * 100)}% цели`,
            data.paused ? 'debug-pause' : 'watch',
        );
        todayItem.tooltip = `Цель на день: ${formatDuration(today.goalMs)}. Нажмите, чтобы изменить.`;
        todayItem.command = { command: 'codeDiary.setDailyGoal', title: 'Задать цель' };

        const streakItem = new SummaryItem(
            'streak',
            'Серия',
            `${streak.current} ${plural(streak.current, ['день', 'дня', 'дней'])} · рекорд ${streak.longest}`,
            'flame',
        );
        const focusItem = new SummaryItem(
            'focus',
            'Фокус',
            `${Math.round(focus.share * 100)}% · ${focus.focusSessions} из ${focus.totalSessions} сессий`,
            'eye',
        );
        const speedItem = new SummaryItem('speed', 'Скорость', `${data.typingCpm} зн/мин`, 'keyboard');

        const languages = this.group('languages', `Языки · ${data.rangeLabel}`, 'symbol-namespace', data.languages, 'code');
        const files = this.group('files', `Файлы · ${data.rangeLabel}`, 'files', data.files, 'file');
        for (const child of files.children) {
            const target = resolveFile(child.tooltip as string);
            if (target) {
                child.resourceUri = target;
                child.command = { command: 'vscode.open', title: 'Открыть', arguments: [target] };
            }
        }

        const open = new SummaryItem('open', 'Открыть дашборд', '', 'graph');
        open.command = { command: 'codeDiary.openDashboard', title: 'Открыть дашборд' };

        this.roots = [todayItem, streakItem, focusItem, speedItem, languages, files, open];
        this.changed.fire();
    }

    /**
     * Создаёт раскрывающуюся группу с рейтингом.
     *
     * @param id идентификатор группы
     * @param label заголовок
     * @param icon значок группы
     * @param values строки рейтинга
     * @param childIcon значок строк
     */
    private group(id: string, label: string, icon: string, values: NamedValue[], childIcon: string): SummaryItem {
        const group = new SummaryItem(id, label, values.length === 0 ? 'нет данных' : '', icon);
        group.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        group.children = values.map((v, i) => {
            const item = new SummaryItem(`${id}/${i}/${v.name}`, v.name, `${formatDuration(v.ms)} · ${Math.round(v.share * 100)}%`, childIcon);
            item.tooltip = v.detail ?? v.name;
            return item;
        });
        return group;
    }

    /** @inheritdoc */
    getTreeItem(element: SummaryItem): vscode.TreeItem {
        return element;
    }

    /** @inheritdoc */
    getChildren(element?: SummaryItem): SummaryItem[] {
        return element ? element.children : this.roots;
    }
}

/**
 * Находит файл по подписи вида `проект · путь`, если проект открыт в текущем окне.
 *
 * @param detail подпись файла из статистики
 */
function resolveFile(detail: string | undefined): vscode.Uri | undefined {
    if (!detail) {
        return undefined;
    }
    const [project, path] = detail.split(' · ');
    const folder = vscode.workspace.workspaceFolders?.find((f) => f.name === project);
    return folder && path ? vscode.Uri.joinPath(folder.uri, path) : undefined;
}
