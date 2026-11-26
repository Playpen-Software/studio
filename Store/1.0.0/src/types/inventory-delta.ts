export type InventoryEntity = 'space' | 'category' | 'item';

export type InventoryDelta =
    | {
        id: string;
        timestamp: number;
        entity: 'space';
        action: 'create';
        data: { name: string; imageBase64?: string | null };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'space';
        action: 'update';
        entityId: number | bigint;
        data: { name?: string; imageBase64?: string | null };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'space';
        action: 'delete';
        entityId: number | bigint;
        data?: never;
    }
    | {
        id: string;
        timestamp: number;
        entity: 'category';
        action: 'create';
        data: {
            spaceId: number | bigint;
            name: string;
            parentCategoryId?: number | bigint | null;
            attributes?: Array<{
                name: string;
                dataType: 'string' | 'number' | 'boolean' | 'date';
                isRequired?: boolean;
            }>;
        };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'category';
        action: 'update';
        entityId: number | bigint;
        data: { name?: string; spaceId?: number | bigint; parentCategoryId?: number | bigint | null };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'category';
        action: 'delete';
        entityId: number | bigint;
        data?: never;
    }
    | {
        id: string;
        timestamp: number;
        entity: 'item';
        action: 'create';
        data: {
            name: string;
            categoryId: number | bigint;
            quantity?: number;
            reorderPoint?: number;
            iconBase64?: string | null;
            galleryBase64?: string[];
            attributes?: Record<string, string | number | boolean>;
        };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'item';
        action: 'update';
        entityId: number | bigint;
        data: {
            name?: string;
            categoryId?: number | bigint;
            reorderPoint?: number;
            iconBase64?: string | null;
            galleryBase64?: string[];
            attributes?: Record<string, string | number | boolean>;
        };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'item';
        action: 'adjustQuantity';
        entityId: number | bigint;
        data: { amount: number };
    }
    | {
        id: string;
        timestamp: number;
        entity: 'item';
        action: 'delete';
        entityId: number | bigint;
        data?: never;
    };

export interface InventoryDeltaResult {
    status: 'applied' | 'stale' | 'duplicate';
    value?: number | bigint | boolean;
}

export interface InventoryQueueStatus {
    pending: number;
    applied: number;
    stale: number;
}
