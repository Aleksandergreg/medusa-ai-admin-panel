import { Parameter } from "../registry/openapi-registry";

export function summarizeParams(
    params: Parameter[]
): Array<{ name: string; in: string; required?: boolean; type?: string; description?: string }> {
    return params.map((p) => ({
        name: p.name,
        in: p.in,
        required: p.required,
        type: (p.schema?.type as string | undefined) ?? undefined,
        description: p.description
    }));
}
