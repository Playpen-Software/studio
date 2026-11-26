// @ts-expect-error Electrobun's RPC types are provided by the build toolchain.
import type { RPCSchema } from "electrobun";
import type {
    Space,
    Category,
    Item,
    CategoryAttributeInput,
    ItemInput,
    SupportedVersion,
    ChunkCap,
    InspectionResult,
    QueryOptions
} from "../bun/database-driver";
import type { QueryUnifiedOptions } from "./store-types";
import type {
    InventoryDelta,
    InventoryDeltaResult,
    InventoryQueueStatus
} from "./inventory-delta";

export type DatabaseType = 'sqlite' | 'remote';

export type StoreRPCType = {
    bun: RPCSchema<{
        requests: {
            getPreferences: {
                params: void;
                response: Record<string, any>;
            };
            setPreferences: {
                params: object;
                response: boolean;
            };
            resetInventory: {
                params: void;
                response: void;
            };
            resetAppData: {
                params: void;
                response: void;
            };
            applyInventoryDelta: {
                params: InventoryDelta;
                response: InventoryDeltaResult;
            };
            getInventoryQueueStatus: {
                params: void;
                response: InventoryQueueStatus;
            };
            setDatabase: {
                params: { database: DatabaseType; databasePath?: string; remoteUrl?: string };
                response: void;
            };
            getDatabase: {
                params: void;
                response: DatabaseType | null;
            };
            pingServer: {
                params: void;
                response: boolean;
            };

            // --- SPACES ---
            createSpace: {
                params: {
                    name: string;
                    imageBase64?: string | null;
                };
                response: number | bigint;
            };
            updateSpace: {
                params: {
                    id: number | bigint;
                    updates: {
                        name?: string;
                        imageBase64?: string | null;
                    };
                };
                response: boolean;
            };
            listSpaces: {
                params: {
                    cap?: number;
                    index?: number;
                };
                response: Space[];
            };
            querySpaces: {
                params: {
                    options?: QueryOptions;
                    cap?: number;
                    index?: number;
                };
                response: Space[];
            };
            deleteSpace: {
                params: number | bigint;
                response: boolean;
            };

            // --- CATEGORIES ---
            createCategory: {
                params: {
                    spaceId: number | bigint;
                    name: string;
                    parentCategoryId?: number | bigint | null;
                    attributes?: CategoryAttributeInput[];
                };
                response: number | bigint;
            };
            updateCategory: {
                params: {
                    id: number | bigint;
                    updates: {
                        name?: string;
                        spaceId?: number | bigint;
                        parentCategoryId?: number | bigint | null;
                    };
                };
                response: boolean;
            };
            listCategories: {
                params: {
                    spaceId: number | bigint;
                    cap?: number;
                    index?: number;
                };
                response: Category[];
            };
            queryCategories: {
                params: {
                    spaceId: number | bigint;
                    options?: QueryOptions;
                    cap?: number;
                    index?: number;
                };
                response: Category[];
            };
            deleteCategory: {
                params: number | bigint;
                response: boolean;
            };

            // --- ITEMS ---
            createItem: {
                params: ItemInput;
                response: number | bigint;
            };
            updateItem: {
                params: {
                    id: number | bigint;
                    updates: {
                        name?: string;
                        categoryId?: number | bigint;
                        reorderPoint?: number;
                        iconBase64?: string | null;
                        galleryBase64?: string[];
                        attributes?: Record<string, string | number | boolean>;
                    };
                };
                response: boolean;
            };
            adjustItemQuantity: {
                params: { id: number | bigint; amount: number };
                response: boolean;
            };
            listItems: {
                params: {
                    cap?: number;
                    index?: number;
                };
                response: Item[];
            };
            queryItems: {
                params: {
                    options?: QueryUnifiedOptions;
                    cap?: number;
                    index?: number;
                };
                response: Item[];
            };
            getItemById: {
                params: number | bigint;
                response: Item | null;
            };
            deleteItem: {
                params: number | bigint;
                response: boolean;
            };

            // --- CONVERSION & INSPECTION ---
            detectFileVersion: {
                params: string; // filePath or content string
                response: InspectionResult;
            };
            convert: {
                params: {
                    source: string; // file path or string content
                    options: {
                        sourceVersion?: SupportedVersion | 'auto';
                        targetSpaceId: number | bigint;
                        chunkCap?: ChunkCap;
                    };
                };
                response: {
                    importedItems: number;
                    importedCategories: number;
                };
            };
        };
        messages: {
            closeStore: void;
            toggleDevTools: void;
        };
    }>;
    webview: RPCSchema<{
        requests: {};
        messages: {};
    }>;
};