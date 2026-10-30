import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clipIntervals, insertInterval, lowerBoundByEnd, mergeIntervals, totalLength } from '../core/intervals';
import { Interval } from '../core/types';

describe('mergeIntervals', () => {
    it('склеивает пересекающиеся интервалы', () => {
        assert.deepEqual(mergeIntervals([[1, 3], [2, 6], [8, 10], [15, 18]]), [[1, 6], [8, 10], [15, 18]]);
    });

    it('работает с неотсортированным входом и не меняет его', () => {
        const input: Interval[] = [[8, 10], [1, 4], [2, 3]];
        assert.deepEqual(mergeIntervals(input), [[1, 4], [8, 10]]);
        assert.deepEqual(input, [[8, 10], [1, 4], [2, 3]]);
    });

    it('учитывает допустимый разрыв gap', () => {
        assert.deepEqual(mergeIntervals([[0, 10], [15, 20], [40, 50]], 5), [[0, 20], [40, 50]]);
    });

    it('пустой вход', () => {
        assert.deepEqual(mergeIntervals([]), []);
    });
});

describe('insertInterval', () => {
    it('вставляет в середину без пересечений', () => {
        assert.deepEqual(insertInterval([[1, 2], [8, 9]], [4, 5]), [[1, 2], [4, 5], [8, 9]]);
    });

    it('поглощает несколько соседей', () => {
        assert.deepEqual(insertInterval([[1, 2], [3, 5], [6, 7], [8, 10], [12, 16]], [4, 8]), [[1, 2], [3, 10], [12, 16]]);
    });

    it('склеивает касающиеся интервалы', () => {
        assert.deepEqual(insertInterval([[1, 2], [5, 9]], [2, 5]), [[1, 9]]);
    });

    it('вставляет в начало и в конец', () => {
        assert.deepEqual(insertInterval([[5, 6]], [1, 2]), [[1, 2], [5, 6]]);
        assert.deepEqual(insertInterval([[5, 6]], [8, 9]), [[5, 6], [8, 9]]);
    });

    it('совпадает с mergeIntervals на случайных данных', () => {
        let list: Interval[] = [];
        const all: Interval[] = [];
        let seed = 42;
        const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
        for (let i = 0; i < 300; i++) {
            const start = Math.floor(rnd() * 1000);
            const iv: Interval = [start, start + Math.floor(rnd() * 30)];
            all.push(iv);
            list = insertInterval(list, iv);
        }
        assert.deepEqual(list, mergeIntervals(all));
    });
});

describe('вспомогательные функции', () => {
    it('lowerBoundByEnd находит позицию бинарным поиском', () => {
        const list: Interval[] = [[0, 2], [4, 6], [8, 10]];
        assert.equal(lowerBoundByEnd(list, 0), 0);
        assert.equal(lowerBoundByEnd(list, 5), 1);
        assert.equal(lowerBoundByEnd(list, 11), 3);
    });

    it('totalLength и clipIntervals', () => {
        assert.equal(totalLength([[0, 5], [10, 12]]), 7);
        assert.deepEqual(clipIntervals([[0, 5], [10, 20]], 3, 15), [[3, 5], [10, 15]]);
    });
});
