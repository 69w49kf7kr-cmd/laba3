/**
 * Двоичная куча и выбор топ-K элементов.
 *
 * @module
 */

/**
 * Двоичная куча с минимумом в корне.
 *
 * Хранится в обычном массиве: у узла `i` дети `2i + 1` и `2i + 2`,
 * родитель `(i - 1) / 2`. Вставка и извлечение минимума работают за O(log n).
 *
 * @typeParam T тип элементов
 */
export class MinHeap<T> {
    private readonly data: T[] = [];

    /**
     * @param compare функция сравнения: отрицательное число, если `a < b`
     */
    constructor(private readonly compare: (a: T, b: T) => number) {}

    /** Количество элементов в куче. */
    get size(): number {
        return this.data.length;
    }

    /** Минимальный элемент без удаления (или `undefined`, если куча пуста). */
    peek(): T | undefined {
        return this.data[0];
    }

    /**
     * Добавляет элемент и «поднимает» его на нужное место.
     *
     * @param item элемент
     */
    push(item: T): void {
        this.data.push(item);
        this.siftUp(this.data.length - 1);
    }

    /**
     * Удаляет и возвращает минимальный элемент.
     */
    pop(): T | undefined {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0 && last !== undefined) {
            this.data[0] = last;
            this.siftDown(0);
        }
        return top;
    }

    /** Поднимает элемент вверх, пока он меньше родителя. */
    private siftUp(index: number): void {
        let i = index;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.compare(this.data[i], this.data[parent]) >= 0) {
                break;
            }
            [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
            i = parent;
        }
    }

    /** Опускает элемент вниз, пока он больше одного из детей. */
    private siftDown(index: number): void {
        let i = index;
        const n = this.data.length;
        for (;;) {
            const left = 2 * i + 1;
            const right = left + 1;
            let smallest = i;
            if (left < n && this.compare(this.data[left], this.data[smallest]) < 0) {
                smallest = left;
            }
            if (right < n && this.compare(this.data[right], this.data[smallest]) < 0) {
                smallest = right;
            }
            if (smallest === i) {
                return;
            }
            [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
            i = smallest;
        }
    }
}

/**
 * Выбирает `k` записей с наибольшими значениями.
 *
 * Держим кучу размера `k`: если в ней больше `k` элементов, выбрасываем минимум.
 * Получается O(n log k) вместо O(n log n) при полной сортировке.
 * Это заметно, когда файлов тысячи, а показать нужно семь.
 *
 * @param entries пары `[имя, значение]`
 * @param k сколько записей оставить
 * @returns записи по убыванию значения
 */
export function topK(entries: Iterable<[string, number]>, k: number): [string, number][] {
    if (k <= 0) {
        return [];
    }
    const heap = new MinHeap<[string, number]>((a, b) => a[1] - b[1] || b[0].localeCompare(a[0]));
    for (const entry of entries) {
        heap.push(entry);
        if (heap.size > k) {
            heap.pop();
        }
    }
    const result: [string, number][] = [];
    while (heap.size > 0) {
        result.push(heap.pop() as [string, number]);
    }
    return result.reverse();
}
