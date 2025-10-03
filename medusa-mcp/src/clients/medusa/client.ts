import Medusa from "@medusajs/js-sdk";
import { env } from "../../config/env";

type FetchOptions = {
    method: string;
    headers?: Record<string, string>;
    query?: Record<string, any>;
    body?: Record<string, any> | BodyInit | null;
    [key: string]: unknown;
};

export class MedusaClient {
    private sdk: Medusa;
    private token: string | null = null;

    constructor(baseUrl: string = env.medusaBackendUrl) {
        this.sdk = new Medusa({
            baseUrl,
            debug: env.isDevelopment,
            publishableKey: env.publishableKey,
            auth: { type: "jwt" }
        });
    }

    get client(): Medusa {
        return this.sdk;
    }

    get authToken(): string | null {
        return this.token;
    }

    setAuthToken(token: string | null): void {
        this.token = token;
    }

    async login(email: string, password: string): Promise<string> {
        const response = await this.sdk.auth.login("user", "emailpass", {
            email,
            password
        });
        const token = response.toString();
        this.setAuthToken(token);
        return token;
    }

    async loginFromEnv(): Promise<string> {
        return this.login(env.medusaUsername, env.medusaPassword);
    }

    async fetch(path: string, options: FetchOptions): Promise<unknown> {
        const headers: Record<string, string> = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            ...(options.headers ?? {})
        };
        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }
        return this.sdk.client.fetch(path, {
            ...options,
            headers
        });
    }
}
