import { loadOpenApiSpec } from "../src/openapi/spec/loader";
import {
    HttpMethod,
    OpenApiRegistry
} from "../src/openapi/registry/openapi-registry";

type EvalQuery = {
    query: string;
    tags?: string[];
    methods?: HttpMethod[];
};

const EVAL_QUERIES: EvalQuery[] = [
    { query: "create a draft order with items" },
    { query: "list payment collections" },
    { query: "cancel a fulfillment" },
    { query: "list regions with search" },
    { query: "update customer billing address" },
    { query: "archive a price list" },
    { query: "create a claim for return" },
    { query: "set inventory levels for variant" },
    { query: "publish a product" },
    { query: "generate draft order payment link" },
    { query: "list sales channels" },
    { query: "what is my most used shipping method" },
    { query: "What products with low inventory do I have" },
    { query: "What active promotions do I have" }
];

const spec = loadOpenApiSpec();
const registry = new OpenApiRegistry(spec);

process.env.OPENAPI_SEARCH_DEBUG = "1";

console.log("=== OpenAPI search baseline ===");
for (const entry of EVAL_QUERIES) {
    const { query, tags, methods } = entry;
    console.log(`\n> ${query}`);
    registry.search(query, {
        tags,
        methods,
        limit: 10
    });
}

console.log("\nBaseline run complete.");
