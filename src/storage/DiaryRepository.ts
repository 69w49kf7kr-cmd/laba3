/**
 * Хранение дневника на диске.
 *
 * @module
 */

import * as vscode from 'vscode';
import { Diary } from '../core/Diary';
import { Segment } from '../core/types';

/** Задержка перед записью на диск: сегменты копятся и пишутся пачкой. */
const FLUSH_DELAY_MS = 2_000;

/**
 * Репозиторий дневника: читает и пишет `diary.json` в личной папке плагина
 * (`context.globalStorageUri`). Папка общая для всех окон VS Code.
 *
 * Как избежать потери данных при нескольких открытых окнах:
 * перед каждой записью файл **перечитывается**, и в свежую версию
 * добавляются только новые сегменты этого окна. Пересечения времени
 * устраняет {@link Diary.addSegment} через слияние интервалов.
 *
 * Все операции записи выстроены в очередь (цепочку промисов),
 * поэтому две записи из одного окна никогда не идут одновременно.
 */
export class DiaryRepository implements vscode.Disposable {
    private diary = new Diary();
    private pending: Segment[] = [];
    private queue: Promise<void> = Promise.resolve();
    private flushTimer: NodeJS.Timeout | undefined;
    private readonly changed = new vscode.EventEmitter<void>();

    /** Событие: данные дневника изменились. */
    readonly onDidChange = this.changed.event;

    /**
     * @param storageDir папка для файлов плагина
     */
    constructor(private readonly storageDir: vscode.Uri) {}

    private get fileUri(): vscode.Uri {
        return vscode.Uri.joinPath(this.storageDir, 'diary.json');
    }

    private get backupUri(): vscode.Uri {
        return vscode.Uri.joinPath(this.storageDir, 'diary.backup.json');
    }

    /** Загружает дневник с диска при старте плагина. */
    async load(): Promise<void> {
        await vscode.workspace.fs.createDirectory(this.storageDir);
        this.diary = await this.readFile(this.fileUri);
        this.changed.fire();
    }

    /** Текущий дневник (включая ещё не записанные на диск сегменты). */
    getDiary(): Diary {
        return this.diary;
    }

    /**
     * Принимает завершённый сегмент от трекера.
     * Сегмент сразу виден в статистике, а на диск попадает чуть позже.
     *
     * @param segment сегмент работы
     */
    add(segment: Segment): void {
        this.pending.push(segment);
        this.diary.addSegment(segment);
        this.changed.fire();
        if (!this.flushTimer) {
            this.flushTimer = setTimeout(() => void this.flush(), FLUSH_DELAY_MS);
        }
    }

    /**
     * Немедленно записывает накопленные сегменты на диск.
     *
     * @returns промис, который выполнится после записи
     */
    flush(): Promise<void> {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
            this.flushTimer = undefined;
        }
        return this.enqueue(async () => {
            if (this.pending.length === 0) {
                return;
            }
            const batch = this.pending;
            this.pending = [];
            const fresh = await this.readFile(this.fileUri);
            for (const segment of batch) {
                fresh.addSegment(segment);
            }
            await this.writeFile(this.fileUri, fresh);
            // Сегменты, пришедшие во время записи, ещё не на диске: применяем их поверх.
            for (const segment of this.pending) {
                fresh.addSegment(segment);
            }
            this.diary = fresh;
            this.changed.fire();
        });
    }

    /**
     * Полностью заменяет дневник (демо-данные, очистка).
     * Текущие данные предварительно сохраняются в резервную копию.
     *
     * @param diary новый дневник
     */
    replace(diary: Diary): Promise<void> {
        return this.enqueue(async () => {
            const current = await this.readFile(this.fileUri);
            for (const segment of this.pending) {
                current.addSegment(segment);
            }
            this.pending = [];
            if (!current.isEmpty()) {
                await this.writeFile(this.backupUri, current);
            }
            await this.writeFile(this.fileUri, diary);
            this.diary = diary;
            this.changed.fire();
        });
    }

    /**
     * Восстанавливает дневник из резервной копии, сделанной перед последней заменой.
     *
     * @returns `false`, если резервной копии нет
     */
    async restoreBackup(): Promise<boolean> {
        let restored = false;
        await this.enqueue(async () => {
            const backup = await this.readFile(this.backupUri);
            if (backup.isEmpty()) {
                return;
            }
            await this.writeFile(this.fileUri, backup);
            await vscode.workspace.fs.delete(this.backupUri);
            this.pending = [];
            this.diary = backup;
            restored = true;
            this.changed.fire();
        });
        return restored;
    }

    /** Освобождает ресурсы. Перед этим нужно вызвать {@link flush}. */
    dispose(): void {
        if (this.flushTimer) {
            clearTimeout(this.flushTimer);
        }
        this.changed.dispose();
    }

    /**
     * Ставит задачу в очередь записи. Ошибка одной задачи не ломает следующие.
     *
     * @param task асинхронная задача
     */
    private enqueue(task: () => Promise<void>): Promise<void> {
        const run = this.queue.then(task);
        this.queue = run.catch((err) => {
            console.error('[Code Diary] Ошибка записи дневника:', err);
        });
        return run;
    }

    /**
     * Читает дневник из файла. Отсутствующий файл — это пустой дневник.
     * Повреждённый файл переименовывается, чтобы данные можно было достать вручную.
     *
     * @param uri путь к файлу
     */
    private async readFile(uri: vscode.Uri): Promise<Diary> {
        let bytes: Uint8Array;
        try {
            bytes = await vscode.workspace.fs.readFile(uri);
        } catch {
            return new Diary();
        }
        try {
            return Diary.fromJSON(JSON.parse(new TextDecoder().decode(bytes)));
        } catch {
            const corrupt = vscode.Uri.joinPath(this.storageDir, `diary.corrupt-${Date.now()}.json`);
            await vscode.workspace.fs.rename(uri, corrupt, { overwrite: true });
            void vscode.window.showWarningMessage(
                `Code Diary: файл статистики был повреждён и сохранён как ${corrupt.fsPath}. Начат новый дневник.`,
            );
            return new Diary();
        }
    }

    /**
     * Записывает дневник в файл.
     *
     * @param uri путь к файлу
     * @param diary дневник
     */
    private async writeFile(uri: vscode.Uri, diary: Diary): Promise<void> {
        const text = JSON.stringify(diary.toJSON());
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    }
}
