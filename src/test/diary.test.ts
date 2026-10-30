import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generateDemoDiary } from '../core/demoData';
import { Diary } from '../core/Diary';
import { buildWeeklyReport } from '../core/report';
import { SessionStateMachine } from '../core/SessionStateMachine';
import { computeDashboard, computeFocus, computeStreak, quantile, StatsOptions } from '../core/statistics';
import { addDays, dayKey, HOUR, MINUTE } from '../core/time';
import { Segment } from '../core/types';

const ctx = { file: 'src/a.ts', language: 'typescript', project: 'lab' };
const at = (h: number, m = 0, day = 30) => new Date(2026, 9, day, h, m).getTime();

/** Сегмент с файлом по умолчанию. */
function seg(start: number, end: number, extra: Partial<Segment> = {}): Segment {
    return { ...ctx, start, end, chars: 0, ...extra };
}

describe('Diary', () => {
    it('раскладывает сегмент по часам', () => {
        const diary = new Diary();
        diary.addSegment(seg(at(10, 30), at(12, 15)));
        const day = diary.getDay('2026-10-30');
        assert.ok(day);
        assert.equal(day.hours[10], 30 * MINUTE);
        assert.equal(day.hours[11], HOUR);
        assert.equal(day.hours[12], 15 * MINUTE);
        assert.equal(diary.dayTotal('2026-10-30'), 105 * MINUTE);
        assert.equal(day.languages.typescript, 105 * MINUTE);
        assert.equal(day.files['lab/src/a.ts'], 105 * MINUTE);
    });

    it('делит сегмент через полночь на два дня', () => {
        const diary = new Diary();
        diary.addSegment(seg(at(23, 40, 29), at(0, 20, 30)));
        assert.equal(diary.dayTotal('2026-10-29'), 20 * MINUTE);
        assert.equal(diary.dayTotal('2026-10-30'), 20 * MINUTE);
    });

    it('не засчитывает пересекающееся время дважды (два окна VS Code)', () => {
        const diary = new Diary();
        diary.addSegment(seg(at(10), at(11)));
        diary.addSegment(seg(at(10, 30), at(11, 30), { file: 'b.ts' }));
        assert.equal(diary.dayTotal('2026-10-30'), 90 * MINUTE);
    });

    it('переживает сериализацию и игнорирует мусор', () => {
        const diary = new Diary();
        diary.addSegment(seg(at(9), at(10), { chars: 500 }));
        const copy = Diary.fromJSON(JSON.parse(JSON.stringify(diary.toJSON())));
        assert.deepEqual(copy.toJSON(), diary.toJSON());

        const broken = Diary.fromJSON({ version: 1, days: { 'не дата': {}, '2026-10-01': { intervals: 'x', hours: [1] } } });
        assert.deepEqual(broken.dayKeys(), ['2026-10-01']);
        assert.equal(broken.dayTotal('2026-10-01'), 0);
        assert.ok(Diary.fromJSON(null).isEmpty());
    });
});

describe('SessionStateMachine', () => {
    const idle = 2 * MINUTE;

    function run(actions: (m: SessionStateMachine) => void): Segment[] {
        const out: Segment[] = [];
        const machine = new SessionStateMachine(idle, (s) => out.push(s));
        actions(machine);
        return out;
    }

    it('частые действия продлевают один сегмент', () => {
        const out = run((m) => {
            for (let t = 0; t <= 10 * MINUTE; t += 30_000) {
                m.heartbeat(at(10) + t, ctx, 5);
            }
            m.tick(at(10, 30));
        });
        assert.equal(out.length, 1);
        assert.equal(out[0].end - out[0].start, 10 * MINUTE);
        assert.equal(out[0].chars, 21 * 5);
    });

    it('простой не засчитывается: сегмент закрывается на последнем действии', () => {
        const out = run((m) => {
            m.heartbeat(at(10), ctx);
            m.heartbeat(at(10, 1), ctx);
            m.heartbeat(at(10, 20), ctx); // вернулся через 19 минут
            m.heartbeat(at(10, 21), ctx);
            m.blur(at(10, 21));
        });
        assert.deepEqual(
            out.map((s) => s.end - s.start),
            [MINUTE, MINUTE],
        );
    });

    it('переключение файла закрывает сегмент в момент переключения', () => {
        const out = run((m) => {
            m.heartbeat(at(10), ctx);
            m.heartbeat(at(10, 1), { ...ctx, file: 'b.ts' });
            m.heartbeat(at(10, 2), { ...ctx, file: 'b.ts' });
            m.tick(at(11));
        });
        assert.deepEqual(
            out.map((s) => [s.file, s.end - s.start]),
            [['src/a.ts', MINUTE], ['b.ts', MINUTE]],
        );
    });

    it('пауза игнорирует действия', () => {
        const out = run((m) => {
            m.heartbeat(at(10), ctx);
            m.heartbeat(at(10, 1), ctx);
            m.pause(at(10, 1));
            m.heartbeat(at(10, 2), ctx);
            assert.equal(m.getState(), 'paused');
            m.resume();
            assert.equal(m.getState(), 'idle');
        });
        assert.equal(out.length, 1);
    });

    it('checkpoint сохраняет итог, не прерывая сегмент', () => {
        const out = run((m) => {
            m.heartbeat(at(10), ctx);
            m.heartbeat(at(10, 1), ctx);
            m.checkpoint(at(10, 1));
            m.heartbeat(at(10, 2), ctx);
            assert.equal(m.getState(), 'active');
            m.blur(at(10, 2));
        });
        assert.equal(out.length, 2);
        assert.equal(out[0].end, out[1].start);
        assert.equal(out[1].end - out[0].start, 2 * MINUTE);
    });

    it('peek показывает открытый сегмент', () => {
        const machine = new SessionStateMachine(idle, () => undefined);
        assert.equal(machine.peek(at(10)), undefined);
        machine.heartbeat(at(10), ctx);
        assert.equal(machine.peek(at(10, 1))?.end, at(10, 1));
        assert.equal(machine.peek(at(10, 30))?.end, at(10)); // после таймаута — только до последнего действия
    });
});

