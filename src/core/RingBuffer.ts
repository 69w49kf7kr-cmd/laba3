/**
 * Кольцевой буфер фиксированной ёмкости.
 *
 * @module
 */

/**
 * Кольцевой (циклический) буфер: хранит последние `capacity` элементов.
 * Когда буфер заполнен, новый элемент затирает самый старый.
 * Добавление работает за O(1) без сдвига массива.
 *
 * В плагине буфер хранит отметки последних нажатий клавиш,
 * по ним считается текущая скорость печати.
 *
 * @typeParam T тип элементов
 */
export class RingBuffer<T> {
    private readonly items: (T | undefined)[];
    /** Индекс, куда будет записан следующий элемент. */
    private head = 0;
    private count = 0;

    /**
     * @param capacity максимальное количество элементов (> 0)
     */
    constructor(private readonly capacity: number) {
        if (!Number.isInteger(capacity) || capacity <= 0) {
            throw new RangeError('Ёмкость кольцевого буфера должна быть положительным целым числом');
        }
        this.items = new Array<T | undefined>(capacity);
    }

    /** Текущее количество элементов. */
    get size(): number {
        return this.count;
    }

    /**
     * Добавляет элемент. Если буфер полон, самый старый элемент вытесняется.
     *
     * @param item новый элемент
     */
    push(item: T): void {
        this.items[this.head] = item;
        this.head = (this.head + 1) % this.capacity;
        if (this.count < this.capacity) {
            this.count++;
        }
    }

    /**
     * Возвращает элементы от самого старого к самому новому.
     */
    toArray(): T[] {
        const result: T[] = [];
        const start = (this.head - this.count + this.capacity) % this.capacity;
        for (let i = 0; i < this.count; i++) {
            result.push(this.items[(start + i) % this.capacity] as T);
        }
        return result;
    }

    /** Удаляет все элементы. */
    clear(): void {
        this.items.fill(undefined);
        this.head = 0;
        this.count = 0;
    }
}
