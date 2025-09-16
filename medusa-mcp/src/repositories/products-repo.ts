import type { Http } from "../http/client";

export function createProductsRepo(http: Http): {
    listAllMinimal: () => Promise<
        Array<{ id?: string; title?: string | null; status?: string | null }>
    >;
} {
    async function listAllMinimal(): Promise<
        Array<{ id?: string; title?: string | null; status?: string | null }>
    > {
        const limit = 200;
        let offset = 0;
        const acc: Array<{ id?: string; title?: string | null; status?: string | null }> = [];
        let more = true;

        while (more) {
            const q: Record<string, unknown> = {
                limit,
                offset,
                // request minimal fields when supported by backend
                fields: ["+id", "+title", "+status"].join(",")
            };
            try {
                const data = await http.get<{ products?: Array<any> }>(
                    "/admin/products",
                    q
                );
                const batch = Array.isArray(data?.products) ? data.products : [];
                for (const p of batch) {
                    acc.push({ id: p?.id, title: p?.title ?? null, status: p?.status ?? null });
                }
                more = batch.length === limit;
                if (more) offset += limit;
            } catch {
                // On error, break to avoid infinite loop and return what we have
                more = false;
            }
        }
        return acc;
    }

    return { listAllMinimal };
}

