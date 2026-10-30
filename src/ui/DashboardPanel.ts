/**
 * Webview-панель с дашбордом.
 *
 * @module
 */

import * as vscode from 'vscode';
import { DashboardData } from '../core/statistics';
import { StatsRange } from '../core/types';

/** Сообщения, которые webview отправляет расширению. */
export type InboundMessage =
    | { type: 'ready' }
    | { type: 'setRange'; range: StatsRange }
    | { type: 'command'; command: string };

/** Команды, которые разрешено вызывать из webview. */
const ALLOWED_COMMANDS = new Set([
    'codeDiary.setDailyGoal',
    'codeDiary.togglePause',
    'codeDiary.exportReport',
    'codeDiary.generateDemoData',
]);

/** Источник данных для панели. */
export interface DashboardSource {
    /** Считает статистику за период. */
    compute(range: StatsRange): DashboardData;
    /** Выбранный период (запоминается между запусками). */
    getRange(): StatsRange;
    /** Сохраняет выбранный период. */
    setRange(range: StatsRange): void;
}

/**
 * Дашборд в отдельной вкладке редактора.
 *
 * Сама страница (`media/dashboard.html/css/js`) ничего не считает: расширение
 * присылает ей готовый объект {@link DashboardData} через `postMessage`,
 * а страница только рисует. Общение двустороннее: страница сообщает о
 * выборе периода и нажатии кнопок.
 *
 * Панель — синглтон: повторная команда показывает уже открытую вкладку.
 */
export class DashboardPanel implements vscode.Disposable {
    private static current: DashboardPanel | undefined;
    private readonly disposables: vscode.Disposable[] = [];

    /**
     * Открывает дашборд или переключается на уже открытый.
     *
     * @param extensionUri корневая папка расширения (для путей к `media/`)
     * @param source источник данных
     */
    static show(extensionUri: vscode.Uri, source: DashboardSource): void {
        if (DashboardPanel.current) {
            DashboardPanel.current.panel.reveal();
            return;
        }
        const panel = vscode.window.createWebviewPanel('codeDiary.dashboard', 'Code Diary', vscode.ViewColumn.Active, {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        });
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'activity.svg');
        DashboardPanel.current = new DashboardPanel(panel, extensionUri, source);
    }

    /** Отправляет свежие данные, если дашборд открыт и виден. */
    static refresh(): void {
        DashboardPanel.current?.postData();
    }

    /**
     * @param panel созданная webview-панель
     * @param extensionUri корневая папка расширения
     * @param source источник данных
     */
    private constructor(
        private readonly panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly source: DashboardSource,
    ) {
        panel.webview.html = this.renderHtml(panel.webview, extensionUri);
        this.disposables.push(
            panel.onDidDispose(() => this.dispose()),
            panel.onDidChangeViewState(() => this.postData()),
            panel.webview.onDidReceiveMessage((msg: InboundMessage) => this.onMessage(msg)),
        );
    }

    /**
     * Обрабатывает сообщения от страницы.
     *
     * @param msg сообщение
     */
    private onMessage(msg: InboundMessage): void {
        switch (msg.type) {
            case 'ready':
                this.postData();
                break;
            case 'setRange':
                if (['today', 'week', 'month', 'all'].includes(msg.range)) {
                    this.source.setRange(msg.range);
                    this.postData();
                }
                break;
            case 'command':
                if (ALLOWED_COMMANDS.has(msg.command)) {
                    void vscode.commands.executeCommand(msg.command);
                }
                break;
        }
    }

    /** Считает статистику и отправляет её странице. */
    private postData(): void {
        if (!this.panel.visible) {
            return;
        }
        void this.panel.webview.postMessage({ type: 'data', data: this.source.compute(this.source.getRange()) });
    }

    /**
     * Собирает HTML страницы со строгой политикой безопасности (CSP):
     * скрипты только свои и только с одноразовым `nonce`.
     *
     * @param webview webview панели
     * @param extensionUri корневая папка расширения
     */
    private renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
        const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', file));
        const nonce = makeNonce();
        const csp = [
            "default-src 'none'",
            `style-src ${webview.cspSource}`,
            `script-src 'nonce-${nonce}'`,
            `img-src ${webview.cspSource}`,
        ].join('; ');
        return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${media('dashboard.css')}">
<title>Code Diary</title>
</head>
<body>
<main id="app" aria-live="polite"><div class="loading">Загрузка статистики…</div></main>
<div id="tooltip" role="tooltip" hidden></div>
<script nonce="${nonce}" src="${media('dashboard.js')}"></script>
</body>
</html>`;
    }

    /** Закрывает панель и освобождает подписки. */
    dispose(): void {
        DashboardPanel.current = undefined;
        this.disposables.forEach((d) => d.dispose());
        this.panel.dispose();
    }
}

/** Случайная строка для атрибута `nonce`. */
function makeNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
