/**
 * Генерация недельного отчёта в формате Markdown.
 *
 * @module
 */

import { Diary } from './Diary';
import { computeDashboard, StatsOptions } from './statistics';
import { formatDuration, parseDayKey, plural } from './time';

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

/**
 * Рисует текстовую полоску пропорционально значению.
 *
 * @param share доля 0..1
 * @param width ширина в символах
 */
function textBar(share: number, width = 20): string {
    const filled = Math.round(Math.max(0, Math.min(1, share)) * width);
    return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Строит Markdown-отчёт за последние 7 дней.
 *
 * @param diary дневник
 * @param options параметры (период будет принудительно `week`)
 * @returns текст отчёта
 */
export function buildWeeklyReport(diary: Diary, options: StatsOptions): string {
    const data = computeDashboard(diary, { ...options, range: 'week' });
    const maxDay = Math.max(...data.period.daily.map((d) => d.ms), 1);
    const lines: string[] = [];
    const first = data.period.daily[0].date;
    const last = data.period.daily[data.period.daily.length - 1].date;

    lines.push(`# Code Diary — отчёт за неделю`);
    lines.push('');
    lines.push(`Период: **${first} — ${last}**`);
    lines.push('');
    lines.push('## Итоги');
    lines.push('');
    lines.push('| Показатель | Значение |');
    lines.push('|---|---|');
    lines.push(`| Всего за неделю | ${formatDuration(data.period.ms)} |`);
    lines.push(`| Активных дней | ${data.period.activeDays} из 7 |`);
    lines.push(`| В среднем за активный день | ${formatDuration(data.period.avgPerActiveDayMs)} |`);
    lines.push(
        `| Текущая серия | ${data.streak.current} ${plural(data.streak.current, ['день', 'дня', 'дней'])} (рекорд ${data.streak.longest}) |`,
    );
    lines.push(
        `| Фокус | ${Math.round(data.focus.share * 100)}% (${data.focus.focusSessions} из ${data.focus.totalSessions} сессий) |`,
    );
    lines.push(`| Напечатано символов | ${data.period.chars.toLocaleString('ru-RU')} |`);
    lines.push('');
    lines.push('## По дням');
    lines.push('');
    lines.push('| День | Дата | Время | |');
    lines.push('|---|---|---|---|');
    for (const d of data.period.daily) {
        const wd = WEEKDAYS[new Date(parseDayKey(d.date)).getDay()];
        lines.push(`| ${wd} | ${d.date} | ${formatDuration(d.ms)} | \`${textBar(d.ms / maxDay)}\` |`);
    }
    lines.push('');
    lines.push('## Языки');
    lines.push('');
    if (data.languages.length === 0) {
        lines.push('_Нет данных._');
    }
    for (const lang of data.languages) {
        lines.push(`- **${lang.name}** — ${formatDuration(lang.ms)} (${Math.round(lang.share * 100)}%)`);
    }
    lines.push('');
    lines.push('## Самые «горячие» файлы');
    lines.push('');
    if (data.files.length === 0) {
        lines.push('_Нет данных._');
    }
    data.files.forEach((f, i) => lines.push(`${i + 1}. \`${f.detail}\` — ${formatDuration(f.ms)}`));
    lines.push('');
    lines.push(`_Сформировано плагином Code Diary ${new Date(options.now).toLocaleString('ru-RU')}_`);
    lines.push('');
    return lines.join('\n');
}
