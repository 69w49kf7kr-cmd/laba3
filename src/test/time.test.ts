import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, dayKey, formatDuration, HOUR, MINUTE, nextHourStart, parseDurationToMinutes, plural, weekdayMonFirst } from '../core/time';

describe('даты', () => {
    it('dayKey и addDays переходят через месяц и год', () => {
        assert.equal(dayKey(new Date(2026, 0, 5, 13, 0).getTime()), '2026-01-05');
        assert.equal(addDays('2026-12-31', 1), '2027-01-01');
        assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    });

    it('nextHourStart', () => {
        const t = new Date(2026, 9, 30, 14, 25, 10).getTime();
        assert.equal(nextHourStart(t), new Date(2026, 9, 30, 15, 0, 0).getTime());
    });

    it('weekdayMonFirst: 30.10.2026 — пятница', () => {
        assert.equal(weekdayMonFirst('2026-10-30'), 4);
    });
});

describe('форматирование', () => {
    it('formatDuration', () => {
        assert.equal(formatDuration(0), '0м');
        assert.equal(formatDuration(30_000), '<1м');
        assert.equal(formatDuration(45 * MINUTE), '45м');
        assert.equal(formatDuration(2 * HOUR), '2ч');
        assert.equal(formatDuration(2 * HOUR + 14 * MINUTE), '2ч 14м');
    });

    it('plural', () => {
        const forms: [string, string, string] = ['день', 'дня', 'дней'];
        assert.equal(plural(1, forms), 'день');
        assert.equal(plural(3, forms), 'дня');
        assert.equal(plural(5, forms), 'дней');
        assert.equal(plural(11, forms), 'дней');
        assert.equal(plural(21, forms), 'день');
        assert.equal(plural(112, forms), 'дней');
    });
});

describe('parseDurationToMinutes', () => {
    const cases: [string, number | undefined][] = [
        ['90', 90],
        ['1:30', 90],
        ['2ч', 120],
        ['1ч 30м', 90],
        ['1.5ч', 90],
        ['1,5 часа', 90],
        ['45 мин', 45],
        ['2h 15m', 135],
        ['3 часов', 180],
        ['', undefined],
        ['abc', undefined],
        ['2ч и ещё', undefined],
    ];
    for (const [input, expected] of cases) {
        it(`«${input}» → ${expected}`, () => {
            assert.equal(parseDurationToMinutes(input), expected);
        });
    }
});
