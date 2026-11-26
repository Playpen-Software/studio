import { getPreference, setPreference } from './playpenPreferences';

export type ResizableElementUnit = 'px' | '%';
export type WidthResizableElementProperty = 'width' | 'flex';

export type WidthResizablePersistence = {
    value: number;
    property: WidthResizableElementProperty;
    unit: ResizableElementUnit;
};

export type WidthResizablePersistenceMap = Record<string, WidthResizablePersistence>;

export class WidthResizableElement {
    private handle: HTMLElement;
    private element: HTMLElement;
    private unit: ResizableElementUnit;
    private property: WidthResizableElementProperty;
    private persistent: boolean;

    private initialInlineWidth: string;
    private initialInlineFlex: string;
    private documentInitialUserSelect: string = '';
    private resizing: boolean = false;

    private stepAmount: number;

    constructor(
        handle: HTMLElement,
        element: HTMLElement,
        unit: ResizableElementUnit,
        property: WidthResizableElementProperty,
        persistent: boolean = false
    ) {
        this.handle = handle;
        this.element = element;
        this.unit = unit;
        this.property = property;
        this.persistent = persistent;

        this.initialInlineWidth = this.element.style.width;
        this.initialInlineFlex = this.element.style.flex;

        this.handle.addEventListener('pointerdown', this.startMouseResize);
        this.handle.addEventListener('dblclick', this.reset);

        this.handle.addEventListener('focusin', this.startKeyboardResize);

        if (this.persistent && this.element.id) {
            const preference = getPreference<WidthResizablePersistenceMap>('userResizableElements', {});
            const saved = preference[this.element.id];
            if (saved) {
                this.applySize(saved.value, saved.property, saved.unit);
            }
        }

        this.stepAmount = getPreference('resizableElementStepAmount', 5);
    }

    private startKeyboardResize = (): void => {
        window.addEventListener('keydown', this.handleKeyboardResize);
        this.handle.addEventListener('focusout', this.endKeyboardResize);

        // This is here to refresh the step amount so the user's step amount preferences are still followed after change w/o re-instantiation.
        this.stepAmount = getPreference('resizableElementStepAmount', 5);
    };

    private handleKeyboardResize = (event: KeyboardEvent): void => {
        const rect = this.element.getBoundingClientRect();
        let targetWidthPx = rect.width;

        switch (event.key) {
            case "ArrowLeft":
            event.preventDefault();
            targetWidthPx -= this.stepAmount;
            this.applySize(this.calculateValueFromPx(targetWidthPx), this.property, this.unit);
            break;
            case "ArrowRight":
            event.preventDefault();
            targetWidthPx += this.stepAmount;
            this.applySize(this.calculateValueFromPx(targetWidthPx), this.property, this.unit);
            break;
            case " ":
            event.preventDefault();
            this.reset();
            break;
        }
    };

    private calculateValueFromPx(targetWidthPx: number): number {
        targetWidthPx = Math.max(10, targetWidthPx);
        const parentWidth = this.element.parentElement?.getBoundingClientRect().width || window.innerWidth;

        if (this.property === 'flex') {
            return Number((targetWidthPx / parentWidth).toFixed(4));
        }

        if (this.unit === '%') {
            return Number(((targetWidthPx / parentWidth) * 100).toFixed(2));
        }

        return Math.round(targetWidthPx);
    }

    private endKeyboardResize = (): void => {
        window.removeEventListener('keydown', this.handleKeyboardResize);
        this.handle.removeEventListener('focusout', this.endKeyboardResize);
    };

    private startMouseResize = (event: PointerEvent): void => {
        event.preventDefault();
        this.resizing = true;

        document.addEventListener('pointerup', this.endMouseResize);
        document.addEventListener('pointermove', this.handleMouseResize);

        this.documentInitialUserSelect = document.body.style.userSelect;
        document.body.style.userSelect = 'none';
    };

    private endMouseResize = (): void => {
        if (!this.resizing) return;
        this.resizing = false;

        document.removeEventListener('pointerup', this.endMouseResize);
        document.removeEventListener('pointermove', this.handleMouseResize);

        document.body.style.userSelect = this.documentInitialUserSelect;
    };

    private handleMouseResize = (event: PointerEvent): void => {
        if (!this.resizing) return;

        const value = this.calculateValue(event.clientX);
        this.applySize(value, this.property, this.unit);

        if (this.persistent && this.element.id) {
            const preference = getPreference<WidthResizablePersistenceMap>('userResizableElements', {});
            preference[this.element.id] = {
                value,
                unit: this.unit,
                property: this.property,
            };
            setPreference('userResizableElements', preference);
        }
    };

    private calculateValue(clientX: number): number {
        const rect = this.element.getBoundingClientRect();
        const targetWidthPx = Math.max(10, clientX - rect.left);
        return this.calculateValueFromPx(targetWidthPx);
    }

    private applySize(
        value: number,
        property: WidthResizableElementProperty,
        unit: ResizableElementUnit
    ): void {
        if (property === 'flex') {
            this.element.style.width = '';
            this.element.style.flex = `${value} 1 0%`;
        } else {
            this.element.style.flex = 'none';
            this.element.style.width = `${value}${unit}`;
        }
    }

    public reset = (): void => {
        this.element.style.width = this.initialInlineWidth;
        this.element.style.flex = this.initialInlineFlex;

        if (this.persistent && this.element.id) {
            const preference = getPreference<WidthResizablePersistenceMap>('userResizableElements', {});
            delete preference[this.element.id];
            setPreference('userResizableElements', preference);
        }
    };

    public unbind(): void {
        this.endMouseResize();
        this.endKeyboardResize();
        this.handle.removeEventListener('pointerdown', this.startMouseResize);
        this.handle.removeEventListener('dblclick', this.reset);

        this.handle.removeEventListener('focusin', this.startKeyboardResize);
    }
}