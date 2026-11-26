interface RemoteResponse {
    type: 'response';
    id: string;
    ok: boolean;
    result?: unknown;
    error?: string;
}

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
}

export class RemoteDatabaseClient {
    private socket: WebSocket | null = null;
    private connecting: Promise<void> | null = null;
    private readonly pending = new Map<string, PendingRequest>();

    constructor(
        private readonly url: string,
        private readonly requestTimeout = 20000
    ) {}

    get connected(): boolean {
        return this.socket?.readyState === WebSocket.OPEN;
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        if (this.connecting) return this.connecting;
        if (!this.url || !/^wss?:\/\//i.test(this.url)) {
            throw new Error('A valid ws:// or wss:// database URL is required.');
        }

        const socket = new WebSocket(this.url);
        this.socket = socket;
        this.connecting = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                socket.close();
                reject(new Error('The remote database WebSocket connection timed out.'));
            }, this.requestTimeout);
            socket.addEventListener('open', () => {
                clearTimeout(timeout);
                resolve();
            }, { once: true });
            socket.addEventListener('error', () => {
                clearTimeout(timeout);
                reject(new Error('The remote database WebSocket connection failed.'));
            }, { once: true });
            socket.addEventListener('close', () => {
                clearTimeout(timeout);
                if (socket.readyState !== WebSocket.OPEN) {
                    reject(new Error('The remote database WebSocket connection closed before opening.'));
                }
            }, { once: true });
        });
        try {
            await this.connecting;
        } catch (error) {
            if (this.socket === socket) this.socket = null;
            throw error;
        } finally {
            this.connecting = null;
        }

        socket.addEventListener('message', event => this.handleMessage(event));
        socket.addEventListener('close', () => {
            this.rejectPending(new Error('The remote database WebSocket connection closed.'));
            if (this.socket === socket) this.socket = null;
        });
        socket.addEventListener('error', () => {
            this.rejectPending(new Error('The remote database WebSocket encountered an error.'));
        });
    }

    async request<T>(method: string, params: unknown): Promise<T> {
        await this.connect();

        const id = crypto.randomUUID();
        const payload = JSON.stringify({ type: 'request', id, method, params });
        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`The remote database request '${method}' timed out.`));
            }, this.requestTimeout);
            this.pending.set(id, {
                resolve: value => resolve(value as T),
                reject,
                timeout
            });
            try {
                this.socket!.send(payload);
            } catch (error) {
                clearTimeout(timeout);
                this.pending.delete(id);
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    close(): void {
        const socket = this.socket;
        this.socket = null;
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
        this.rejectPending(new Error('The remote database connection was closed.'));
    }

    private handleMessage(event: MessageEvent): void {
        if (typeof event.data !== 'string') {
            this.rejectPending(new Error('The remote database sent a non-text response.'));
            return;
        }
        let response: unknown;
        try {
            response = JSON.parse(event.data);
        } catch (error) {
            this.rejectPending(new Error(`The remote database sent invalid JSON: ${String(error)}`));
            return;
        }
        if (
            typeof response !== 'object' ||
            response === null ||
            !('type' in response) ||
            response.type !== 'response' ||
            !('id' in response) ||
            typeof response.id !== 'string' ||
            !('ok' in response) ||
            typeof response.ok !== 'boolean'
        ) {
            this.rejectPending(new Error('The remote database sent an invalid response envelope.'));
            return;
        }

        const pending = this.pending.get(response.id);
        if (!pending) return;
        this.pending.delete(response.id);
        clearTimeout(pending.timeout);
        const typedResponse = response as RemoteResponse;
        if (typedResponse.ok) {
            pending.resolve(typedResponse.result);
        } else {
            pending.reject(new Error(typedResponse.error || 'The remote database request failed.'));
        }
    }

    private rejectPending(error: Error): void {
        for (const [id, request] of this.pending) {
            clearTimeout(request.timeout);
            request.reject(error);
            this.pending.delete(id);
        }
    }
}
