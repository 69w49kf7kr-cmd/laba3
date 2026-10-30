import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MinHeap, topK } from '../core/MinHeap';
import { RingBuffer } from '../core/RingBuffer';

describe('RingBuffer', () => {
    it('хранит элементы в порядке добавления', () => {
        const buf = new RingBuffer<number>(3);
        buf.push(1);
        buf.push(2);
        assert.deepEqual(buf.toArray(), [1, 2]);
        assert.equal(buf.size, 2);
    });

    it('вытесняет самые старые элементы при переполнении', () => {
        const buf = new RingBuffer<number>(3);
        [1, 2, 3, 4, 5].forEach((n) => buf.push(n));
        assert.deepEqual(buf.toArray(), [3, 4, 5]);
        assert.equal(buf.size, 3);
    });

    it('очищается', () => {
        const buf = new RingBuffer<string>(2);
        buf.push('a');
        buf.clear();
        assert.deepEqual(buf.toArray(), []);
    });

    it('не принимает некорректную ёмкость', () => {
        assert.throws(() => new RingBuffer(0), RangeError);
    });
});

describe('MinHeap', () => {
    it('извлекает элементы по возрастанию (пирамидальная сортировка)', () => {
        const heap = new MinHeap<number>((a, b) => a - b);
        const input = [5, 3, 9, 1, 7, 2, 8, 2];
        input.forEach((n) => heap.push(n));
        const out: number[] = [];
        while (heap.size > 0) {
            out.push(heap.pop() as number);
        }
        assert.deepEqual(out, [...input].sort((a, b) => a - b));
    });

    it('peek и pop на пустой куче', () => {
        const heap = new MinHeap<number>((a, b) => a - b);
        assert.equal(heap.peek(), undefined);
        assert.equal(heap.pop(), undefined);
    });
});

describe('topK', () => {
    it('возвращает k наибольших по убыванию', () => {
        const entries: [string, number][] = [['a', 5], ['b', 50], ['c', 1], ['d', 20], ['e', 30]];
        assert.deepEqual(topK(entries, 3), [['b', 50], ['e', 30], ['d', 20]]);
    });

    it('k больше количества элементов', () => {
        assert.deepEqual(topK([['x', 1]], 5), [['x', 1]]);
    });

    it('k = 0', () => {
        assert.deepEqual(topK([['x', 1]], 0), []);
    });
});
