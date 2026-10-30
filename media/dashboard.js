// @ts-check
/**
 * Code Diary: скрипт страницы дашборда (выполняется внутри webview).
 *
 * Страница ничего не считает сама: расширение присылает готовый объект
 * DashboardData, а скрипт превращает его в HTML. В обратную сторону уходят
 * только два вида сообщений: выбор периода и нажатие кнопки-команды.
 *
 * CSP запрещает инлайн-атрибуты style, поэтому размеры элементов передаются
 * через data-w / data-h / data-l и выставляются функцией applySizes().
 */
(function () {
    'use strict';

    // eslint-disable-next-line no-undef
    const vscode = acquireVsCodeApi();
    const app = /** @type {HTMLElement} */ (document.getElementById('app'));
    const tooltip = /** @type {HTMLElement} */ (document.getElementById('tooltip'));

    const MINUTE = 60000;
    const DAY = 24 * 60 * MINUTE;
    const RANGES = [
        ['today', 'Сегодня'],
        ['week', '7 дней'],
        ['month', '30 дней'],
        ['all', 'Всё время'],
    ];
    const WEEKDAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    // ---------- Форматирование ----------

    /** Длительность: «2ч 14м», «45м», «<1м». */
    function fmt(ms) {
        const total = Math.floor(ms / MINUTE);
        if (total < 1) {
            return ms > 0 ? '<1м' : '0м';
        }
        const h = Math.floor(total / 60);
        const m = total % 60;
        if (h === 0) {
            return m + 'м';
        }
        return m === 0 ? h + 'ч' : h + 'ч ' + m + 'м';
    }

    /** Русское множественное число. */
    function plural(n, forms) {
        const a = n % 10;
        const b = n % 100;
        if (a === 1 && b !== 11) {
            return forms[0];
        }
        if (a >= 2 && a <= 4 && (b < 12 || b > 14)) {
            return forms[1];
        }
        return forms[2];
    }

    /** Экранирование HTML: имена файлов приходят от пользователя. */
    function esc(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** «HH:MM». */
    function clock(ms) {
        const d = new Date(ms);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }

    /** Разбор «YYYY-MM-DD» в локальную дату. */
    function parseDay(key) {
        const p = key.split('-').map(Number);
        return new Date(p[0], p[1] - 1, p[2]);
    }

    /** «пн, 27 октября». */
    function dayLabel(key) {
        const d = parseDay(key);
        return WEEKDAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS_GEN[d.getMonth()];
    }

    /**
     * Атрибут data-tip. HTML подсказки экранируется ещё раз: getAttribute()
     * раскодирует сущности, и без этого имя файла вида «<img onerror=…>»
     * попало бы в innerHTML подсказки как разметка.
     */
    function tip(html) {
        return ' data-tip="' + esc(html) + '"';
    }

    function pct(share) {
        return Math.round(share * 100);
    }

    function num(n) {
        return Number(n).toLocaleString('ru-RU');
    }

    const DAYS_FORMS = ['день', 'дня', 'дней'];

    // ---------- Блоки страницы ----------

    function header(d) {
        const date = new Date(d.now).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
        const buttons = RANGES.map(function (r) {
            return '<button data-range="' + r[0] + '" aria-pressed="' + (d.range === r[0]) + '">' + r[1] + '</button>';
        }).join('');
        return (
            '<header><div><h1>Code Diary</h1><div class="subtitle"><span>' + esc(date) + '</span><span>·</span>' +
            '<span class="status' + (d.paused ? ' paused' : '') + '"><span class="status-dot"></span>' +
            (d.paused ? 'Учёт на паузе' : 'Идёт учёт') + '</span></div></div>' +
            '<div class="segmented" role="group" aria-label="Период статистики">' + buttons + '</div></header>'
        );
    }

    function kpi(title, value, body) {
        return '<section class="card kpi"><div class="card-title">' + title + '</div><div class="value">' + value + '</div>' + body + '</section>';
    }

    function kpis(d) {
        const t = d.today;
        const goal = kpi(
            'Сегодня',
            fmt(t.ms),
            '<div class="progress" role="progressbar" aria-valuenow="' + pct(t.goalShare) + '" aria-valuemin="0" aria-valuemax="100">' +
                '<div data-w="' + Math.min(100, t.goalShare * 100) + '"></div></div>' +
                '<div class="sub">' + pct(t.goalShare) + '% от цели ' + fmt(t.goalMs) +
                ' · <button class="link" data-cmd="setDailyGoal">изменить</button></div>',
        );

        const p = d.period;
        const periodSub =
            d.range === 'today'
                ? num(t.chars) + ' символов напечатано'
                : p.activeDays + ' из ' + p.days + ' ' + plural(p.days, DAYS_FORMS) + ' · ≈' + fmt(p.avgPerActiveDayMs) + ' в день';
        const period = kpi(d.range === 'today' ? 'Сегодня всего' : 'За ' + d.rangeLabel.toLowerCase(), fmt(p.ms), '<div class="sub">' + periodSub + '</div>');

        const s = d.streak;
        const streak = kpi(
            'Серия',
            s.current + '<small>' + plural(s.current, DAYS_FORMS) + '</small>',
            '<div class="sub">рекорд — ' + s.longest + ' ' + plural(s.longest, DAYS_FORMS) +
                (s.activeToday || s.current === 0 ? '' : ' · сегодня ещё не начато') + '</div>',
        );

        const f = d.focus;
        const focus = kpi(
            'Фокус',
            pct(f.share) + '<small>%</small>',
            '<div class="sub">' + f.focusSessions + ' из ' + f.totalSessions + ' ' +
                plural(f.totalSessions, ['сессии', 'сессий', 'сессий']) + ' ≥ ' + Math.round(d.focusSessionMs / MINUTE) + ' мин</div>',
        );
        return '<div class="grid kpis">' + goal + period + streak + focus + '</div>';
    }

    function card(title, note, body) {
        return (
            '<section class="card"><div class="card-head"><div class="card-title">' + title + '</div>' +
            (note ? '<div class="card-note">' + note + '</div>' : '') + '</div>' + body + '</section>'
        );
    }

    function todayCard(d) {
        const dayStart = parseDay(new Date(d.now).toLocaleDateString('sv-SE')).getTime();
        const sessions = d.today.sessions;
        let longest = 0;
        const blocks = sessions.map(function (s) {
            longest = Math.max(longest, s[1] - s[0]);
            const left = ((s[0] - dayStart) / DAY) * 100;
            const width = ((s[1] - s[0]) / DAY) * 100;
            return '<div class="block" data-l="' + left + '" data-w="' + width + '" data-tip="<b>' +
                clock(s[0]) + '–' + clock(s[1]) + '</b> · ' + fmt(s[1] - s[0]) + '"></div>';
        }).join('');
        const nowLeft = ((d.now - dayStart) / DAY) * 100;
        const note = sessions.length === 0
            ? 'активности пока нет'
            : sessions.length + ' ' + plural(sessions.length, ['сессия', 'сессии', 'сессий']) + ' · самая длинная ' + fmt(longest);
        const body =
            '<div class="timeline">' + blocks + '<div class="now" data-l="' + nowLeft + '" data-tip="Сейчас, ' + clock(d.now) + '"></div></div>' +
            '<div class="axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>';
        return '<div class="grid">' + card('Сегодня по времени суток', note, body) + '</div>';
    }

    function dailyCard(d) {
        if (d.range !== 'week' && d.range !== 'month') {
            return '';
        }
        const daily = d.period.daily;
        const max = Math.max.apply(null, daily.map(function (x) { return x.ms; }).concat([1]));
        const bars = daily.map(function (x) {
            return '<div class="bar' + (x.ms === 0 ? ' empty' : '') + '" data-tip="<b>' + esc(dayLabel(x.date)) + '</b> · ' + fmt(x.ms) +
                '"><i data-h="' + (x.ms / max) * 100 + '"></i></div>';
        }).join('');
        const labels = daily.map(function (x, i) {
            const dt = parseDay(x.date);
            let text = '';
            if (d.range === 'week') {
                text = WEEKDAYS[dt.getDay()];
            } else if (i % 5 === 0 || i === daily.length - 1) {
                text = String(dt.getDate());
            }
            return '<span>' + text + '</span>';
        }).join('');
        const best = daily.reduce(function (a, b) { return b.ms > a.ms ? b : a; }, daily[0]);
        const note = best && best.ms > 0 ? 'лучший день: ' + esc(dayLabel(best.date)) + ', ' + fmt(best.ms) : '';
        return '<div class="grid">' + card('По дням', note, '<div class="bars' + (daily.length <= 7 ? ' few' : '') + '">' + bars + '</div><div class="bar-axis">' + labels + '</div>') + '</div>';
    }

    function heatmapCard(d) {
        const cell = 11;
        const step = 14;
        const left = 26;
        const top = 16;
        const weeks = d.heatmap.weeks;
        const width = left + weeks.length * step;
        const height = top + 7 * step;
        let svg = '';
        d.heatmap.months.forEach(function (m) {
            svg += '<text x="' + (left + m.week * step) + '" y="10">' + m.label + '</text>';
        });
        [['пн', 0], ['ср', 2], ['пт', 4]].forEach(function (r) {
            svg += '<text x="0" y="' + (top + Number(r[1]) * step + 9) + '">' + r[0] + '</text>';
        });
        let activeDays = 0;
        weeks.forEach(function (week, w) {
            week.forEach(function (c, i) {
                if (c.future) {
                    return;
                }
                if (c.ms > 0) {
                    activeDays++;
                }
                svg += '<rect x="' + (left + w * step) + '" y="' + (top + i * step) + '" width="' + cell + '" height="' + cell +
                    '" rx="2" class="lvl-' + c.level + '" data-tip="<b>' + esc(dayLabel(c.date)) + '</b> · ' +
                    (c.ms > 0 ? fmt(c.ms) : 'нет активности') + '"></rect>';
            });
        });
        const legendCells = [0, 1, 2, 3, 4].map(function (l) {
            return '<svg width="11" height="11" aria-hidden="true"><rect width="11" height="11" rx="2" class="lvl-' + l + '"></rect></svg>';
        }).join('');
        const body =
            '<svg class="heatmap" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-label="Тепловая карта активности за год">' + svg + '</svg>' +
            '<div class="legend">меньше ' + legendCells + ' больше</div>';
        return '<div class="grid">' + card('Активность за год', activeDays + ' ' + plural(activeDays, ['активный день', 'активных дня', 'активных дней']), body) + '</div>';
    }

    function hbars(items) {
        if (items.length === 0) {
            return '<div class="empty-note">Нет данных за период</div>';
        }
        const max = Math.max.apply(null, items.map(function (x) { return x.ms; }));
        return '<div class="hbars">' + items.map(function (x) {
            const other = x.name === 'Другие';
            return '<div class="hbar-row' + (other ? ' other' : '') + '"' + tip('<b>' + esc(x.name) + '</b> · ' + fmt(x.ms) + ' · ' + pct(x.share) + '%') + '>' +
                '<span class="hbar-name">' + esc(x.name) + '</span>' +
                '<div class="hbar-track"><div class="hbar-fill" data-w="' + (x.ms / max) * 100 + '"></div></div>' +
                '<span class="hbar-value">' + fmt(x.ms) + ' · ' + pct(x.share) + '%</span></div>';
        }).join('') + '</div>';
    }

    function hoursCard(d) {
        const hours = d.hours;
        const max = Math.max.apply(null, hours.concat([1]));
        let peak = -1;
        hours.forEach(function (ms, h) {
            if (ms > 0 && (peak < 0 || ms > hours[peak])) {
                peak = h;
            }
        });
        const bars = hours.map(function (ms, h) {
            const cls = 'bar' + (ms === 0 ? ' empty' : '') + (h === peak ? ' peak' : '');
            return '<div class="' + cls + '" data-tip="<b>' + h + ':00–' + (h + 1) + ':00</b> · ' + fmt(ms) + '"><i data-h="' + (ms / max) * 100 + '"></i></div>';
        }).join('');
        const labels = hours.map(function (_, h) {
            return '<span>' + (h % 6 === 0 ? h : '') + '</span>';
        }).join('');
        const note = peak >= 0 ? 'пик: ' + peak + ':00–' + (peak + 1) + ':00' : '';
        return card('Время суток', note, '<div class="bars">' + bars + '</div><div class="bar-axis">' + labels + '</div>');
    }

    function filesCard(d) {
        if (d.files.length === 0) {
            return card('Самые «горячие» файлы', '', '<div class="empty-note">Нет данных за период</div>');
        }
        const max = d.files[0].ms;
        const items = d.files.map(function (f, i) {
            return '<li' + tip(esc(f.detail)) + '><span class="rank">' + (i + 1) + '</span><div><span class="name">' + esc(f.name) + '</span>' +
                '<span class="path">' + esc(f.detail) + '</span><div class="mini"><div data-w="' + (f.ms / max) * 100 + '"></div></div></div>' +
                '<span class="time">' + fmt(f.ms) + '</span></li>';
        }).join('');
        return card('Самые «горячие» файлы', '', '<ul class="files">' + items + '</ul>');
    }

    function factsCard(d) {
        const rows = [
            ['Сессий за период', String(d.focus.totalSessions)],
            ['Самая длинная сессия', fmt(d.focus.longestSessionMs)],
            ['В среднем за активный день', fmt(d.period.avgPerActiveDayMs)],
            ['Напечатано символов', num(d.period.chars)],
            ['Скорость печати сейчас', d.typingCpm + ' зн/мин'],
        ];
        const body = '<dl class="facts">' + rows.map(function (r) {
            return '<div><dt>' + r[0] + '</dt><dd>' + r[1] + '</dd></div>';
        }).join('') + '</dl>';
        return card('Итоги периода', esc(d.rangeLabel.toLowerCase()), body);
    }

    function footer(d) {
        return (
            '<footer><div>Данные хранятся локально и никуда не отправляются</div>' +
            '<div class="actions"><button class="link" data-cmd="exportReport">Экспорт отчёта</button>' +
            '<button class="link" data-cmd="togglePause">' + (d.paused ? 'Продолжить учёт' : 'Поставить на паузу') + '</button></div></footer>'
        );
    }

    function emptyState(d) {
        return (
            header(d) +
            '<section class="card empty-state"><h2>Дневник пока пуст</h2>' +
            '<p>Откройте любой файл и начните печатать: через минуту здесь появится статистика. ' +
            'Чтобы сразу посмотреть, как выглядит дашборд, заполните его демо-данными.</p>' +
            '<button class="primary" data-cmd="generateDemoData">Заполнить демо-данными</button></section>'
        );
    }

    // ---------- Отрисовка ----------

    /** Переносит размеры из data-атрибутов в CSSOM (инлайн-стили запрещены CSP). */
    function applySizes() {
        app.querySelectorAll('[data-w]').forEach(function (el) {
            /** @type {HTMLElement} */ (el).style.width = el.getAttribute('data-w') + '%';
        });
        app.querySelectorAll('[data-h]').forEach(function (el) {
            /** @type {HTMLElement} */ (el).style.height = el.getAttribute('data-h') + '%';
        });
        app.querySelectorAll('[data-l]').forEach(function (el) {
            /** @type {HTMLElement} */ (el).style.left = el.getAttribute('data-l') + '%';
        });
    }

    function render(d) {
        tooltip.hidden = true;
        if (d.isEmpty) {
            app.innerHTML = emptyState(d);
            return;
        }
        app.innerHTML = [
            header(d),
            kpis(d),
            todayCard(d),
            dailyCard(d),
            heatmapCard(d),
            '<div class="grid two">' + card('Языки', esc(d.rangeLabel.toLowerCase()), hbars(d.languages)) + hoursCard(d) + '</div>',
            '<div class="grid two">' + filesCard(d) + '<div class="stack">' + card('Проекты', esc(d.rangeLabel.toLowerCase()), hbars(d.projects)) + factsCard(d) + '</div></div>',
            footer(d),
        ].join('');
        applySizes();
    }

    // ---------- События ----------

    app.addEventListener('click', function (e) {
        const target = /** @type {HTMLElement} */ (e.target);
        const rangeBtn = target.closest('[data-range]');
        if (rangeBtn) {
            app.querySelectorAll('[data-range]').forEach(function (b) {
                b.setAttribute('aria-pressed', String(b === rangeBtn));
            });
            vscode.postMessage({ type: 'setRange', range: rangeBtn.getAttribute('data-range') });
            return;
        }
        const cmdBtn = target.closest('[data-cmd]');
        if (cmdBtn) {
            vscode.postMessage({ type: 'command', command: 'codeDiary.' + cmdBtn.getAttribute('data-cmd') });
        }
    });

    function placeTooltip(e) {
        const pad = 12;
        const rect = tooltip.getBoundingClientRect();
        let x = e.clientX + pad;
        let y = e.clientY + pad;
        if (x + rect.width > window.innerWidth - 4) {
            x = e.clientX - rect.width - pad;
        }
        if (y + rect.height > window.innerHeight - 4) {
            y = e.clientY - rect.height - pad;
        }
        tooltip.style.left = Math.max(4, x) + 'px';
        tooltip.style.top = Math.max(4, y) + 'px';
    }

    app.addEventListener('mouseover', function (e) {
        const el = /** @type {HTMLElement} */ (e.target).closest('[data-tip]');
        if (!el) {
            tooltip.hidden = true;
            return;
        }
        // Содержимое подсказок собрано выше из экранированных строк.
        tooltip.innerHTML = el.getAttribute('data-tip') || '';
        tooltip.hidden = false;
        placeTooltip(e);
    });
    app.addEventListener('mousemove', function (e) {
        if (!tooltip.hidden) {
            placeTooltip(e);
        }
    });
    app.addEventListener('mouseleave', function () {
        tooltip.hidden = true;
    });

    window.addEventListener('message', function (event) {
        const msg = event.data;
        if (msg && msg.type === 'data') {
            vscode.setState(msg.data);
            render(msg.data);
        }
    });

    // Мгновенно показываем последние данные, пока расширение считает свежие.
    const saved = vscode.getState();
    if (saved) {
        render(saved);
    }
    vscode.postMessage({ type: 'ready' });
})();
