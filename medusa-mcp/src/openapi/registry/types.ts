export type HttpMethod =
    | "get"
    | "post"
    | "put"
    | "patch"
    | "delete"
    | "head"
    | "options";

export type Parameter = {
    name: string;
    in: "path" | "query" | "header" | "cookie";
    required?: boolean;
    description?: string;
    schema?: { type?: string; [k: string]: unknown };
};

export type Operation = {
    operationId: string;
    method: HttpMethod;
    path: string;
    summary?: string;
    description?: string;
    tags?: string[];
    parameters: Parameter[];
    requestBody?: unknown;
};