describe('статистика', () => {
    it('quantile', () => {
        assert.equal(quantile([1, 2, 3, 4, 5], 0.5), 3);
        assert.equal(quantile([10, 20], 0.25), 12.5);
        assert.equal(quantile([], 0.5), 0);
    });

    it('серия дней: текущая и рекордная', () => {
        const diary = new Diary();
        for (const d of [20, 21, 22, 23, 26, 27, 28, 29]) {
            diary.addSegment(seg(at(10, 0, d), at(10, 30, d)));
        }
        // Сегодня (30-е) ещё не начато — серия считается со вчера.
        assert.deepEqual(computeStreak(diary, '2026-10-30'), { current: 4, longest: 4, activeToday: false });
        diary.addSegment(seg(at(9), at(9, 5)));
        assert.deepEqual(computeStreak(diary, '2026-10-30'), { current: 5, longest: 5, activeToday: true });
    });

    it('фокус: доля времени в длинных сессиях', () => {
        const diary = new Diary();
        diary.addSegment(seg(at(10), at(10, 40))); // 40 мин — сессия фокуса
        diary.addSegment(seg(at(14), at(14, 10))); // 10 мин — короткая
        const focus = computeFocus([diary.getDay('2026-10-30')!], 5 * MINUTE, 25 * MINUTE);
        assert.equal(focus.totalSessions, 2);
        assert.equal(focus.focusSessions, 1);
        assert.equal(focus.share, 0.8);
        assert.equal(focus.longestSessionMs, 40 * MINUTE);
    });

    const options = (now: number): StatsOptions => ({
        now,
        range: 'week',
        dailyGoalMs: 2 * HOUR,
        focusSessionMs: 25 * MINUTE,
        sessionGapMs: 5 * MINUTE,
        typingCpm: 0,
        paused: false,
    });

    it('computeDashboard на демо-данных даёт согласованные числа', () => {
        const now = at(18);
        const diary = generateDemoDiary(now);
        const data = computeDashboard(diary, options(now));
        const sumDaily = data.period.daily.reduce((a, d) => a + d.ms, 0);
        assert.equal(data.period.ms, sumDaily);
        assert.equal(data.period.daily.length, 7);
        assert.equal(data.heatmap.weeks.length, 53);
        assert.ok(data.heatmap.weeks.every((w) => w.length === 7));
        assert.ok(data.streak.current >= 6, 'последние дни демо всегда активны');
        assert.ok(data.languages.length > 0 && data.files.length > 0);
        const shareSum = data.languages.reduce((a, l) => a + l.share, 0);
        assert.ok(Math.abs(shareSum - 1) < 1e-9);
        assert.ok(data.hours.reduce((a, h) => a + h, 0) >= data.period.ms);
        // Будущие дни на тепловой карте пустые.
        const future = data.heatmap.weeks.flat().filter((c) => c.future);
        assert.ok(future.every((c) => c.level === 0 && c.date > dayKey(now)));
    });

    it('демо-данные воспроизводимы и не заходят в будущее', () => {
        const now = at(12);
        const a = generateDemoDiary(now);
        const b = generateDemoDiary(now);
        assert.deepEqual(a.toJSON(), b.toJSON());
        assert.ok(a.dayKeys().every((k) => k <= dayKey(now)));
        const today = a.getDay(dayKey(now));
        assert.ok(!today || today.intervals.every(([, end]) => end <= now));
        assert.ok(a.dayKeys()[0] >= addDays(dayKey(now), -365));
    });

    it('недельный отчёт в Markdown', () => {
        const now = at(18);
        const report = buildWeeklyReport(generateDemoDiary(now), options(now));
        assert.match(report, /^# Code Diary — отчёт за неделю/);
        assert.match(report, /## По дням/);
        assert.equal((report.match(/^\| (Пн|Вт|Ср|Чт|Пт|Сб|Вс) \|/gm) ?? []).length, 7);
    });
});
